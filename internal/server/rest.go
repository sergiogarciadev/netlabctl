package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"netlabctl/internal/logger"
	"netlabctl/internal/model"
)

func (s *Server) handleListTemplates(w http.ResponseWriter, r *http.Request) {
	templates, err := s.storage.ListTemplates()
	if err != nil {
		logger.Log.Error("Failed to list templates", "error", err)
		http.Error(w, "Failed to list templates", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(templates)
}

func (s *Server) handleGetTemplateDrawing(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing template id", http.StatusBadRequest)
		return
	}

	tmpl, dirPath, err := s.storage.GetTemplate(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	svgPath := filepath.Join(dirPath, tmpl.Drawing)
	svgData, err := os.ReadFile(svgPath)
	if err != nil {
		logger.Log.Error("Failed to read template SVG", "path", svgPath, "error", err)
		http.Error(w, "SVG not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "image/svg+xml")
	w.Write(svgData)
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.storage.ListProjects()
	if err != nil {
		logger.Log.Error("Failed to list projects", "error", err)
		http.Error(w, "Failed to list projects", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(projects)
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var top model.Topology
	if err := json.NewDecoder(r.Body).Decode(&top); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if top.ID == "" {
		top.ID = fmt.Sprintf("proj-%d", os.Getpid())
	}
	if top.Name == "" {
		top.Name = "New Network Lab"
	}

	if err := s.storage.SaveProject(&top); err != nil {
		logger.Log.Error("Failed to save project", "id", top.ID, "error", err)
		http.Error(w, "Failed to save project", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(top)
}

func (s *Server) handleGetProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing project id", http.StatusBadRequest)
		return
	}

	top, err := s.storage.GetProject(id)
	if err != nil {
		http.Error(w, "Project not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(top)
}

func (s *Server) handleUpdateProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing project id", http.StatusBadRequest)
		return
	}

	var top model.Topology
	if err := json.NewDecoder(r.Body).Decode(&top); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	top.ID = id
	if err := s.storage.SaveProject(&top); err != nil {
		logger.Log.Error("Failed to update project", "id", id, "error", err)
		http.Error(w, "Failed to update project", http.StatusInternalServerError)
		return
	}

	// Broadcast updated topology state to all connected WS subscribers
	s.hub.BroadcastToProject(id, model.MsgTypeProjectState, top)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(top)
}

type AddNodeRequest struct {
	TemplateID string  `json:"templateId"`
	Name       string  `json:"name,omitempty"`
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
}

func (s *Server) handleAddNode(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	if projectID == "" {
		http.Error(w, "Missing project id", http.StatusBadRequest)
		return
	}

	var req AddNodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	top, err := s.storage.GetProject(projectID)
	if err != nil {
		// Auto-create default project if not found
		top = &model.Topology{ID: projectID, Name: "Simulation Lab"}
	}

	tmpl, _, err := s.storage.GetTemplate(req.TemplateID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Template %s not found", req.TemplateID), http.StatusBadRequest)
		return
	}

	// Rebuild MAC registry to ensure uniqueness
	reg := model.RebuildMACRegistry(top)
	macs, err := reg.GenerateNodeMACs(len(tmpl.Ports))
	if err != nil {
		logger.Log.Error("Failed to generate MACs for new node", "error", err)
		http.Error(w, "Failed to generate MAC addresses", http.StatusInternalServerError)
		return
	}

	nodeID := fmt.Sprintf("node-%d", len(top.Nodes)+1)
	nodeName := req.Name
	if nodeName == "" {
		nodeName = fmt.Sprintf("%s-%d", tmpl.Name, len(top.Nodes)+1)
	}

	var ports []model.NodePort
	for i, pt := range tmpl.Ports {
		ports = append(ports, model.NodePort{
			ID:         pt.ID,
			Name:       pt.Name,
			MAC:        macs[i],
			NetdevType: pt.Type,
		})
	}

	newNode := model.Node{
		ID:         nodeID,
		TemplateID: tmpl.ID,
		Name:       nodeName,
		X:          req.X,
		Y:          req.Y,
		Ports:      ports,
	}

	top.Nodes = append(top.Nodes, newNode)

	if err := s.storage.SaveProject(top); err != nil {
		logger.Log.Error("Failed to save project with new node", "error", err)
		http.Error(w, "Failed to save project", http.StatusInternalServerError)
		return
	}

	// Broadcast topology update
	s.hub.BroadcastToProject(projectID, model.MsgTypeProjectState, top)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(newNode)
}
