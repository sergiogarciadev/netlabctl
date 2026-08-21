package model

import (
	"strings"
	"testing"
)

func TestMACGeneration(t *testing.T) {
	reg := NewMACRegistry()

	macs, err := reg.GenerateNodeMACs(4)
	if err != nil {
		t.Fatalf("Failed to generate MACs: %v", err)
	}

	if len(macs) != 4 {
		t.Fatalf("Expected 4 MACs, got %d", len(macs))
	}

	// First byte must be 52
	for i, mac := range macs {
		if !strings.HasPrefix(mac, "52:") {
			t.Errorf("MAC %d (%s) does not start with 52:", i, mac)
		}
		if !reg.IsUsed(mac) {
			t.Errorf("MAC %s should be marked as used in registry", mac)
		}
	}

	// Generate MACs for another node and check no collision
	macs2, err := reg.GenerateNodeMACs(2)
	if err != nil {
		t.Fatalf("Failed to generate second MAC set: %v", err)
	}

	for _, m := range macs2 {
		for _, mOrig := range macs {
			if m == mOrig {
				t.Errorf("Collision detected: %s was generated twice", m)
			}
		}
	}
}

func TestRebuildMACRegistry(t *testing.T) {
	top := &Topology{
		Nodes: []Node{
			{
				Ports: []NodePort{
					{MAC: "52:11:22:33:44:55"},
					{MAC: "52:11:22:33:44:56"},
				},
			},
		},
	}

	reg := RebuildMACRegistry(top)
	if !reg.IsUsed("52:11:22:33:44:55") {
		t.Errorf("Expected 52:11:22:33:44:55 to be registered")
	}
	if !reg.IsUsed("52:11:22:33:44:56") {
		t.Errorf("Expected 52:11:22:33:44:56 to be registered")
	}
	if reg.IsUsed("52:11:22:33:44:57") {
		t.Errorf("Did not expect 52:11:22:33:44:57 to be registered")
	}
}
