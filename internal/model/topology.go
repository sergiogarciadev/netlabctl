package model

import "fmt"

// NodePort represents an assigned port on an instantiated node in a topology.
type NodePort struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	MAC          string `json:"mac"`
	Type         string `json:"type,omitempty"`         // "managed", "user", "bridge", "tap"
	NetdevDriver string `json:"netdevDriver,omitempty"` // QEMU device model e.g. "virtio-net-pci", "e1000"
	HostFwd      string `json:"hostFwd,omitempty"`      // e.g. "tcp::2222-:22"
	BridgeIf     string `json:"bridgeIf,omitempty"`     // e.g. "br0"
	TapIf        string `json:"tapIf,omitempty"`        // e.g. "tap0"
}

// Node represents an instantiated machine in the simulation canvas.
type Node struct {
	ID         string                 `json:"id"`
	TemplateID string                 `json:"templateId"`
	Name       string                 `json:"name"`
	Status     string                 `json:"status,omitempty"` // "running", "stopped", "error"
	Power      string                 `json:"power,omitempty"`  // "on", "off"
	AutoStart  *bool                  `json:"autoStart,omitempty"`
	X          float64                `json:"x"`
	Y          float64                `json:"y"`
	Memory     int                    `json:"memory,omitempty"`
	SMP        int                    `json:"smp,omitempty"`
	Userdata   string                 `json:"userdata,omitempty"`
	Metadata   string                 `json:"metadata,omitempty"`
	Properties map[string]interface{} `json:"properties,omitempty"`
	Ports      []NodePort             `json:"ports"`
}

// NetworkCondition specifies delay, jitter, and loss for a wire.
type NetworkCondition struct {
	DelayMs     int     `json:"delayMs,omitempty"`
	JitterMs    int     `json:"jitterMs,omitempty"`
	LossPercent float64 `json:"lossPercent,omitempty"`
}

// Wire represents an orthogonal connection between two ports.
type Wire struct {
	ID         string           `json:"id"`
	SrcNodeID  string           `json:"srcNodeId"`
	SrcPortID  string           `json:"srcPortId"`
	DstNodeID  string           `json:"dstNodeId"`
	DstPortID  string           `json:"dstPortId"`
	Conditions NetworkCondition `json:"conditions,omitempty"`
	TZSPTarget string           `json:"tzspTarget,omitempty"` // e.g. "127.0.0.1:37008"
}

// Topology represents a simulation project saved in topology.json.
type Topology struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	SimulationStatus string `json:"simulationStatus,omitempty"` // "running", "stopped"
	Nodes            []Node `json:"nodes"`
	Wires            []Wire `json:"wires"`
}

// SanitizeTopologyNodeIDs checks for duplicate node IDs in a topology and assigns unique IDs to duplicates.
// It returns true if any duplicate node IDs were found and repaired.
func SanitizeTopologyNodeIDs(top *Topology) bool {
	if top == nil || len(top.Nodes) == 0 {
		return false
	}

	seenIDs := make(map[string]bool)
	repaired := false

	for i := range top.Nodes {
		node := &top.Nodes[i]
		if node.ID == "" || seenIDs[node.ID] {
			repaired = true
			oldID := node.ID

			nextNum := 1
			for {
				candidate := fmt.Sprintf("node-%d", nextNum)
				if !seenIDs[candidate] {
					conflict := false
					for j := range top.Nodes {
						if j != i && top.Nodes[j].ID == candidate {
							conflict = true
							break
						}
					}
					if !conflict {
						node.ID = candidate
						break
					}
				}
				nextNum++
			}

			if oldID != "" {
				for wIdx := range top.Wires {
					if top.Wires[wIdx].SrcNodeID == oldID {
						top.Wires[wIdx].SrcNodeID = node.ID
					}
					if top.Wires[wIdx].DstNodeID == oldID {
						top.Wires[wIdx].DstNodeID = node.ID
					}
				}
			}
		}
		seenIDs[node.ID] = true
	}

	return repaired
}
