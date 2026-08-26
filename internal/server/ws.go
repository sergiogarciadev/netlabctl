package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"netlabctl/internal/logger"
	"netlabctl/internal/model"
	"netlabctl/internal/network"
	"netlabctl/internal/qemu"
	"netlabctl/internal/storage"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development
	},
}

// Client represents a single connected WebSocket client.
type Client struct {
	hub       *WSHub
	conn      *websocket.Conn
	send      chan []byte
	projectID string
	mu        sync.Mutex
}

// WSHub maintains active clients and routes WebSocket events.
type WSHub struct {
	storage    *storage.Storage
	qemuMgr    *qemu.Manager
	netMgr     *network.NetworkManager
	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan []byte
	mu         sync.RWMutex
}

// NewWSHub initializes the WebSocket hub.
func NewWSHub(store *storage.Storage, qemuMgr *qemu.Manager, netMgr *network.NetworkManager) *WSHub {
	hub := &WSHub{
		storage:    store,
		qemuMgr:    qemuMgr,
		netMgr:     netMgr,
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan []byte, 256),
	}
	if qemuMgr != nil {
		qemuMgr.OnNodeExit = hub.handleNodeExit
	}
	return hub
}

// Run executes the hub event loop and 100ms packet stats ticker.
func (h *WSHub) Run() {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			logger.Log.Debug("WebSocket client connected")

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			logger.Log.Debug("WebSocket client disconnected")

		case message := <-h.broadcast:
			var slowClients []*Client

			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					slowClients = append(slowClients, client)
				}
			}
			h.mu.RUnlock()

			if len(slowClients) > 0 {
				h.mu.Lock()
				for _, client := range slowClients {
					if _, ok := h.clients[client]; ok {
						delete(h.clients, client)
						close(client.send)
					}
				}
				h.mu.Unlock()
			}

		case <-ticker.C:
			// Broadcast 100ms packet stats to subscribed clients
			if h.netMgr != nil {
				stats := h.netMgr.GetStats()
				if len(stats) > 0 {
					h.broadcastStats(stats)
				}
			}
		}
	}
}

func (h *WSHub) broadcastStats(stats []network.WireProxyStats) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	statItems := make([]model.WireStatItem, 0, len(stats))
	for _, s := range stats {
		if s.Packets100ms > 0 || s.SrcToDst100ms > 0 || s.DstToSrc100ms > 0 {
			statItems = append(statItems, model.WireStatItem{
				WireID:        s.WireID,
				Count:         int(s.Packets100ms),
				Bytes:         s.TotalBytes,
				SrcToDst100ms: s.SrcToDst100ms,
				DstToSrc100ms: s.DstToSrc100ms,
			})
		}
	}

	if len(statItems) == 0 {
		return // Do NOT send event if no wires have packet traffic!
	}

	payload := model.WireStatsPayload{Stats: statItems}

	for client := range h.clients {
		client.sendJSON(model.MsgTypeWireStats, payload)
	}
}

// BroadcastToProject sends a message to all clients subscribed to a specific project.
func (h *WSHub) BroadcastToProject(projectID string, msgType string, payload interface{}) {
	dataBytes, err := json.Marshal(payload)
	if err != nil {
		return
	}
	wsMsg := model.WSMessage{
		Type: msgType,
		Data: json.RawMessage(dataBytes),
	}
	envBytes, err := json.Marshal(wsMsg)
	if err != nil {
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		client.mu.Lock()
		cProj := client.projectID
		client.mu.Unlock()

		if cProj == projectID {
			select {
			case client.send <- envBytes:
			default:
			}
		}
	}
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Log.Error("WebSocket upgrade failed", "error", err)
		return
	}

	client := &Client{
		hub:  s.hub,
		conn: conn,
		send: make(chan []byte, 256),
	}

	s.hub.register <- client

	go client.writePump()
	go client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			break
		}

		var msg model.WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			logger.Log.Warn("Invalid WS json received", "error", err)
			continue
		}

		c.handleIncomingMessage(msg)
	}
}

func (c *Client) handleIncomingMessage(msg model.WSMessage) {
	switch msg.Type {
	case model.MsgTypeSubscribeProject:
		var payload model.SubscribeProjectPayload
		if err := json.Unmarshal(msg.Data, &payload); err == nil {
			c.mu.Lock()
			c.projectID = payload.ProjectID
			c.mu.Unlock()

			// Send current project state back to client
			top, err := c.hub.storage.GetProject(payload.ProjectID)
			if err == nil {
				c.sendJSON(model.MsgTypeProjectState, top)
			}
		}

	case model.MsgTypeStartSimulation:
		var payload struct {
			ProjectID string `json:"projectId"`
		}
		_ = json.Unmarshal(msg.Data, &payload)
		projectID := payload.ProjectID
		if projectID == "" {
			projectID = c.projectID
		}
		if projectID == "" {
			projectID = "default"
		}
		logger.Log.Info("WS Command: Start simulation", "project", projectID)
		c.hub.startProjectSimulation(projectID)

	case model.MsgTypeStopSimulation:
		var payload struct {
			ProjectID string `json:"projectId"`
		}
		_ = json.Unmarshal(msg.Data, &payload)
		projectID := payload.ProjectID
		if projectID == "" {
			projectID = c.projectID
		}
		if projectID == "" {
			projectID = "default"
		}
		logger.Log.Info("WS Command: Stop simulation", "project", projectID)
		c.hub.stopProjectSimulation(projectID)

	case model.MsgTypeStartNode:
		var payload model.NodeActionPayload
		if err := json.Unmarshal(msg.Data, &payload); err == nil && payload.NodeID != "" {
			projectID := payload.ProjectID
			if projectID == "" {
				projectID = c.projectID
			}
			if projectID == "" {
				projectID = "default"
			}
			logger.Log.Info("WS Command: Start node", "node", payload.NodeID, "project", projectID)
			c.hub.startSingleNode(projectID, payload.NodeID)
		}

	case model.MsgTypeShutdownNode:
		var payload model.NodeActionPayload
		if err := json.Unmarshal(msg.Data, &payload); err == nil && payload.NodeID != "" {
			projectID := payload.ProjectID
			if projectID == "" {
				projectID = c.projectID
			}
			if projectID == "" {
				projectID = "default"
			}
			logger.Log.Info("WS Command: Shutdown node", "node", payload.NodeID, "project", projectID)
			c.hub.shutdownSingleNode(projectID, payload.NodeID)
		}

	case model.MsgTypeResetNode:
		var payload model.NodeActionPayload
		if err := json.Unmarshal(msg.Data, &payload); err == nil && payload.NodeID != "" {
			projectID := payload.ProjectID
			if projectID == "" {
				projectID = c.projectID
			}
			if projectID == "" {
				projectID = "default"
			}
			logger.Log.Info("WS Command: Reset node", "node", payload.NodeID, "project", projectID)
			c.hub.resetSingleNode(projectID, payload.NodeID)
		}

	case model.MsgTypeStopNode:
		var payload model.NodeActionPayload
		if err := json.Unmarshal(msg.Data, &payload); err == nil && payload.NodeID != "" {
			projectID := payload.ProjectID
			if projectID == "" {
				projectID = c.projectID
			}
			if projectID == "" {
				projectID = "default"
			}
			logger.Log.Info("WS Command: Stop node", "node", payload.NodeID, "project", projectID)
			c.hub.stopSingleNode(projectID, payload.NodeID)
		}

	case model.MsgTypeRecreateNodeDisk:
		var payload model.NodeActionPayload
		if err := json.Unmarshal(msg.Data, &payload); err == nil && payload.NodeID != "" {
			projectID := payload.ProjectID
			if projectID == "" {
				projectID = c.projectID
			}
			if projectID == "" {
				projectID = "default"
			}
			logger.Log.Info("WS Command: Recreate node disk", "node", payload.NodeID, "project", projectID)
			_ = c.hub.recreateSingleNodeDisk(projectID, payload.NodeID)
		}

	case model.MsgTypeSetWireCondition:
		var payload model.SetWireConditionPayload
		if err := json.Unmarshal(msg.Data, &payload); err == nil {
			conds := payload.GetConditions()
			logger.Log.Info("WS Command: Set wire condition", "wire", payload.WireID, "delayMs", conds.DelayMs, "jitterMs", conds.JitterMs, "lossPercent", conds.LossPercent)
			c.hub.netMgr.UpdateWireCondition(payload.WireID, conds)

			top, err := c.hub.storage.GetProject(c.projectID)
			if err == nil {
				for i := range top.Wires {
					if top.Wires[i].ID == payload.WireID {
						top.Wires[i].Conditions = conds
						_ = c.hub.storage.SaveProject(top)
						c.hub.BroadcastToProject(c.projectID, model.MsgTypeProjectState, top)
						break
					}
				}
			}
		}

	case model.MsgTypeEnableTZSP:
		var payload model.EnableTZSPPayload
		if err := json.Unmarshal(msg.Data, &payload); err == nil {
			logger.Log.Info("WS Command: Enable TZSP", "wire", payload.WireID, "target", payload.TargetUDP)
			c.hub.netMgr.UpdateWireTZSP(payload.WireID, payload.TargetUDP)

			top, err := c.hub.storage.GetProject(c.projectID)
			if err == nil {
				for i := range top.Wires {
					if top.Wires[i].ID == payload.WireID {
						top.Wires[i].TZSPTarget = payload.TargetUDP
						_ = c.hub.storage.SaveProject(top)
						c.hub.BroadcastToProject(c.projectID, model.MsgTypeProjectState, top)
						break
					}
				}
			}
		}
	}
}

func (h *WSHub) startProjectSimulation(projectID string) {
	top, err := h.storage.GetProject(projectID)
	if err != nil {
		logger.Log.Error("Failed to get project for simulation start", "error", err)
		return
	}

	portAddrs := make(map[string]string) // portID -> "127.0.N.P:PORT"
	connectedPorts := make(map[string]bool)

	// Identify all connected ports from wires
	for _, wire := range top.Wires {
		connectedPorts[wire.SrcPortID] = true
		connectedPorts[wire.DstPortID] = true
	}

	// 1. Register Managed Network TCP Listeners for ALL node ports
	for nIdx, node := range top.Nodes {
		nodeNum := nIdx + 1
		for pIdx, port := range node.Ports {
			portNum := pIdx + 1
			ip := fmt.Sprintf("127.0.%d.%d", nodeNum, portNum)
			tcpPort := 10000 + nodeNum*20 + portNum

			addrStr := fmt.Sprintf("%s:%d", ip, tcpPort)
			portKey := fmt.Sprintf("%s:%s", node.ID, port.ID)
			portAddrs[portKey] = addrStr

			_, err := h.netMgr.RegisterPortListener(node.ID, port.ID, ip, tcpPort)
			if err != nil {
				logger.Log.Error("Failed to register managed port listener", "nodeID", node.ID, "portID", port.ID, "addr", addrStr, "error", err)
			}
		}
	}

	// 2. Establish Wire Bridges for connected port pairs
	for _, wire := range top.Wires {
		if err := h.netMgr.AddWireBridge(wire); err != nil {
			logger.Log.Error("Failed to add wire bridge", "wireID", wire.ID, "error", err)
		}
	}

	// 3. Launch QEMU Node Instances if per-node AutoStart is enabled (default true)
	startedNodes := make(map[string]bool)
	for i := range top.Nodes {
		node := &top.Nodes[i]
		shouldAutoStart := node.AutoStart == nil || *node.AutoStart

		if shouldAutoStart {
			tmpl, tmplDir, _ := h.storage.GetTemplate(node.TemplateID)
			_, err := h.qemuMgr.StartNode(projectID, node, tmplDir, tmpl, portAddrs)
			if err != nil {
				logger.Log.Error("Failed to start node instance", "nodeID", node.ID, "error", err)
			} else {
				startedNodes[node.ID] = true
				node.Status = "running"
				node.Power = "on"
			}
		} else {
			node.Status = "stopped"
			node.Power = "off"
		}
	}

	go func() {
		time.Sleep(1 * time.Second) // Give QEMU instances 1s to open monitor sockets
		h.SyncTopologyNetworkAndMonitors(top)
	}()

	// 4. Update and save project simulation status
	top.SimulationStatus = "running"
	_ = h.storage.SaveProject(top)

	h.BroadcastToProject(projectID, model.MsgTypeProjectState, top)
	h.BroadcastToProject(projectID, "simulation_started", map[string]string{"status": "running"})
}

func (h *WSHub) startSingleNode(projectID string, nodeID string) {
	top, err := h.storage.GetProject(projectID)
	if err != nil {
		logger.Log.Error("Failed to get project for starting single node", "error", err)
		return
	}

	if top.SimulationStatus != "running" {
		h.startProjectSimulation(projectID)
		top, _ = h.storage.GetProject(projectID)
	}

	portAddrs := make(map[string]string)
	connectedPorts := make(map[string]bool)

	for _, wire := range top.Wires {
		connectedPorts[wire.SrcPortID] = true
		connectedPorts[wire.DstPortID] = true
	}

	for nIdx, n := range top.Nodes {
		nodeNum := nIdx + 1
		for pIdx, port := range n.Ports {
			portNum := pIdx + 1
			ip := fmt.Sprintf("127.0.%d.%d", nodeNum, portNum)
			tcpPort := 10000 + nodeNum*20 + portNum
			portKey := fmt.Sprintf("%s:%s", n.ID, port.ID)
			portAddrs[portKey] = fmt.Sprintf("%s:%d", ip, tcpPort)
		}
	}

	var targetNode *model.Node
	for i := range top.Nodes {
		if top.Nodes[i].ID == nodeID {
			targetNode = &top.Nodes[i]
			top.Nodes[i].Status = "running"
			top.Nodes[i].Power = "on"
			break
		}
	}

	if targetNode == nil {
		logger.Log.Error("Node not found for start", "nodeID", nodeID)
		return
	}

	tmpl, tmplDir, _ := h.storage.GetTemplate(targetNode.TemplateID)
	_, err = h.qemuMgr.StartNode(projectID, targetNode, tmplDir, tmpl, portAddrs)
	if err != nil {
		logger.Log.Error("Failed to start single node QEMU instance", "nodeID", nodeID, "error", err)
	}

	go func() {
		time.Sleep(1 * time.Second)
		h.SyncTopologyNetworkAndMonitors(top)
	}()

	_ = h.storage.SaveProject(top)
	h.BroadcastToProject(projectID, model.MsgTypeProjectState, top)
}

func (h *WSHub) shutdownSingleNode(projectID string, nodeID string) {
	err := h.qemuMgr.ShutdownNode(projectID, nodeID)
	if err != nil {
		logger.Log.Error("Failed to send ACPI shutdown to node", "nodeID", nodeID, "error", err)
	}
}

func (h *WSHub) resetSingleNode(projectID string, nodeID string) {
	err := h.qemuMgr.ResetNode(projectID, nodeID)
	if err != nil {
		logger.Log.Error("Failed to send system reset to node", "nodeID", nodeID, "error", err)
	}
}

func (h *WSHub) stopSingleNode(projectID string, nodeID string) {
	_ = h.qemuMgr.StopNode(nodeID)

	top, err := h.storage.GetProject(projectID)
	if err == nil {
		for i := range top.Nodes {
			if top.Nodes[i].ID == nodeID {
				top.Nodes[i].Status = "stopped"
				top.Nodes[i].Power = "off"
				break
			}
		}
		_ = h.storage.SaveProject(top)
		h.BroadcastToProject(projectID, model.MsgTypeProjectState, top)
	}
}

func (h *WSHub) recreateSingleNodeDisk(projectID string, nodeID string) error {
	top, err := h.storage.GetProject(projectID)
	if err != nil {
		return err
	}

	for i := range top.Nodes {
		if top.Nodes[i].ID == nodeID {
			node := &top.Nodes[i]
			tmpl, tmplDir, _ := h.storage.GetTemplate(node.TemplateID)
			_, err := h.qemuMgr.RecreateNodeDisk(projectID, node, tmplDir, tmpl)
			if err != nil {
				logger.Log.Error("Failed to recreate disk for node", "nodeID", nodeID, "error", err)
				return err
			}
			node.Status = "stopped"
			node.Power = "off"
			_ = h.storage.SaveProject(top)
			h.BroadcastToProject(projectID, model.MsgTypeProjectState, top)
			return nil
		}
	}
	return fmt.Errorf("node not found: %s", nodeID)
}

func (h *WSHub) handleNodeExit(projectID, nodeID string) {
	top, err := h.storage.GetProject(projectID)
	if err == nil {
		updated := false
		for i := range top.Nodes {
			if top.Nodes[i].ID == nodeID {
				if top.Nodes[i].Status != "stopped" || top.Nodes[i].Power != "off" {
					top.Nodes[i].Status = "stopped"
					top.Nodes[i].Power = "off"
					updated = true
				}
				break
			}
		}
		if updated {
			_ = h.storage.SaveProject(top)
			h.BroadcastToProject(projectID, model.MsgTypeProjectState, top)
		}
	}
}

func (h *WSHub) stopProjectSimulation(projectID string) {
	h.qemuMgr.StopAllNodes()
	h.netMgr.StopAllProxies()

	top, err := h.storage.GetProject(projectID)
	if err == nil {
		top.SimulationStatus = "stopped"
		for i := range top.Nodes {
			top.Nodes[i].Status = "stopped"
			top.Nodes[i].Power = "off"
		}
		_ = h.storage.SaveProject(top)
		h.BroadcastToProject(projectID, model.MsgTypeProjectState, top)
	}

	h.BroadcastToProject(projectID, "simulation_stopped", map[string]string{"status": "stopped"})
}

// SyncTopologyNetworkAndMonitors updates wire bridges and issues QMP monitor set_link carrier state updates.
func (h *WSHub) SyncTopologyNetworkAndMonitors(top *model.Topology) {
	if top == nil || h.netMgr == nil || h.qemuMgr == nil {
		return
	}

	connectedPorts := make(map[string]bool)
	wireMap := make(map[string]bool)

	for _, wire := range top.Wires {
		wireMap[wire.ID] = true
		connectedPorts[fmt.Sprintf("%s:%s", wire.SrcNodeID, wire.SrcPortID)] = true
		connectedPorts[fmt.Sprintf("%s:%s", wire.DstNodeID, wire.DstPortID)] = true

		// Add/update wire bridge
		_ = h.netMgr.AddWireBridge(wire)
	}

	// Remove wire bridges for any deleted wires
	for _, stat := range h.netMgr.GetStats() {
		if !wireMap[stat.WireID] {
			h.netMgr.RemoveWireBridge(stat.WireID)
		}
	}

	// Issue QMP/HMP monitor set_link carrier status (ethN on/off) for all running node ports concurrently
	var wg sync.WaitGroup
	for _, node := range top.Nodes {
		if !h.qemuMgr.IsNodeRunning(node.ID) {
			continue
		}
		wg.Add(1)
		go func(n model.Node) {
			defer wg.Done()
			var portStates []qemu.PortLinkState
			for i, port := range n.Ports {
				devID := fmt.Sprintf("eth%d", i)
				portKey := fmt.Sprintf("%s:%s", n.ID, port.ID)

				pType := port.Type
				if pType == "" {
					pType = "managed"
				}

				// Unmanaged/non-managed interfaces (user, bridge, tap, unmanaged) are ALWAYS set to link UP ('on').
				// Managed interfaces are set to link UP ('on') if connected to a wire in the topology.
				linkOn := true
				if pType == "managed" {
					linkOn = connectedPorts[portKey]
				}

				portStates = append(portStates, qemu.PortLinkState{
					DeviceID: devID,
					LinkOn:   linkOn,
				})
			}
			_ = h.qemuMgr.SetNodePortsLinkStatus(top.ID, n.ID, portStates)
		}(node)
	}
	wg.Wait()
}

func (c *Client) sendJSON(msgType string, data interface{}) {
	dBytes, err := json.Marshal(data)
	if err != nil {
		return
	}
	env := model.WSMessage{
		Type: msgType,
		Data: json.RawMessage(dBytes),
	}
	envBytes, err := json.Marshal(env)
	if err != nil {
		return
	}

	select {
	case c.send <- envBytes:
	default:
	}
}

func (c *Client) writePump() {
	defer c.conn.Close()

	for message := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
			break
		}
	}
}

// handleNodeTerminal streams serial console I/O between xterm.js and the node's QEMU serial socket.
func (s *Server) handleNodeTerminal(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	nodeID := r.PathValue("nodeId")

	if projectID == "" {
		projectID = "default"
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Log.Error("Terminal WebSocket upgrade failed", "error", err)
		return
	}
	defer conn.Close()

	serialSock := s.qemuMgr.GetSerialSocketPath(projectID, nodeID)
	hub := s.serialHubs.GetHub(projectID, nodeID, serialSock)

	client := hub.Subscribe(conn)
	defer hub.Unsubscribe(client)

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		hub.WriteInput(msg)
	}
}

// Suppress unused imports check
var _ = os.Stat
