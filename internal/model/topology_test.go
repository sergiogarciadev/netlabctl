package model

import (
	"testing"
)

func TestSanitizeTopologyNodeIDs(t *testing.T) {
	top := &Topology{
		ID: "test-proj",
		Nodes: []Node{
			{ID: "node-2", Name: "Node A"},
			{ID: "node-2", Name: "Node B"},
			{ID: "node-2", Name: "Node C"},
		},
		Wires: []Wire{
			{ID: "wire-1", SrcNodeID: "node-2", DstNodeID: "node-2"},
		},
	}

	repaired := SanitizeTopologyNodeIDs(top)
	if !repaired {
		t.Fatalf("Expected SanitizeTopologyNodeIDs to return true for duplicate IDs")
	}

	seen := make(map[string]bool)
	for _, n := range top.Nodes {
		if seen[n.ID] {
			t.Fatalf("Duplicate ID found after sanitization: %s", n.ID)
		}
		seen[n.ID] = true
	}

	if len(top.Nodes) != 3 {
		t.Fatalf("Expected 3 nodes, got %d", len(top.Nodes))
	}
}
