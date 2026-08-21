package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

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
}
