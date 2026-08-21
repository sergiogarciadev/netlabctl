package storage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"netlabctl/internal/model"
)

func TestStorageInitializationAndTemplateLoading(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "netlabctl_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create a sample template with machine.json
	devDir := filepath.Join(tempDir, "devices", "Mikrotik-4port")
	if err := os.MkdirAll(devDir, 0755); err != nil {
		t.Fatalf("Failed to create device dir: %v", err)
	}

	sampleMachine := map[string]interface{}{
		"name":        "Mikrotik-4port",
		"description": "Mikrotik 4 port router",
		"drawing":     "drawing.svg",
		"memory":      64,
		"cores":       1,
		"ports": []map[string]string{
			{"id": "device-port-1", "name": "ether-1", "type": "ethernet"},
			{"id": "device-port-2", "name": "ether-2", "type": "ethernet"},
		},
	}
	data, _ := json.MarshalIndent(sampleMachine, "", "  ")
	_ = os.WriteFile(filepath.Join(devDir, "machine.json"), data, 0644)
	_ = os.WriteFile(filepath.Join(devDir, "drawing.svg"), []byte("<svg></svg>"), 0644)

	s, err := NewStorage(tempDir)
	if err != nil {
		t.Fatalf("NewStorage failed: %v", err)
	}

	templates, err := s.ListTemplates()
	if err != nil {
		t.Fatalf("ListTemplates failed: %v", err)
	}

	if len(templates) != 1 {
		t.Fatalf("Expected 1 template (Mikrotik-4port), got %d", len(templates))
	}

	if templates[0].ID != "Mikrotik-4port" || templates[0].GetSMP() != 1 {
		t.Fatalf("Unexpected template data: %+v", templates[0])
	}

	// Save and retrieve project
	top := &model.Topology{
		ID:   "proj-1",
		Name: "Test Project",
		Nodes: []model.Node{
			{
				ID:         "node-1",
				TemplateID: "Mikrotik-4port",
				Name:       "R1",
				X:          100,
				Y:          150,
			},
		},
	}

	if err := s.SaveProject(top); err != nil {
		t.Fatalf("SaveProject failed: %v", err)
	}

	loadedTop, err := s.GetProject("proj-1")
	if err != nil {
		t.Fatalf("GetProject failed: %v", err)
	}

	if loadedTop.Name != "Test Project" || len(loadedTop.Nodes) != 1 {
		t.Fatalf("Loaded topology mismatch: %+v", loadedTop)
	}
}
