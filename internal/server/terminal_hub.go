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
	}
	return hub
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
	defer h.mu.Unlock()

	for client := range h.clients {
		_ = client.writeMessage(websocket.TextMessage, data)
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

		sock, err := net.Dial("unix", h.sockPath)
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

		logger.Log.Debug("SerialHub connected to UNIX socket", "nodeID", h.nodeID, "sockPath", h.sockPath)

		buf := make([]byte, 1024)
		for {
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
