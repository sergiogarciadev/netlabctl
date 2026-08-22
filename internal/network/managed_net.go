package network

import (
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"netlabctl/internal/logger"
	"netlabctl/internal/model"
)

type WireProxyStats struct {
	WireID       string `json:"wireId"`
	Packets100ms int64  `json:"packets100ms"`
	TotalPackets int64  `json:"totalPackets"`
	TotalBytes   int64  `json:"totalBytes"`
	TZSPActive   bool   `json:"tzspActive"`
}

type ManagedPortSocket struct {
	Key      string // "nodeID:portID"
	NodeID   string
	PortID   string
	IP       string
	Port     int
	listener net.Listener
	conn     net.Conn
	mu       sync.Mutex
}

type WireBridge struct {
	Wire         model.Wire
	PortA        *ManagedPortSocket
	PortB        *ManagedPortSocket
	packetsCount int64
	bytesCount   int64
	last100msPkt int64
	lastPktCount int64
	stopChan     chan struct{}
}

type NetworkManager struct {
	mu          sync.Mutex
	portSockets map[string]*ManagedPortSocket // "nodeID:portID" -> socket
	bridges     map[string]*WireBridge        // wireID -> bridge
}

func NewNetworkManager() *NetworkManager {
	nm := &NetworkManager{
		portSockets: make(map[string]*ManagedPortSocket),
		bridges:     make(map[string]*WireBridge),
	}

	// 100ms sliding window packet ticker
	go func() {
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			nm.update100msStats()
		}
	}()

	return nm
}

func (nm *NetworkManager) update100msStats() {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	for _, bridge := range nm.bridges {
		current := atomic.LoadInt64(&bridge.packetsCount)
		diff := current - bridge.lastPktCount
		if diff < 0 {
			diff = 0
		}
		atomic.StoreInt64(&bridge.last100msPkt, diff)
		bridge.lastPktCount = current
	}
}

// RegisterPortListener creates a unique TCP listener for a node port on 127.0.N.P:PORT.
func (nm *NetworkManager) RegisterPortListener(nodeID, portID, ip string, port int) (*ManagedPortSocket, error) {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	key := fmt.Sprintf("%s:%s", nodeID, portID)
	if ps, exists := nm.portSockets[key]; exists {
		return ps, nil
	}

	addrStr := fmt.Sprintf("%s:%d", ip, port)
	listener, err := net.Listen("tcp", addrStr)
	if err != nil {
		return nil, fmt.Errorf("failed to listen managed port on %s: %w", addrStr, err)
	}

	ps := &ManagedPortSocket{
		Key:      key,
		NodeID:   nodeID,
		PortID:   portID,
		IP:       ip,
		Port:     port,
		listener: listener,
	}

	nm.portSockets[key] = ps

	// Accept QEMU connection for this managed port
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			ps.mu.Lock()
			if ps.conn != nil {
				_ = ps.conn.Close()
			}
			ps.conn = conn
			ps.mu.Unlock()
			logger.Log.Info("QEMU connected to managed port socket", "key", key, "addr", addrStr)
		}
	}()

	return ps, nil
}

// AddWireBridge connects two registered managed port sockets.
func (nm *NetworkManager) AddWireBridge(wire model.Wire) error {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	if _, exists := nm.bridges[wire.ID]; exists {
		return nil
	}

	srcKey := fmt.Sprintf("%s:%s", wire.SrcNodeID, wire.SrcPortID)
	dstKey := fmt.Sprintf("%s:%s", wire.DstNodeID, wire.DstPortID)

	psA, okA := nm.portSockets[srcKey]
	psB, okB := nm.portSockets[dstKey]

	if !okA || !okB {
		return fmt.Errorf("port sockets not registered for wire %s (srcKey: %s, dstKey: %s)", wire.ID, srcKey, dstKey)
	}

	bridge := &WireBridge{
		Wire:     wire,
		PortA:    psA,
		PortB:    psB,
		stopChan: make(chan struct{}),
	}

	nm.bridges[wire.ID] = bridge

	go bridge.runBridge()
	logger.Log.Info("Established managed network wire bridge", "wireID", wire.ID, "srcKey", srcKey, "dstKey", dstKey)
	return nil
}

func (b *WireBridge) runBridge() {
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()

	var connA, connB net.Conn

	for {
		select {
		case <-b.stopChan:
			return
		case <-ticker.C:
			b.PortA.mu.Lock()
			cA := b.PortA.conn
			b.PortA.mu.Unlock()

			b.PortB.mu.Lock()
			cB := b.PortB.conn
			b.PortB.mu.Unlock()

			if cA != nil && cB != nil && (cA != connA || cB != connB) {
				connA = cA
				connB = cB
				go b.bridgeForwarding(connA, connB)
			}
		}
	}
}

func (b *WireBridge) bridgeForwarding(cA, cB net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)

	// Forward A -> B with QEMU stream framing (4-byte length + payload)
	go func() {
		defer wg.Done()
		b.forwardStream(cA, cB)
	}()

	// Forward B -> A with QEMU stream framing (4-byte length + payload)
	go func() {
		defer wg.Done()
		b.forwardStream(cB, cA)
	}()

	wg.Wait()
}

func (b *WireBridge) forwardStream(src, dst net.Conn) {
	header := make([]byte, 4)
	for {
		_, err := io.ReadFull(src, header)
		if err != nil {
			return
		}

		pktLen := binary.BigEndian.Uint32(header)
		if pktLen == 0 || pktLen > 65536 {
			return
		}

		payload := make([]byte, pktLen)
		_, err = io.ReadFull(src, payload)
		if err != nil {
			return
		}

		atomic.AddInt64(&b.bytesCount, int64(pktLen))
		atomic.AddInt64(&b.packetsCount, 1)

		if b.Wire.TZSPTarget != "" {
			b.sendTZSPFrame(payload)
		}

		// Write 4-byte header + payload to destination QEMU socket
		_, err = dst.Write(header)
		if err != nil {
			return
		}
		_, err = dst.Write(payload)
		if err != nil {
			return
		}
	}
}

func (b *WireBridge) sendTZSPFrame(payload []byte) {
	if b.Wire.TZSPTarget == "" {
		return
	}

	udpAddr, err := net.ResolveUDPAddr("udp", b.Wire.TZSPTarget)
	if err != nil {
		return
	}

	conn, err := net.DialUDP("udp", nil, udpAddr)
	if err != nil {
		return
	}
	defer conn.Close()

	tzspHeader := []byte{0x01, 0x00, 0x00, 0x01, 0x01}
	packet := append(tzspHeader, payload...)
	_, _ = conn.Write(packet)
}

// StopAllProxies closes all managed port listeners and bridges.
func (nm *NetworkManager) StopAllProxies() {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	for id, bridge := range nm.bridges {
		close(bridge.stopChan)
		delete(nm.bridges, id)
	}

	for id, ps := range nm.portSockets {
		ps.mu.Lock()
		if ps.listener != nil {
			_ = ps.listener.Close()
		}
		if ps.conn != nil {
			_ = ps.conn.Close()
		}
		ps.mu.Unlock()
		delete(nm.portSockets, id)
	}

	logger.Log.Info("Stopped all managed network listeners and wire bridges")
}

// GetStats returns current 100ms packet statistics for all active wire bridges.
func (nm *NetworkManager) GetStats() []WireProxyStats {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	stats := make([]WireProxyStats, 0, len(nm.bridges))
	for id, b := range nm.bridges {
		stats = append(stats, WireProxyStats{
			WireID:       id,
			Packets100ms: atomic.LoadInt64(&b.last100msPkt),
			TotalPackets: atomic.LoadInt64(&b.packetsCount),
			TotalBytes:   atomic.LoadInt64(&b.bytesCount),
			TZSPActive:   b.Wire.TZSPTarget != "",
		})
	}
	return stats
}
