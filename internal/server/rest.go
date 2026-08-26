package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"netlabctl/internal/logger"
	"netlabctl/internal/model"
)

func (s *Server) handleListTemplates(w http.ResponseWriter, r *http.Request) {
	templates, err := s.storage.ListTemplates()
	if err != nil {
		http.Error(w, "Failed to list templates", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(templates)
}

func (s *Server) handleListImages(w http.ResponseWriter, r *http.Request) {
	images, err := s.storage.ListImages()
	if err != nil {
		http.Error(w, "Failed to list images", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(images)
}

func (s *Server) handleUploadImage(w http.ResponseWriter, r *http.Request) {
	// Limit total body size to 2.5 GB (2500 MB) for disk images
	const maxUploadSize = 2500 * 1024 * 1024
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)

	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		// Store up to 32MB in RAM; larger uploads spillover to disk
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			logger.Log.Error("Failed to parse multipart form for image upload", "error", err)
			http.Error(w, "Failed to parse multipart upload form (max 2.5GB limit)", http.StatusBadRequest)
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "Missing file field in form data", http.StatusBadRequest)
			return
		}
		defer file.Close()

		filename := filepath.Base(header.Filename)
		if filename == "" || filename == "." || filename == "/" {
			http.Error(w, "Invalid filename", http.StatusBadRequest)
			return
		}

		if err := s.storage.SaveImage(filename, file); err != nil {
			logger.Log.Error("Failed to save disk image", "filename", filename, "error", err)
			http.Error(w, fmt.Sprintf("Failed to save image: %v", err), http.StatusInternalServerError)
			return
		}

		logger.Log.Info("Disk image uploaded successfully", "filename", filename, "size", header.Size)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"message":  "Disk image uploaded successfully",
			"filename": filename,
			"size":     header.Size,
		})
		return
	}

	http.Error(w, "Content-Type must be multipart/form-data", http.StatusBadRequest)
}

func (s *Server) handleImportTemplate(w http.ResponseWriter, r *http.Request) {
	// Limit total body size to 2.5 GB (2500 MB)
	const maxUploadSize = 2500 * 1024 * 1024
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)

	tmpFile, err := os.CreateTemp("", "netlabctl_upload_*.zip")
	if err != nil {
		logger.Log.Error("Failed to create temporary upload file", "error", err)
		http.Error(w, "Failed to create temporary upload file", http.StatusInternalServerError)
		return
	}
	defer func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpFile.Name())
	}()

	var srcReader io.Reader

	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		// Store up to 32MB in RAM; larger uploads spillover to disk
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			logger.Log.Error("Failed to parse multipart form", "error", err)
			http.Error(w, "Failed to parse multipart upload form (max 2.5GB limit)", http.StatusBadRequest)
			return
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "Missing file field in form data", http.StatusBadRequest)
			return
		}
		defer file.Close()
		srcReader = file
	} else {
		srcReader = r.Body
	}

	copiedBytes, err := io.Copy(tmpFile, srcReader)
	if err != nil {
		logger.Log.Error("Failed to stream upload file to disk", "error", err)
		http.Error(w, fmt.Sprintf("Failed to stream upload: %v", err), http.StatusBadRequest)
		return
	}

	if copiedBytes == 0 {
		http.Error(w, "Uploaded ZIP file is empty", http.StatusBadRequest)
		return
	}

	_ = tmpFile.Close()

	if err := s.storage.ImportTemplateZipFile(tmpFile.Name()); err != nil {
		logger.Log.Error("Failed to import template ZIP archive", "error", err)
		http.Error(w, fmt.Sprintf("Failed to import template: %v", err), http.StatusBadRequest)
		return
	}

	templates, err := s.storage.ListTemplates()
	if err != nil {
		logger.Log.Error("Failed to list templates after import", "error", err)
		http.Error(w, "Template imported but failed to list templates", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":   "Template imported successfully",
		"templates": templates,
	})
}

func (s *Server) handleGetTemplateDrawing(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing template id", http.StatusBadRequest)
		return
	}

	_, tmplDir, err := s.storage.GetTemplate(id)
	if err != nil {
		http.Error(w, "Template not found", http.StatusNotFound)
		return
	}

	svgPath := fmt.Sprintf("%s/drawing.svg", tmplDir)
	http.ServeFile(w, r, svgPath)
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.storage.ListProjects()
	if err != nil {
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
		top.ID = "default"
	}
	if top.Name == "" {
		top.Name = "New Project"
	}

	if err := s.storage.SaveProject(&top); err != nil {
		http.Error(w, "Failed to save project", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
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

	// Clean up directories for nodes that were removed in this topology update
	if oldTop, err := s.storage.GetProject(id); err == nil {
		newNodeIDs := make(map[string]bool)
		for _, n := range top.Nodes {
			newNodeIDs[n.ID] = true
		}
		for _, oldNode := range oldTop.Nodes {
			if !newNodeIDs[oldNode.ID] {
				logger.Log.Info("Removing directory for removed node", "projectID", id, "nodeID", oldNode.ID)
				_ = s.qemuMgr.RemoveNodeDir(id, oldNode.ID)
				s.serialHubs.RemoveHub(id, oldNode.ID)
			}
		}
	}

	if err := s.storage.SaveProject(&top); err != nil {
		logger.Log.Error("Failed to update project", "id", id, "error", err)
		http.Error(w, "Failed to update project", http.StatusInternalServerError)
		return
	}

	// Synchronize Managed Network bridges and QMP monitor set_link states for all nodes/ports
	s.hub.SyncTopologyNetworkAndMonitors(&top)

	// Broadcast updated topology state to all connected WS subscribers
	s.hub.BroadcastToProject(id, model.MsgTypeProjectState, top)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(top)
}

func (s *Server) handleDeleteSingleNode(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	nodeID := r.PathValue("nodeId")
	if projectID == "" || nodeID == "" {
		http.Error(w, "Missing project or node id", http.StatusBadRequest)
		return
	}

	_ = s.qemuMgr.RemoveNodeDir(projectID, nodeID)
	s.serialHubs.RemoveHub(projectID, nodeID)

	top, err := s.storage.GetProject(projectID)
	if err == nil {
		filteredNodes := make([]model.Node, 0, len(top.Nodes))
		for _, n := range top.Nodes {
			if n.ID != nodeID {
				filteredNodes = append(filteredNodes, n)
			}
		}
		top.Nodes = filteredNodes

		filteredWires := make([]model.Wire, 0, len(top.Wires))
		for _, w := range top.Wires {
			if w.SrcNodeID != nodeID && w.DstNodeID != nodeID {
				filteredWires = append(filteredWires, w)
			}
		}
		top.Wires = filteredWires

		_ = s.storage.SaveProject(top)
		s.hub.SyncTopologyNetworkAndMonitors(top)
		s.hub.BroadcastToProject(projectID, model.MsgTypeProjectState, top)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing project id", http.StatusBadRequest)
		return
	}

	// Stop simulation if running
	s.hub.stopProjectSimulation(id)

	if err := s.storage.DeleteProject(id); err != nil {
		logger.Log.Error("Failed to delete project", "id", id, "error", err)
		http.Error(w, "Failed to delete project", http.StatusInternalServerError)
		return
	}

	logger.Log.Info("Deleted project", "id", id)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleCloneProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing project id", http.StatusBadRequest)
		return
	}

	origTop, err := s.storage.GetProject(id)
	if err != nil {
		http.Error(w, "Source project not found", http.StatusNotFound)
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	newID := fmt.Sprintf("proj-%d", time.Now().UnixMilli())
	newName := req.Name
	if newName == "" {
		newName = fmt.Sprintf("%s (Copy)", origTop.Name)
	}

	clonedTop := *origTop
	clonedTop.ID = newID
	clonedTop.Name = newName
	clonedTop.SimulationStatus = "stopped"

	clonedNodes := make([]model.Node, len(origTop.Nodes))
	copy(clonedNodes, origTop.Nodes)
	for i := range clonedNodes {
		clonedNodes[i].Status = "stopped"
		clonedNodes[i].Power = "off"
	}
	clonedTop.Nodes = clonedNodes

	if err := s.storage.SaveProject(&clonedTop); err != nil {
		logger.Log.Error("Failed to save cloned project", "newID", newID, "error", err)
		http.Error(w, "Failed to save cloned project", http.StatusInternalServerError)
		return
	}

	logger.Log.Info("Cloned project successfully", "origID", id, "newID", newID, "name", newName)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(clonedTop)
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

	existingIDs := make(map[string]bool)
	existingNames := make(map[string]bool)
	for _, n := range top.Nodes {
		existingIDs[n.ID] = true
		existingNames[n.Name] = true
	}

	nextNum := 1
	for existingIDs[fmt.Sprintf("node-%d", nextNum)] {
		nextNum++
	}
	nodeID := fmt.Sprintf("node-%d", nextNum)

	nodeName := req.Name
	if nodeName == "" {
		nameNum := 1
		for existingNames[fmt.Sprintf("%s-%d", tmpl.Name, nameNum)] {
			nameNum++
		}
		nodeName = fmt.Sprintf("%s-%d", tmpl.Name, nameNum)
	}

	var ports []model.NodePort
	for i, pt := range tmpl.Ports {
		portType := pt.Type
		if portType == "" {
			portType = "managed"
		}
		driver := pt.Device
		if driver == "" {
			driver = "virtio-net-pci"
		}
		ports = append(ports, model.NodePort{
			ID:           pt.ID,
			Name:         pt.Name,
			MAC:          macs[i],
			Type:         portType,
			NetdevDriver: driver,
			DeviceOpts:   pt.DeviceOpts,
		})
	}

	if req.X == 0 && req.Y == 0 {
		idx := len(top.Nodes)
		req.X = 100 + float64(idx%3)*240
		req.Y = 120 + float64(idx/3)*200
	}

	newNode := model.Node{
		ID:         nodeID,
		TemplateID: tmpl.ID,
		Name:       nodeName,
		X:          req.X,
		Y:          req.Y,
		Memory:     tmpl.Memory,
		SMP:        tmpl.GetSMP(),
		Userdata:   tmpl.Userdata,
		Metadata:   tmpl.Metadata,
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

func (s *Server) handleStartProjectSimulation(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing project id", http.StatusBadRequest)
		return
	}

	logger.Log.Info("REST API: Start project simulation", "id", id)
	s.hub.startProjectSimulation(id)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "running", "projectId": id})
}

func (s *Server) handleStartSingleNode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	nodeID := r.PathValue("nodeId")
	if id == "" || nodeID == "" {
		http.Error(w, "Missing project id or node id", http.StatusBadRequest)
		return
	}

	logger.Log.Info("REST API: Start single node", "id", id, "nodeId", nodeID)
	err := s.hub.startSingleNode(id, nodeID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "running", "nodeId": nodeID})
}

func (s *Server) handleShutdownSingleNode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	nodeID := r.PathValue("nodeId")
	if id == "" || nodeID == "" {
		http.Error(w, "Missing project id or node id", http.StatusBadRequest)
		return
	}

	logger.Log.Info("REST API: Shutdown single node", "id", id, "nodeId", nodeID)
	s.hub.shutdownSingleNode(id, nodeID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "shutting_down", "nodeId": nodeID})
}

func (s *Server) handleResetSingleNode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	nodeID := r.PathValue("nodeId")
	if id == "" || nodeID == "" {
		http.Error(w, "Missing project id or node id", http.StatusBadRequest)
		return
	}

	logger.Log.Info("REST API: Reset single node", "id", id, "nodeId", nodeID)
	s.hub.resetSingleNode(id, nodeID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "resetted", "nodeId": nodeID})
}

func (s *Server) handleStopSingleNode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	nodeID := r.PathValue("nodeId")
	if id == "" || nodeID == "" {
		http.Error(w, "Missing project id or node id", http.StatusBadRequest)
		return
	}

	logger.Log.Info("REST API: Stop single node", "id", id, "nodeId", nodeID)
	s.hub.stopSingleNode(id, nodeID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "stopped", "nodeId": nodeID})
}

func (s *Server) handleRecreateSingleNodeDisk(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	nodeID := r.PathValue("nodeId")
	if id == "" || nodeID == "" {
		http.Error(w, "Missing project id or node id", http.StatusBadRequest)
		return
	}

	logger.Log.Info("REST API: Recreate single node disk", "id", id, "nodeId", nodeID)
	err := s.hub.recreateSingleNodeDisk(id, nodeID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "disk_recreated", "nodeId": nodeID})
}

func (s *Server) handleStopProjectSimulation(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing project id", http.StatusBadRequest)
		return
	}

	logger.Log.Info("REST API: Stop project simulation", "id", id)
	s.hub.stopProjectSimulation(id)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "stopped", "projectId": id})
}
