package server

import (
	"encoding/json"
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
		http.Error(w, "Project ID is required", http.StatusBadRequest)
		return
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(top)
}
