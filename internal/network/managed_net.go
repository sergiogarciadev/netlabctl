package network

import (
	"encoding/binary"
	"fmt"
	"io"
	"math/rand"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"netlabctl/internal/logger"
	"netlabctl/internal/model"
)

type WireProxyStats struct {
	WireID        string `json:"wireId"`
	Packets100ms  int64  `json:"packets100ms"`
	TotalPackets  int64  `json:"totalPackets"`
	TotalBytes    int64  `json:"totalBytes"`
	SrcToDst100ms int64  `json:"srcToDst100ms"`
	DstToSrc100ms int64  `json:"dstToSrc100ms"`
	TZSPActive    bool   `json:"tzspActive"`
}

type EthernetFrame struct {
	Header  []byte // 4-byte length header
	Payload []byte
}

type ManagedPortSocket struct {
	Key         string // "nodeID:portID"
	NodeID      string
	PortID      string
	IP          string
	Port        int
	listener    net.Listener
	conn        net.Conn
	mu          sync.Mutex
	nextSubID   uint64
	subscribers map[uint64]chan EthernetFrame
	readerStop  chan struct{}
}

type WireBridge struct {
	Wire            model.Wire
	PortA           *ManagedPortSocket
	PortB           *ManagedPortSocket
	packetsCount    int64
	bytesCount      int64
	countSrcToDst   int64
	countDstToSrc   int64
	last100msPkt    int64
	lastPktCount    int64
	lastSrcToDstPkt int64
	lastDstToSrcPkt int64
	last100msSrcDst int64
	last100msDstSrc int64
	stopChan        chan struct{}

	tzspMu     sync.Mutex
	tzspTarget string
	tzspConn   *net.UDPConn
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

		curSD := atomic.LoadInt64(&bridge.countSrcToDst)
		diffSD := curSD - bridge.lastSrcToDstPkt
		if diffSD < 0 {
			diffSD = 0
		}
		atomic.StoreInt64(&bridge.last100msSrcDst, diffSD)
		bridge.lastSrcToDstPkt = curSD

		curDS := atomic.LoadInt64(&bridge.countDstToSrc)
		diffDS := curDS - bridge.lastDstToSrcPkt
		if diffDS < 0 {
			diffDS = 0
		}
		atomic.StoreInt64(&bridge.last100msDstSrc, diffDS)
		bridge.lastDstToSrcPkt = curDS
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
		Key:         key,
		NodeID:      nodeID,
		PortID:      portID,
		IP:          ip,
		Port:        port,
		listener:    listener,
		subscribers: make(map[uint64]chan EthernetFrame),
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
			if ps.readerStop != nil {
				close(ps.readerStop)
			}
			ps.conn = conn
			stopCh := make(chan struct{})
			ps.readerStop = stopCh
			ps.mu.Unlock()

			logger.Log.Info("QEMU connected to managed port socket", "key", key, "addr", addrStr)
			go ps.readFramesLoop(conn, stopCh)
		}
	}()

	return ps, nil
}

func (ps *ManagedPortSocket) readFramesLoop(conn net.Conn, stopCh chan struct{}) {
	defer conn.Close()

	header := make([]byte, 4)
	for {
		select {
		case <-stopCh:
			return
		default:
		}

		_, err := io.ReadFull(conn, header)
		if err != nil {
			return
		}

		pktLen := binary.BigEndian.Uint32(header)
		if pktLen == 0 || pktLen > 65536 {
			return
		}

		payload := make([]byte, pktLen)
		_, err = io.ReadFull(conn, payload)
		if err != nil {
			return
		}

		hdrCopy := make([]byte, 4)
		copy(hdrCopy, header)
		frame := EthernetFrame{
			Header:  hdrCopy,
			Payload: payload,
		}

		ps.mu.Lock()
		for _, ch := range ps.subscribers {
			select {
			case ch <- frame:
			default:
				// If subscriber queue is full, drop frame to avoid blocking frame reader loop
			}
		}
		ps.mu.Unlock()
	}
}

func (ps *ManagedPortSocket) Subscribe() (uint64, chan EthernetFrame) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	ps.nextSubID++
	id := ps.nextSubID
	ch := make(chan EthernetFrame, 256)
	ps.subscribers[id] = ch
	return id, ch
}

func (ps *ManagedPortSocket) Unsubscribe(id uint64) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	if ch, ok := ps.subscribers[id]; ok {
		delete(ps.subscribers, id)
		close(ch)
	}
}

func (ps *ManagedPortSocket) WriteFrame(header, payload []byte) error {
	ps.mu.Lock()
	conn := ps.conn
	ps.mu.Unlock()

	if conn == nil {
		return fmt.Errorf("no connection for port %s", ps.Key)
	}

	_, err := conn.Write(header)
	if err != nil {
		return err
	}
	_, err = conn.Write(payload)
	return err
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

// UpdateWireCondition dynamically updates delay, jitter, and loss parameters on an active wire bridge.
func (nm *NetworkManager) UpdateWireCondition(wireID string, cond model.NetworkCondition) {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	if bridge, exists := nm.bridges[wireID]; exists {
		bridge.Wire.Conditions = cond
		logger.Log.Info("Updated wire network conditions", "wireID", wireID, "delayMs", cond.DelayMs, "jitterMs", cond.JitterMs, "lossPercent", cond.LossPercent)
	}
}

// UpdateWireTZSP dynamically updates or disables TZSP UDP frame mirroring on an active wire bridge.
func (nm *NetworkManager) UpdateWireTZSP(wireID string, tzspTarget string) {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	if bridge, exists := nm.bridges[wireID]; exists {
		bridge.Wire.TZSPTarget = tzspTarget
		logger.Log.Info("Updated wire TZSP target", "wireID", wireID, "target", tzspTarget)
	}
}

// RemoveWireBridge stops and removes an active wire bridge.
func (nm *NetworkManager) RemoveWireBridge(wireID string) {
	nm.mu.Lock()
	defer nm.mu.Unlock()

	if bridge, exists := nm.bridges[wireID]; exists {
		close(bridge.stopChan)
		delete(nm.bridges, wireID)
		logger.Log.Info("Removed managed network wire bridge", "wireID", wireID)
	}
}

func (b *WireBridge) runBridge() {
	subIDA, chA := b.PortA.Subscribe()
	defer b.PortA.Unsubscribe(subIDA)

	subIDB, chB := b.PortB.Subscribe()
	defer b.PortB.Unsubscribe(subIDB)

	defer func() {
		b.tzspMu.Lock()
		if b.tzspConn != nil {
			_ = b.tzspConn.Close()
			b.tzspConn = nil
			b.tzspTarget = ""
		}
		b.tzspMu.Unlock()
	}()

	for {
		select {
		case <-b.stopChan:
			return
		case frameA, ok := <-chA:
			if !ok {
				return
			}
			b.processAndForward(frameA, b.PortB, &b.countSrcToDst)
		case frameB, ok := <-chB:
			if !ok {
				return
			}
			b.processAndForward(frameB, b.PortA, &b.countDstToSrc)
		}
	}
}

func (b *WireBridge) processAndForward(frame EthernetFrame, dst *ManagedPortSocket, dirCounter *int64) {
	pktLen := uint32(len(frame.Payload))

	// 1. Packet Loss Impairment
	lossPct := b.Wire.Conditions.LossPercent
	if lossPct > 0 {
		if rand.Float64()*100.0 < lossPct {
			logger.Log.Debug("Dropped packet due to network condition loss", "wireID", b.Wire.ID, "lossPercent", lossPct)
			return // Drop frame
		}
	}

	// 2. Delay & Jitter Impairment
	delayMs := b.Wire.Conditions.DelayMs
	if b.Wire.Conditions.JitterMs > 0 {
		jit := rand.Intn(2*b.Wire.Conditions.JitterMs+1) - b.Wire.Conditions.JitterMs
		delayMs += jit
		if delayMs < 0 {
			delayMs = 0
		}
	}

	if delayMs > 0 {
		time.Sleep(time.Duration(delayMs) * time.Millisecond)
	}

	atomic.AddInt64(&b.bytesCount, int64(pktLen))
	atomic.AddInt64(&b.packetsCount, 1)
	if dirCounter != nil {
		atomic.AddInt64(dirCounter, 1)
	}

	if b.Wire.TZSPTarget != "" {
		b.sendTZSPFrame(frame.Payload)
	}

	// Write 4-byte header + payload to destination QEMU socket
	_ = dst.WriteFrame(frame.Header, frame.Payload)
}

func (b *WireBridge) sendTZSPFrame(payload []byte) {
	target := b.Wire.TZSPTarget
	if target == "" {
		b.tzspMu.Lock()
		if b.tzspConn != nil {
			_ = b.tzspConn.Close()
			b.tzspConn = nil
			b.tzspTarget = ""
		}
		b.tzspMu.Unlock()
		return
	}

	b.tzspMu.Lock()
	defer b.tzspMu.Unlock()

	if b.tzspConn == nil || b.tzspTarget != target {
		if b.tzspConn != nil {
			_ = b.tzspConn.Close()
			b.tzspConn = nil
		}
		udpAddr, err := net.ResolveUDPAddr("udp", target)
		if err != nil {
			b.tzspTarget = ""
			return
		}
		conn, err := net.DialUDP("udp", nil, udpAddr)
		if err != nil {
			b.tzspTarget = ""
			return
		}
		b.tzspConn = conn
		b.tzspTarget = target
	}

	// TZSP Header: Version 1 (0x01), Type Rx (0x00), Protocol Ethernet (0x0001), Tag End (0x01)
	tzspHeader := []byte{0x01, 0x00, 0x00, 0x01, 0x01}
	packet := append(tzspHeader, payload...)
	_, _ = b.tzspConn.Write(packet)
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
		if ps.readerStop != nil {
			close(ps.readerStop)
			ps.readerStop = nil
		}
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
			WireID:        id,
			Packets100ms:  atomic.LoadInt64(&b.last100msPkt),
			TotalPackets:  atomic.LoadInt64(&b.packetsCount),
			TotalBytes:    atomic.LoadInt64(&b.bytesCount),
			SrcToDst100ms: atomic.LoadInt64(&b.last100msSrcDst),
			DstToSrc100ms: atomic.LoadInt64(&b.last100msDstSrc),
			TZSPActive:    b.Wire.TZSPTarget != "",
		})
	}
	return stats
}
