package server

import (
	"encoding/json"
	"fmt"
	"net"
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
	return &WSHub{
		storage:    store,
		qemuMgr:    qemuMgr,
		netMgr:     netMgr,
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan []byte, 256),
	}
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
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()

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

	for client := range h.clients {
		client.mu.Lock()
		projID := client.projectID
		client.mu.Unlock()

		if projID != "" {
			client.sendJSON("packet_stats", stats)
		}
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
		logger.Log.Info("WS Command: Start simulation", "project", c.projectID)
		if c.projectID != "" {
			c.hub.startProjectSimulation(c.projectID)
		}

	case model.MsgTypeStopSimulation:
		logger.Log.Info("WS Command: Stop simulation", "project", c.projectID)
		if c.projectID != "" {
			c.hub.stopProjectSimulation(c.projectID)
		}

	case model.MsgTypeStartNode:
		var payload model.NodeActionPayload
		if err := json.Unmarshal(msg.Data, &payload); err == nil {
			logger.Log.Info("WS Command: Start node", "node", payload.NodeID)
		}

	case model.MsgTypeStopNode:
		var payload model.NodeActionPayload
		if err := json.Unmarshal(msg.Data, &payload); err == nil {
			logger.Log.Info("WS Command: Stop node", "node", payload.NodeID)
			_ = c.hub.qemuMgr.StopNode(payload.NodeID)
		}

	case model.MsgTypeEnableTZSP:
		var payload model.EnableTZSPPayload
		if err := json.Unmarshal(msg.Data, &payload); err == nil {
			logger.Log.Info("WS Command: Enable TZSP", "wire", payload.WireID, "target", payload.TargetUDP)
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

	basePort := 10000
	portMap := make(map[string]int)

	// 1. Setup Network Wire Proxies
	for i, wire := range top.Wires {
		listenPort := basePort + i*2
		connectPort := basePort + i*2 + 1

		portMap[wire.SrcPortID] = listenPort
		portMap[wire.DstPortID] = connectPort

		_, err := h.netMgr.StartWireProxy(wire, listenPort, connectPort)
		if err != nil {
			logger.Log.Error("Failed to start wire proxy", "wireID", wire.ID, "error", err)
		}
	}

	// 2. Launch QEMU Node Instances
	for _, node := range top.Nodes {
		tmpl, tmplDir, _ := h.storage.GetTemplate(node.TemplateID)
		_, err := h.qemuMgr.StartNode(projectID, &node, tmplDir, tmpl, portMap)
		if err != nil {
			logger.Log.Error("Failed to start node instance", "nodeID", node.ID, "error", err)
		}
	}

	h.BroadcastToProject(projectID, "simulation_started", map[string]string{"status": "running"})
}

func (h *WSHub) stopProjectSimulation(projectID string) {
	h.qemuMgr.StopAllNodes()
	h.netMgr.StopAllProxies()
	h.BroadcastToProject(projectID, "simulation_stopped", map[string]string{"status": "stopped"})
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

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Log.Error("Terminal WebSocket upgrade failed", "error", err)
		return
	}
	defer conn.Close()

	serialSock := s.qemuMgr.GetSerialSocketPath(projectID, nodeID)
	unixConn, err := net.Dial("unix", serialSock)

	if err != nil {
		// Mock interactive shell if QEMU binary is not running on host
		conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n--- Connected to %s Serial Console (Simulated Mode) ---\r\n\r\nRouterOS 7.12 (c) 1999-2026 MikroTik\r\n%s login: ", nodeID, nodeID)))

		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}

			// Echo typed character back to xterm.js
			if string(msg) == "\r" || string(msg) == "\n" {
				conn.WriteMessage(websocket.TextMessage, []byte("\r\n" + nodeID + "> "))
			} else {
				conn.WriteMessage(websocket.TextMessage, msg)
			}
		}
		return;
	}

	defer unixConn.Close()

	var wg sync.WaitGroup
	wg.Add(2)

	// Stream UNIX serial socket -> WebSocket (to xterm.js)
	go func() {
		defer wg.Done()
		buf := make([]byte, 1024)
		for {
			n, err := unixConn.Read(buf)
			if n > 0 {
				_ = conn.WriteMessage(websocket.TextMessage, buf[:n])
			}
			if err != nil {
				break
			}
		}
	}()

	// Stream WebSocket (from xterm.js keystrokes) -> UNIX serial socket
	go func() {
		defer wg.Done()
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			_, _ = unixConn.Write(msg)
		}
	}()

	wg.Wait()
}

// Suppress unused imports check
var _ = os.Stat
