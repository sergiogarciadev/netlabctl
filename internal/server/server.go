package server

import (
	"net/http"
	"path/filepath"

	"netlabctl/internal/logger"
	"netlabctl/internal/network"
	"netlabctl/internal/qemu"
	"netlabctl/internal/storage"
)

// Server encapsulates the HTTP server, REST handlers, and WebSocket hub.
type Server struct {
	addr    string
	storage *storage.Storage
	qemuMgr *qemu.Manager
	netMgr  *network.NetworkManager
	hub     *WSHub
	mux     *http.ServeMux
}

// NewServer initializes a new netlabctl HTTP and WS server instance.
func NewServer(addr string, store *storage.Storage) *Server {
	qemuMgr := qemu.NewManager(store.BaseDir())
	netMgr := network.NewNetworkManager()

	s := &Server{
		addr:    addr,
		storage: store,
		qemuMgr: qemuMgr,
		netMgr:  netMgr,
		hub:     NewWSHub(store, qemuMgr, netMgr),
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
	s.mux.HandleFunc("POST /api/projects/{id}/nodes", s.handleAddNode)
	s.mux.HandleFunc("POST /api/projects/{id}/start", s.handleStartProjectSimulation)
	s.mux.HandleFunc("POST /api/projects/{id}/stop", s.handleStopProjectSimulation)

	// WebSocket Endpoints
	s.mux.HandleFunc("/ws", s.handleWS)
	s.mux.HandleFunc("/api/v1/projects/{id}/nodes/{nodeId}/terminal", s.handleNodeTerminal)

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
