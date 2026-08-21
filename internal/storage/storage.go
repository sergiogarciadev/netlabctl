package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"netlabctl/internal/model"
)

// Storage handles local persistence under $HOME/.netlabctl.
type Storage struct {
	baseDir string
}

// NewStorage initializes storage using custom path or $HOME/.netlabctl.
func NewStorage(customDir string) (*Storage, error) {
	dir := customDir
	if dir == "" {
		dir = os.Getenv("NETLABCTL_DIR")
	}
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("failed to get user home dir: %w", err)
		}
		dir = filepath.Join(home, ".netlabctl")
	}

	devicesDir := filepath.Join(dir, "devices")
	projectsDir := filepath.Join(dir, "projects")

	if err := os.MkdirAll(devicesDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create devices dir: %w", err)
	}
	if err := os.MkdirAll(projectsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create projects dir: %w", err)
	}

	return &Storage{baseDir: dir}, nil
}

// BaseDir returns the root storage path.
func (s *Storage) BaseDir() string {
	return s.baseDir
}

// DevicesDir returns the path to device templates.
func (s *Storage) DevicesDir() string {
	return filepath.Join(s.baseDir, "devices")
}

// ProjectsDir returns the path to projects directory.
func (s *Storage) ProjectsDir() string {
	return filepath.Join(s.baseDir, "projects")
}

// ProjectDir returns the path for a specific project.
func (s *Storage) ProjectDir(projectID string) string {
	return filepath.Join(s.ProjectsDir(), projectID)
}

// ListTemplates scans the devices directory and loads machine.json or template.json files.
func (s *Storage) ListTemplates() ([]model.MachineTemplate, error) {
	devicesDir := s.DevicesDir()
	entries, err := os.ReadDir(devicesDir)
	if err != nil {
		return nil, err
	}

	var templates []model.MachineTemplate
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dirPath := filepath.Join(devicesDir, entry.Name())
		tmpl, err := loadTemplateFromDir(entry.Name(), dirPath)
		if err == nil && tmpl != nil {
			templates = append(templates, *tmpl)
		}
	}

	return templates, nil
}

// GetTemplate loads a single template and returns the template struct and its directory path.
func (s *Storage) GetTemplate(id string) (*model.MachineTemplate, string, error) {
	tmplDir := filepath.Join(s.DevicesDir(), id)
	if _, err := os.Stat(tmplDir); os.IsNotExist(err) {
		// Try case-insensitive search for directory name
		entries, _ := os.ReadDir(s.DevicesDir())
		for _, entry := range entries {
			if entry.IsDir() && strings.EqualFold(entry.Name(), id) {
				tmplDir = filepath.Join(s.DevicesDir(), entry.Name())
				break
			}
		}
	}

	tmpl, err := loadTemplateFromDir(id, tmplDir)
	if err != nil {
		return nil, "", fmt.Errorf("template %s not found: %w", id, err)
	}

	return tmpl, tmplDir, nil
}

// loadTemplateFromDir finds machine.json, template.json, or any .json file in the device directory.
func loadTemplateFromDir(folderName string, dirPath string) (*model.MachineTemplate, error) {
	files, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, err
	}

	var jsonFile string
	for _, f := range files {
		if f.IsDir() {
			continue
		}
		name := strings.ToLower(f.Name())
		if name == "machine.json" || name == "template.json" {
			jsonFile = filepath.Join(dirPath, f.Name())
			break
		}
		if strings.HasSuffix(name, ".json") && jsonFile == "" {
			jsonFile = filepath.Join(dirPath, f.Name())
		}
	}

	if jsonFile == "" {
		return nil, fmt.Errorf("no json template file found in %s", dirPath)
	}

	data, err := os.ReadFile(jsonFile)
	if err != nil {
		return nil, err
	}

	var tmpl model.MachineTemplate
	if err := json.Unmarshal(data, &tmpl); err != nil {
		return nil, fmt.Errorf("invalid json in %s: %w", jsonFile, err)
	}

	if tmpl.ID == "" {
		tmpl.ID = folderName
	}
	if tmpl.Name == "" {
		tmpl.Name = folderName
	}
	if tmpl.Drawing == "" {
		tmpl.Drawing = "drawing.svg"
	}

	return &tmpl, nil
}

// ListProjects loads all topology.json files in the projects folder.
func (s *Storage) ListProjects() ([]model.Topology, error) {
	projDir := s.ProjectsDir()
	entries, err := os.ReadDir(projDir)
	if err != nil {
		return nil, err
	}

	var projects []model.Topology
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		topPath := filepath.Join(projDir, entry.Name(), "topology.json")
		if _, err := os.Stat(topPath); err != nil {
			continue
		}
		data, err := os.ReadFile(topPath)
		if err != nil {
			continue
		}
		var top model.Topology
		if err := json.Unmarshal(data, &top); err != nil {
			continue
		}
		projects = append(projects, top)
	}

	return projects, nil
}

// GetProject loads a project's topology.json.
func (s *Storage) GetProject(id string) (*model.Topology, error) {
	topPath := filepath.Join(s.ProjectDir(id), "topology.json")
	data, err := os.ReadFile(topPath)
	if err != nil {
		return nil, fmt.Errorf("project %s not found: %w", id, err)
	}

	var top model.Topology
	if err := json.Unmarshal(data, &top); err != nil {
		return nil, fmt.Errorf("failed to parse topology.json for project %s: %w", id, err)
	}

	return &top, nil
}

// SaveProject writes a project's topology.json.
func (s *Storage) SaveProject(top *model.Topology) error {
	pDir := s.ProjectDir(top.ID)
	if err := os.MkdirAll(pDir, 0755); err != nil {
		return fmt.Errorf("failed to create project dir: %w", err)
	}

	data, err := json.MarshalIndent(top, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal topology: %w", err)
	}

	topPath := filepath.Join(pDir, "topology.json")
	return os.WriteFile(topPath, data, 0644)
}
