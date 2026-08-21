package model

import (
	"crypto/rand"
	"fmt"
	"net"
	"sync"
)

// MACRegistry tracks assigned MAC addresses to guarantee uniqueness within a project.
type MACRegistry struct {
	mu   sync.Mutex
	used map[string]bool
}

// NewMACRegistry initializes an empty MAC registry.
func NewMACRegistry() *MACRegistry {
	return &MACRegistry{
		used: make(map[string]bool),
	}
}

// RebuildMACRegistry populates a MACRegistry from an existing Topology.
func RebuildMACRegistry(top *Topology) *MACRegistry {
	reg := NewMACRegistry()
	if top == nil {
		return reg
	}
	for _, node := range top.Nodes {
		for _, port := range node.Ports {
			if port.MAC != "" {
				reg.used[port.MAC] = true
			}
		}
	}
	return reg
}

// Add registers a MAC address, returning false if already present.
func (r *MACRegistry) Add(mac string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.used[mac] {
		return false
	}
	r.used[mac] = true
	return true
}

// Remove unregisters a MAC address.
func (r *MACRegistry) Remove(mac string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.used, mac)
}

// IsUsed returns true if the MAC is already registered.
func (r *MACRegistry) IsUsed(mac string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.used[mac]
}

// GenerateNodeMACs creates portCount MAC addresses for a node.
// First port gets 52:XX:YY:ZZ:AA:BB (0x52 + 5 random bytes).
// Subsequent ports get strictly incrementing MAC addresses.
// Automatically retries if any MAC in the block collides with the registry.
func (r *MACRegistry) GenerateNodeMACs(portCount int) ([]string, error) {
	if portCount <= 0 {
		return nil, nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	const maxAttempts = 1000
	for attempt := 0; attempt < maxAttempts; attempt++ {
		// Generate random 5 bytes
		randBytes := make([]byte, 5)
		if _, err := rand.Read(randBytes); err != nil {
			return nil, fmt.Errorf("failed to generate random bytes for MAC: %w", err)
		}

		// Base MAC bytes: 0x52, rand[0], rand[1], rand[2], rand[3], rand[4]
		baseMAC := []byte{0x52, randBytes[0], randBytes[1], randBytes[2], randBytes[3], randBytes[4]}

		// Check if all portCount sequential MACs are free
		macs := make([]string, portCount)
		collision := false

		for i := 0; i < portCount; i++ {
			macBytes := make([]byte, 6)
			copy(macBytes, baseMAC)

			// Add index i to 48-bit MAC integer
			if err := addOffsetToMAC(macBytes, uint64(i)); err != nil {
				collision = true
				break
			}

			macStr := net.HardwareAddr(macBytes).String()
			if r.used[macStr] {
				collision = true
				break
			}
			macs[i] = macStr
		}

		if !collision {
			// Register all generated MACs
			for _, m := range macs {
				r.used[m] = true
			}
			return macs, nil
		}
	}

	return nil, fmt.Errorf("failed to generate unique MAC block after %d attempts", maxAttempts)
}

func addOffsetToMAC(mac []byte, offset uint64) error {
	var val uint64
	for i := 0; i < 6; i++ {
		val = (val << 8) | uint64(mac[i])
	}

	val += offset

	// Wrap around if exceeds 48-bit range
	val = val & 0xFFFFFFFFFFFF

	for i := 5; i >= 0; i-- {
		mac[i] = byte(val & 0xFF)
		val >>= 8
	}
	return nil
}
