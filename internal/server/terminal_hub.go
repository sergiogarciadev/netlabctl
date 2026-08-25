package server

import (
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"netlabctl/internal/logger"
)

type terminalClient struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
}

func (c *terminalClient) writeMessage(msgType int, data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.WriteMessage(msgType, data)
}

type NodeSerialHub struct {
	mu         sync.Mutex
	projectID  string
	nodeID     string
	sockPath   string
	clients    map[*terminalClient]struct{}
	activeSock net.Conn
	isRunning  bool
	stopChan   chan struct{}
}

type SerialHubManager struct {
	mu   sync.Mutex
	hubs map[string]*NodeSerialHub
}

func NewSerialHubManager() *SerialHubManager {
	return &SerialHubManager{
		hubs: make(map[string]*NodeSerialHub),
	}
}

func (m *SerialHubManager) GetHub(projectID, nodeID, sockPath string) *NodeSerialHub {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := projectID + ":" + nodeID
	hub, exists := m.hubs[key]
	if !exists {
		hub = &NodeSerialHub{
			projectID: projectID,
			nodeID:    nodeID,
			sockPath:  sockPath,
			clients:   make(map[*terminalClient]struct{}),
		}
		m.hubs[key] = hub
	} else {
		hub.mu.Lock()
		hub.sockPath = sockPath
		hub.mu.Unlock()
	}
	return hub
}

func (m *SerialHubManager) RemoveHub(projectID, nodeID string) {
	m.mu.Lock()
	key := projectID + ":" + nodeID
	hub, exists := m.hubs[key]
	if exists {
		delete(m.hubs, key)
	}
	m.mu.Unlock()

	if exists && hub != nil {
		hub.Close()
	}
}

func (m *SerialHubManager) CloseAll() {
	m.mu.Lock()
	hubs := make([]*NodeSerialHub, 0, len(m.hubs))
	for key, hub := range m.hubs {
		hubs = append(hubs, hub)
		delete(m.hubs, key)
	}
	m.mu.Unlock()

	for _, hub := range hubs {
		if hub != nil {
			hub.Close()
		}
	}
}

func (h *NodeSerialHub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.isRunning {
		h.isRunning = false
		if h.stopChan != nil {
			close(h.stopChan)
			h.stopChan = nil
		}
	}
	if h.activeSock != nil {
		_ = h.activeSock.Close()
		h.activeSock = nil
	}
	for client := range h.clients {
		_ = client.conn.Close()
	}
	h.clients = make(map[*terminalClient]struct{})
}

func (h *NodeSerialHub) Subscribe(conn *websocket.Conn) *terminalClient {
	client := &terminalClient{conn: conn}

	h.mu.Lock()
	h.clients[client] = struct{}{}
	shouldStart := !h.isRunning
	if shouldStart {
		h.isRunning = true
		h.stopChan = make(chan struct{})
		go h.runLoop(h.stopChan)
	}
	h.mu.Unlock()

	statusMsg := fmt.Sprintf("\x1bc\r\n\x1b[1;32mConnected to %s QEMU Serial Console...\x1b[0m\r\n\r\n", h.nodeID)
	_ = client.writeMessage(websocket.TextMessage, []byte(statusMsg))

	return client
}

func (h *NodeSerialHub) Unsubscribe(client *terminalClient) {
	h.mu.Lock()
	delete(h.clients, client)
	shouldStop := len(h.clients) == 0 && h.isRunning
	if shouldStop {
		h.isRunning = false
		if h.stopChan != nil {
			close(h.stopChan)
			h.stopChan = nil
		}
		if h.activeSock != nil {
			_ = h.activeSock.Close()
			h.activeSock = nil
		}
	}
	h.mu.Unlock()
}

func (h *NodeSerialHub) Broadcast(data []byte) {
	h.mu.Lock()
	clientsCopy := make([]*terminalClient, 0, len(h.clients))
	for client := range h.clients {
		clientsCopy = append(clientsCopy, client)
	}
	h.mu.Unlock()

	var deadClients []*terminalClient
	for _, client := range clientsCopy {
		err := client.writeMessage(websocket.BinaryMessage, data)
		if err != nil {
			deadClients = append(deadClients, client)
		}
	}

	if len(deadClients) > 0 {
		h.mu.Lock()
		for _, client := range deadClients {
			delete(h.clients, client)
		}
		h.mu.Unlock()
	}
}

func (h *NodeSerialHub) WriteInput(data []byte) {
	h.mu.Lock()
	sock := h.activeSock
	h.mu.Unlock()

	if sock != nil {
		_, _ = sock.Write(data)
	}
}

func (h *NodeSerialHub) runLoop(stopChan chan struct{}) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-stopChan:
			return
		default:
		}

		h.mu.Lock()
		sockPath := h.sockPath
		h.mu.Unlock()

		sock, err := net.Dial("unix", sockPath)
		if err != nil {
			select {
			case <-stopChan:
				return
			case <-ticker.C:
				continue
			}
		}

		h.mu.Lock()
		h.activeSock = sock
		h.mu.Unlock()

		logger.Log.Debug("SerialHub connected to UNIX socket", "nodeID", h.nodeID, "sockPath", sockPath)

		buf := make([]byte, 1024)
		for {
			select {
			case <-stopChan:
				_ = sock.Close()
				h.mu.Lock()
				h.activeSock = nil
				h.mu.Unlock()
				return
			default:
			}

			n, err := sock.Read(buf)
			if n > 0 {
				h.Broadcast(buf[:n])
			}
			if err != nil {
				_ = sock.Close()
				h.mu.Lock()
				h.activeSock = nil
				h.mu.Unlock()
				break
			}
		}
	}
}
