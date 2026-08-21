package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"netlabctl/internal/model"
	"netlabctl/internal/storage"
)

func TestRESTEndpoints(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "netlabctl_server_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create sample device Mikrotik-4port
	devDir := filepath.Join(tempDir, "devices", "Mikrotik-4port")
	if err := os.MkdirAll(devDir, 0755); err != nil {
		t.Fatalf("Failed to create dev dir: %v", err)
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
			{"id": "device-port-3", "name": "ether-3", "type": "ethernet"},
			{"id": "device-port-4", "name": "ether-4", "type": "ethernet"},
		},
	}
	data, _ := json.MarshalIndent(sampleMachine, "", "  ")
	_ = os.WriteFile(filepath.Join(devDir, "machine.json"), data, 0644)
	_ = os.WriteFile(filepath.Join(devDir, "drawing.svg"), []byte("<svg></svg>"), 0644)

	store, err := storage.NewStorage(tempDir)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}

	srv := NewServer(":0", store)
	router := srv.Router()

	// Test GET /api/templates
	req := httptest.NewRequest("GET", "/api/templates", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/templates returned status %d, expected 200", rec.Code)
	}

	// Test GET /api/templates/Mikrotik-4port/drawing
	reqDraw := httptest.NewRequest("GET", "/api/templates/Mikrotik-4port/drawing", nil)
	recDraw := httptest.NewRecorder()
	router.ServeHTTP(recDraw, reqDraw)

	if recDraw.Code != http.StatusOK {
		t.Fatalf("GET /api/templates/Mikrotik-4port/drawing returned status %d, expected 200", recDraw.Code)
	}
	if recDraw.Header().Get("Content-Type") != "image/svg+xml" {
		t.Fatalf("Expected Content-Type image/svg+xml, got %s", recDraw.Header().Get("Content-Type"))
	}

	// Test POST /api/projects/proj-test/nodes
	addNodeBody := map[string]interface{}{
		"templateId": "Mikrotik-4port",
		"name":       "Router-1",
		"x":          150,
		"y":          200,
	}
	bodyBytes, _ := json.Marshal(addNodeBody)
	reqNode := httptest.NewRequest("POST", "/api/projects/proj-test/nodes", bytes.NewReader(bodyBytes))
	recNode := httptest.NewRecorder()
	router.ServeHTTP(recNode, reqNode)

	if recNode.Code != http.StatusCreated {
		t.Fatalf("POST node returned status %d, expected 201. Body: %s", recNode.Code, recNode.Body.String())
	}

	var createdNode model.Node
	if err := json.Unmarshal(recNode.Body.Bytes(), &createdNode); err != nil {
		t.Fatalf("Failed to unmarshal created node: %v", err)
	}

	if len(createdNode.Ports) != 4 {
		t.Fatalf("Expected 4 ports on created Mikrotik-4port node, got %d", len(createdNode.Ports))
	}

	// Verify MAC starts with 52:
	for _, port := range createdNode.Ports {
		if !strings.HasPrefix(port.MAC, "52:") {
			t.Errorf("Port MAC %s does not start with 52:", port.MAC)
		}
	}
}
