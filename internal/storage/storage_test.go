package storage

import (
	"os"
	"path/filepath"
	"testing"

	"netlabctl/internal/model"
)

func TestStorageInitialization(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "netlabctl_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	s, err := NewStorage(tempDir)
	if err != nil {
		t.Fatalf("NewStorage failed: %v", err)
	}

	templates, err := s.ListTemplates()
	if err != nil {
		t.Fatalf("ListTemplates failed: %v", err)
	}

	if len(templates) != 2 {
		t.Fatalf("Expected 2 initial sample templates, got %d", len(templates))
	}

	// Save and retrieve project
	top := &model.Topology{
		ID:   "proj-1",
		Name: "Test Project",
		Nodes: []model.Node{
			{
				ID:         "node-1",
				TemplateID: "linux-router",
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

	// Verify project folder contains topology.json
	topFile := filepath.Join(tempDir, "projects", "proj-1", "topology.json")
	if _, err := os.Stat(topFile); os.IsNotExist(err) {
		t.Fatalf("topology.json file was not created at %s", topFile)
	}
}
