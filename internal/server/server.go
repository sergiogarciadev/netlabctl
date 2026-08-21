package server

import (
	"net/http"
	"path/filepath"

	"netlabctl/internal/logger"
	"netlabctl/internal/storage"
)

// Server encapsulates the HTTP server, REST handlers, and WebSocket hub.
type Server struct {
	addr    string
	storage *storage.Storage
	hub     *WSHub
	mux     *http.ServeMux
}

// NewServer initializes a new netlabctl HTTP and WS server instance.
func NewServer(addr string, store *storage.Storage) *Server {
	s := &Server{
		addr:    addr,
		storage: store,
		hub:     NewWSHub(store),
		mux:     http.NewServeMux(),
	}

	s.routes()
	return s
}

func (s *Server) routes() {
	// REST API Endpoints
	s.mux.HandleFunc("GET /api/templates", s.handleListTemplates)
	s.mux.HandleFunc("GET /api/templates/{id}/drawing", s.handleGetTemplateDrawing)
	s.mux.HandleFunc("GET /api/projects", s.handleListProjects)
	s.mux.HandleFunc("POST /api/projects", s.handleCreateProject)
	s.mux.HandleFunc("GET /api/projects/{id}", s.handleGetProject)
	s.mux.HandleFunc("PUT /api/projects/{id}", s.handleUpdateProject)

	// WebSocket Endpoint
	s.mux.HandleFunc("/ws", s.handleWS)

	// Static client file server (if client dist directory exists)
	clientDist := filepath.Join(s.storage.BaseDir(), "..", "client", "dist")
	s.mux.Handle("/", http.FileServer(http.Dir(clientDist)))
}

// Start launches the HTTP server listening on configured address.
func (s *Server) Start() error {
	go s.hub.Run()

	logger.Log.Info("Starting netlabctl server", "addr", s.addr)
	return http.ListenAndServe(s.addr, s.mux)
}

// Router returns the underlying http.Handler for testing.
func (s *Server) Router() http.Handler {
	return s.mux
}
