package server

import (
	"embed"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"netlabctl/internal/logger"
	"netlabctl/internal/network"
	"netlabctl/internal/qemu"
	"netlabctl/internal/storage"
)

//go:embed all:dist
var embeddedClientDist embed.FS

// Server encapsulates the HTTP server, REST handlers, and WebSocket hub.
type Server struct {
	addr       string
	storage    *storage.Storage
	qemuMgr    *qemu.Manager
	netMgr     *network.NetworkManager
	hub        *WSHub
	serialHubs *SerialHubManager
	mux        *http.ServeMux
}

// NewServer initializes a new netlabctl HTTP and WS server instance.
func NewServer(addr string, store *storage.Storage) *Server {
	qemuMgr := qemu.NewManager(store.BaseDir())
	netMgr := network.NewNetworkManager()

	s := &Server{
		addr:       addr,
		storage:    store,
		qemuMgr:    qemuMgr,
		netMgr:     netMgr,
		hub:        NewWSHub(store, qemuMgr, netMgr),
		serialHubs: NewSerialHubManager(),
		mux:        http.NewServeMux(),
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
	s.mux.HandleFunc("DELETE /api/projects/{id}", s.handleDeleteProject)
	s.mux.HandleFunc("POST /api/projects/{id}/clone", s.handleCloneProject)
	s.mux.HandleFunc("POST /api/projects/{id}/nodes", s.handleAddNode)
	s.mux.HandleFunc("POST /api/projects/{id}/start", s.handleStartProjectSimulation)
	s.mux.HandleFunc("POST /api/projects/{id}/stop", s.handleStopProjectSimulation)
	s.mux.HandleFunc("POST /api/projects/{id}/nodes/{nodeId}/start", s.handleStartSingleNode)
	s.mux.HandleFunc("POST /api/projects/{id}/nodes/{nodeId}/shutdown", s.handleShutdownSingleNode)
	s.mux.HandleFunc("POST /api/projects/{id}/nodes/{nodeId}/reset", s.handleResetSingleNode)
	s.mux.HandleFunc("POST /api/projects/{id}/nodes/{nodeId}/stop", s.handleStopSingleNode)

	// WebSocket Endpoints
	s.mux.HandleFunc("/ws", s.handleWS)
	s.mux.HandleFunc("/api/v1/projects/{id}/nodes/{nodeId}/terminal", s.handleNodeTerminal)

	// Single-binary distribution: Serve embedded client/dist with disk fallback for dev mode
	var staticFS http.FileSystem

	distSubFS, err := fs.Sub(embeddedClientDist, "dist")
	if err == nil {
		if _, err := distSubFS.Open("index.html"); err == nil {
			staticFS = http.FS(distSubFS)
			logger.Log.Info("Serving frontend client SPA from embedded single-binary FS")
		}
	}

	if staticFS == nil {
		clientDistDir := filepath.Join(s.storage.BaseDir(), "..", "client", "dist")
		if _, err := os.Stat(clientDistDir); err == nil {
			staticFS = http.Dir(clientDistDir)
			logger.Log.Info("Serving frontend client SPA from local filesystem directory", "path", clientDistDir)
		}
	}

	if staticFS != nil {
		fileServer := http.FileServer(staticFS)
		s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			path := strings.TrimPrefix(r.URL.Path, "/")
			if path == "" {
				path = "index.html"
			}
			f, err := staticFS.Open(path)
			if err == nil {
				_ = f.Close()
				fileServer.ServeHTTP(w, r)
				return
			}
			// SPA fallback: return index.html for unknown frontend routes
			r.URL.Path = "/"
			fileServer.ServeHTTP(w, r)
		})
	}
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
