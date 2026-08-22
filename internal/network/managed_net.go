package network

import (
	"fmt"
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

type WireProxy struct {
	Wire         model.Wire
	PortA        int
	PortB        int
	listenerA    net.Listener
	listenerB    net.Listener
	connA        net.Conn
	connB        net.Conn
	packetsCount int64
	bytesCount   int64
	last100msPkt int64
	lastPktCount int64
	stopChan     chan struct{}
	mu           sync.Mutex
}

type NetworkManager struct {
	mu      sync.Mutex
	proxies map[string]*WireProxy
}

func NewNetworkManager() *NetworkManager {
	nm := &NetworkManager{
		proxies: make(map[string]*WireProxy),
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

	for _, proxy := range nm.proxies {
		current := atomic.LoadInt64(&proxy.packetsCount)
		diff := current - proxy.lastPktCount
		if diff < 0 {
			diff = 0
		}
		atomic.StoreInt64(&proxy.last100msPkt, diff)
		proxy.lastPktCount = current
	}
}

// StartWireProxy establishes two TCP listeners for QEMU socket netdevs and bridges them.
func (nm *NetworkManager) StartWireProxy(wire model.Wire, portA int, portB int) (*WireProxy, error) {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	if p, exists := nm.proxies[wire.ID]; exists {
		return p, nil
	}

	lA, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", portA))
	if err != nil {
		return nil, fmt.Errorf("failed to listen on 127.0.0.1:%d: %w", portA, err)
	}

	lB, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", portB))
	if err != nil {
		_ = lA.Close()
		return nil, fmt.Errorf("failed to listen on 127.0.0.1:%d: %w", portB, err)
	}

	proxy := &WireProxy{
		Wire:      wire,
		PortA:     portA,
		PortB:     portB,
		listenerA: lA,
		listenerB: lB,
		stopChan:  make(chan struct{}),
	}

	nm.proxies[wire.ID] = proxy

	go proxy.runProxyBridge()
	logger.Log.Info("Started managed network wire proxy bridge", "wireID", wire.ID, "portA", portA, "portB", portB)
	return proxy, nil
}

func (p *WireProxy) runProxyBridge() {
	// Accept Node A connection in background
	go func() {
		cA, err := p.listenerA.Accept()
		if err == nil {
			p.mu.Lock()
			p.connA = cA
			p.mu.Unlock()
		}
	}()

	// Accept Node B connection in background
	go func() {
		cB, err := p.listenerB.Accept()
		if err == nil {
			p.mu.Lock()
			p.connB = cB
			p.mu.Unlock()
		}
	}()

	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-p.stopChan:
			p.closeConnections()
			return
		case <-ticker.C:
			p.mu.Lock()
			cA := p.connA
			cB := p.connB
			p.mu.Unlock()

			if cA != nil && cB != nil {
				p.bridgeConnections(cA, cB)
				return
			}
		}
	}
}

func (p *WireProxy) bridgeConnections(connA, connB net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)

	// Forward A -> B
	go func() {
		defer wg.Done()
		buf := make([]byte, 4096)
		for {
			n, err := connA.Read(buf)
			if n > 0 {
				atomic.AddInt64(&p.bytesCount, int64(n))
				atomic.AddInt64(&p.packetsCount, 1)

				if p.Wire.TZSPTarget != "" {
					p.sendTZSPFrame(buf[:n])
				}

				_, _ = connB.Write(buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()

	// Forward B -> A
	go func() {
		defer wg.Done()
		buf := make([]byte, 4096)
		for {
			n, err := connB.Read(buf)
			if n > 0 {
				atomic.AddInt64(&p.bytesCount, int64(n))
				atomic.AddInt64(&p.packetsCount, 1)

				if p.Wire.TZSPTarget != "" {
					p.sendTZSPFrame(buf[:n])
				}

				_, _ = connA.Write(buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()

	wg.Wait()
}

func (p *WireProxy) closeConnections() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.listenerA != nil {
		_ = p.listenerA.Close()
	}
	if p.listenerB != nil {
		_ = p.listenerB.Close()
	}
	if p.connA != nil {
		_ = p.connA.Close()
	}
	if p.connB != nil {
		_ = p.connB.Close()
	}
}

// sendTZSPFrame wraps raw Ethernet frame into a TZSP UDP packet.
func (p *WireProxy) sendTZSPFrame(payload []byte) {
	if p.Wire.TZSPTarget == "" {
		return
	}

	udpAddr, err := net.ResolveUDPAddr("udp", p.Wire.TZSPTarget)
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

// StopProxy closes the listeners and proxy connections.
func (nm *NetworkManager) StopProxy(wireID string) {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	if proxy, exists := nm.proxies[wireID]; exists {
		close(proxy.stopChan)
		proxy.closeConnections()
		delete(nm.proxies, wireID)
		logger.Log.Info("Stopped network wire proxy", "wireID", wireID)
	}
}

// StopAllProxies closes all wire proxies.
func (nm *NetworkManager) StopAllProxies() {
	nm.mu.Lock()
	wires := make([]string, 0, len(nm.proxies))
	for id := range nm.proxies {
		wires = append(wires, id)
	}
	nm.mu.Unlock()

	for _, id := range wires {
		nm.StopProxy(id)
	}
}

// GetStats returns current 100ms packet statistics for all active wires.
func (nm *NetworkManager) GetStats() []WireProxyStats {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	stats := make([]WireProxyStats, 0, len(nm.proxies))
	for id, p := range nm.proxies {
		stats = append(stats, WireProxyStats{
			WireID:       id,
			Packets100ms: atomic.LoadInt64(&p.last100msPkt),
			TotalPackets: atomic.LoadInt64(&p.packetsCount),
			TotalBytes:   atomic.LoadInt64(&p.bytesCount),
			TZSPActive:   p.Wire.TZSPTarget != "",
		})
	}
	return stats
}
