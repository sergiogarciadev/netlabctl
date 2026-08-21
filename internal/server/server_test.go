package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
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

	// Test GET /api/templates/linux-router/drawing
	reqDraw := httptest.NewRequest("GET", "/api/templates/linux-router/drawing", nil)
	recDraw := httptest.NewRecorder()
	router.ServeHTTP(recDraw, reqDraw)

	if recDraw.Code != http.StatusOK {
		t.Fatalf("GET /api/templates/linux-router/drawing returned status %d, expected 200", recDraw.Code)
	}
	if recDraw.Header().Get("Content-Type") != "image/svg+xml" {
		t.Fatalf("Expected Content-Type image/svg+xml, got %s", recDraw.Header().Get("Content-Type"))
	}

	// Test POST /api/projects/proj-test/nodes
	addNodeBody := map[string]interface{}{
		"templateId": "linux-router",
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
		t.Fatalf("Expected 4 ports on created linux-router node, got %d", len(createdNode.Ports))
	}

	// Verify MAC starts with 52:
	for _, port := range createdNode.Ports {
		if !strings.HasPrefix(port.MAC, "52:") {
			t.Errorf("Port MAC %s does not start with 52:", port.MAC)
		}
	}
}
