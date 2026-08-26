package storage

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
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

func TestImportTemplateZip(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "netlabctl_zip_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	s, err := NewStorage(tempDir)
	if err != nil {
		t.Fatalf("NewStorage failed: %v", err)
	}

	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)

	f1, _ := zw.Create("Cisco-Custom/machine.json")
	_, _ = f1.Write([]byte(`{"id":"Cisco-Custom","name":"Cisco Custom Router"}`))

	f2, _ := zw.Create("Cisco-Custom/drawing.svg")
	_, _ = f2.Write([]byte(`<svg></svg>`))

	_ = zw.Close()

	if err := s.ImportTemplateZip(buf.Bytes()); err != nil {
		t.Fatalf("ImportTemplateZip failed: %v", err)
	}

	tmpls, err := s.ListTemplates()
	if err != nil {
		t.Fatalf("ListTemplates failed: %v", err)
	}

	found := false
	for _, tmpl := range tmpls {
		if tmpl.ID == "Cisco-Custom" {
			found = true
			break
		}
	}

	if !found {
		t.Fatalf("Expected imported template Cisco-Custom in template list")
	}
}

func TestConcurrentProjectAccess(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "netlabctl_concurrent_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	s, err := NewStorage(tempDir)
	if err != nil {
		t.Fatalf("NewStorage failed: %v", err)
	}

	top := &model.Topology{
		ID:   "concurrent-proj",
		Name: "Concurrent Test Project",
	}
	if err := s.SaveProject(top); err != nil {
		t.Fatalf("Initial SaveProject failed: %v", err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(2)
		go func(idx int) {
			defer wg.Done()
			_, _ = s.GetProject("concurrent-proj")
		}(i)
		go func(idx int) {
			defer wg.Done()
			_ = s.SaveProject(&model.Topology{
				ID:   "concurrent-proj",
				Name: fmt.Sprintf("Concurrent Test Project %d", idx),
			})
		}(i)
	}
	wg.Wait()
}

func TestPathTraversalProtection(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "netlabctl_traversal_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	s, err := NewStorage(tempDir)
	if err != nil {
		t.Fatalf("NewStorage failed: %v", err)
	}

	invalidIDs := []string{
		"../foo",
		"../../etc/passwd",
		"/etc/passwd",
		"foo/bar",
		"foo\\bar",
		"..",
		".",
	}

	for _, id := range invalidIDs {
		if _, err := s.GetProject(id); err == nil {
			t.Errorf("GetProject expected error for path traversal ID %q, got nil", id)
		}

		if err := s.SaveProject(&model.Topology{ID: id, Name: "Bad"}); err == nil {
			t.Errorf("SaveProject expected error for path traversal ID %q, got nil", id)
		}

		if err := s.DeleteProject(id); err == nil {
			t.Errorf("DeleteProject expected error for path traversal ID %q, got nil", id)
		}

		if _, _, err := s.GetTemplate(id); err == nil {
			t.Errorf("GetTemplate expected error for path traversal ID %q, got nil", id)
		}
	}
}

func TestStorageImageManagement(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "netlabctl_images_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	s, err := NewStorage(tempDir)
	if err != nil {
		t.Fatalf("NewStorage failed: %v", err)
	}

	tmplNoImage := &model.MachineTemplate{ID: "t1", Name: "No Image"}
	if s.CheckImageExists(tmplNoImage) {
		t.Errorf("CheckImageExists returned true for template with no image specified")
	}

	tmplWithMissing := &model.MachineTemplate{ID: "t2", Name: "Missing Image", Image: "missing.qcow2"}
	if s.CheckImageExists(tmplWithMissing) {
		t.Errorf("CheckImageExists returned true for non-existent image file")
	}

	// Save an image to ~/.netlabctl/images
	imgData := []byte("FAKE_QCOW2_DATA_CONTENT")
	if err := s.SaveImage("chr-7.21.5.qcow2", bytes.NewReader(imgData)); err != nil {
		t.Fatalf("SaveImage failed: %v", err)
	}

	tmplWithImage := &model.MachineTemplate{ID: "t3", Name: "Valid Image", Image: "chr-7.21.5.qcow2"}
	if !s.CheckImageExists(tmplWithImage) {
		t.Errorf("CheckImageExists returned false for existing image in images dir")
	}

	images, err := s.ListImages()
	if err != nil {
		t.Fatalf("ListImages failed: %v", err)
	}
	if len(images) != 1 || images[0].Filename != "chr-7.21.5.qcow2" {
		t.Fatalf("ListImages returned unexpected result: %+v", images)
	}
}
