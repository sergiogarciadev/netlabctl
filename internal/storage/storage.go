package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"netlabctl/internal/logger"
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

	s := &Storage{baseDir: dir}
	s.ensureDefaultTemplates()
	return s, nil
}

// ensureDefaultTemplates seeds Mikrotik-4port and Mikrotik-8port templates if devices directory is empty.
func (s *Storage) ensureDefaultTemplates() {
	entries, err := os.ReadDir(s.DevicesDir())
	if err == nil && len(entries) > 0 {
		return
	}

	m4Dir := filepath.Join(s.DevicesDir(), "Mikrotik-4port")
	if _, err := os.Stat(m4Dir); os.IsNotExist(err) {
		_ = os.MkdirAll(m4Dir, 0755)
		m4Json := `{
  "id": "Mikrotik-4port",
  "name": "Mikrotik Router (4-Port)",
  "description": "Mikrotik RouterOS 4-port VM",
  "drawing": "drawing.svg",
  "system": "qemu-system-x86_64",
  "memory": 256,
  "smp": 1,
  "ports": [
    { "id": "device-port-1", "name": "ether1", "type": "managed" },
    { "id": "device-port-2", "name": "ether2", "type": "managed" },
    { "id": "device-port-3", "name": "ether3", "type": "managed" },
    { "id": "device-port-4", "name": "ether4", "type": "managed" }
  ],
  "status": [
    { "id": "status-power", "type": "power" },
    { "id": "status-name", "type": "name" }
  ]
}`
		m4Svg := `<svg width="120" height="50" viewBox="0 0 120 50" xmlns="http://www.w3.org/2000/svg">
  <rect width="120" height="50" rx="4" fill="#ffffff" stroke="#000000" stroke-width="1.5"/>
  <text id="device-name" x="10" y="16" font-family="sans-serif" font-size="11" font-weight="bold" fill="#000000">MikroTik</text>
  <text id="status-name" x="10" y="27" font-family="sans-serif" font-size="7" fill="#333333">Mikrotik-4port</text>
  <circle id="status-power" cx="110" cy="11" r="4" fill="#ff0000"/>
  <g id="device-port-1" transform="translate(13, 30)"><rect width="18" height="15" fill="#4d4d4d" stroke="#cccccc" stroke-width="1"/></g>
  <g id="device-port-2" transform="translate(38, 30)"><rect width="18" height="15" fill="#4d4d4d" stroke="#cccccc" stroke-width="1"/></g>
  <g id="device-port-3" transform="translate(63, 30)"><rect width="18" height="15" fill="#4d4d4d" stroke="#cccccc" stroke-width="1"/></g>
  <g id="device-port-4" transform="translate(88, 30)"><rect width="18" height="15" fill="#4d4d4d" stroke="#cccccc" stroke-width="1"/></g>
</svg>`
		_ = os.WriteFile(filepath.Join(m4Dir, "machine.json"), []byte(m4Json), 0644)
		_ = os.WriteFile(filepath.Join(m4Dir, "drawing.svg"), []byte(m4Svg), 0644)
		logger.Log.Info("Seeded default template Mikrotik-4port")
	}

	m8Dir := filepath.Join(s.DevicesDir(), "Mikrotik-8port")
	if _, err := os.Stat(m8Dir); os.IsNotExist(err) {
		_ = os.MkdirAll(m8Dir, 0755)
		m8Json := `{
  "id": "Mikrotik-8port",
  "name": "Mikrotik Router (8-Port)",
  "description": "Mikrotik RouterOS 8-port VM",
  "drawing": "drawing.svg",
  "system": "qemu-system-x86_64",
  "memory": 256,
  "smp": 1,
  "ports": [
    { "id": "device-port-1", "name": "ether1", "type": "managed" },
    { "id": "device-port-2", "name": "ether2", "type": "managed" },
    { "id": "device-port-3", "name": "ether3", "type": "managed" },
    { "id": "device-port-4", "name": "ether4", "type": "managed" },
    { "id": "device-port-5", "name": "ether5", "type": "managed" },
    { "id": "device-port-6", "name": "ether6", "type": "managed" },
    { "id": "device-port-7", "name": "ether7", "type": "managed" },
    { "id": "device-port-8", "name": "ether8", "type": "managed" }
  ],
  "status": [
    { "id": "status-power", "type": "power" },
    { "id": "status-name", "type": "name" }
  ]
}`
		m8Svg := `<svg width="215" height="50" viewBox="0 0 215 50" xmlns="http://www.w3.org/2000/svg">
  <rect width="215" height="50" rx="4" fill="#ffffff" stroke="#000000" stroke-width="1.5"/>
  <text id="device-name" x="10" y="16" font-family="sans-serif" font-size="11" font-weight="bold" fill="#000000">MikroTik</text>
  <text id="status-name" x="10" y="27" font-family="sans-serif" font-size="7" fill="#333333">Mikrotik-8port</text>
  <circle id="status-power" cx="205" cy="11" r="4" fill="#ff0000"/>
  <g id="device-port-1" transform="translate(13, 30)"><rect width="18" height="15" fill="#4d4d4d" stroke="#cccccc" stroke-width="1"/></g>
  <g id="device-port-2" transform="translate(38, 30)"><rect width="18" height="15" fill="#4d4d4d" stroke="#cccccc" stroke-width="1"/></g>
  <g id="device-port-3" transform="translate(63, 30)"><rect width="18" height="15" fill="#4d4d4d" stroke="#cccccc" stroke-width="1"/></g>
  <g id="device-port-4" transform="translate(88, 30)"><rect width="18" height="15" fill="#4d4d4d" stroke="#cccccc" stroke-width="1"/></g>
  <g id="device-port-5" transform="translate(113, 30)"><rect width="18" height="15" fill="#4d4d4d" stroke="#cccccc" stroke-width="1"/></g>
  <g id="device-port-6" transform="translate(138, 30)"><rect width="18" height="15" fill="#4d4d4d" stroke="#cccccc" stroke-width="1"/></g>
  <g id="device-port-7" transform="translate(163, 30)"><rect width="18" height="15" fill="#4d4d4d" stroke="#cccccc" stroke-width="1"/></g>
  <g id="device-port-8" transform="translate(188, 30)"><rect width="18" height="15" fill="#4d4d4d" stroke="#cccccc" stroke-width="1"/></g>
</svg>`
		_ = os.WriteFile(filepath.Join(m8Dir, "machine.json"), []byte(m8Json), 0644)
		_ = os.WriteFile(filepath.Join(m8Dir, "drawing.svg"), []byte(m8Svg), 0644)
		logger.Log.Info("Seeded default template Mikrotik-8port")
	}
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
	devicesDir := filepath.Clean(s.DevicesDir())
	cleanedID := filepath.Clean(id)
	tmplDir := filepath.Join(devicesDir, cleanedID)

	rel, err := filepath.Rel(devicesDir, tmplDir)
	if err != nil || strings.HasPrefix(rel, "..") {
		return nil, "", fmt.Errorf("invalid template id: %s", id)
	}

	if _, err := os.Stat(tmplDir); os.IsNotExist(err) {
		// Try case-insensitive search for directory name
		entries, _ := os.ReadDir(devicesDir)
		for _, entry := range entries {
			if entry.IsDir() && strings.EqualFold(entry.Name(), cleanedID) {
				tmplDir = filepath.Join(devicesDir, entry.Name())
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

// DeleteProject removes a project directory and all its files.
func (s *Storage) DeleteProject(id string) error {
	pDir := s.ProjectDir(id)
	return os.RemoveAll(pDir)
}
