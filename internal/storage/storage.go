package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"netlabctl/internal/model"
)

// Storage handles local persistence under $HOME/.netlabctl.
type Storage struct {
	baseDir string
}

// NewStorage initializes storage and creates initial directories and sample templates.
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

	if err := s.seedInitialTemplates(); err != nil {
		return nil, fmt.Errorf("failed to seed initial templates: %w", err)
	}

	return s, nil
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

// ListTemplates scans the devices directory and loads all template.json files.
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
		tPath := filepath.Join(devicesDir, entry.Name(), "template.json")
		if _, err := os.Stat(tPath); err != nil {
			continue
		}
		data, err := os.ReadFile(tPath)
		if err != nil {
			continue
		}
		var tmpl model.MachineTemplate
		if err := json.Unmarshal(data, &tmpl); err != nil {
			continue
		}
		templates = append(templates, tmpl)
	}

	return templates, nil
}

// GetTemplate loads a single template and returns the template struct and its directory path.
func (s *Storage) GetTemplate(id string) (*model.MachineTemplate, string, error) {
	tmplDir := filepath.Join(s.DevicesDir(), id)
	tPath := filepath.Join(tmplDir, "template.json")

	data, err := os.ReadFile(tPath)
	if err != nil {
		return nil, "", fmt.Errorf("template %s not found: %w", id, err)
	}

	var tmpl model.MachineTemplate
	if err := json.Unmarshal(data, &tmpl); err != nil {
		return nil, "", fmt.Errorf("invalid template json for %s: %w", id, err)
	}

	return &tmpl, tmplDir, nil
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

// seedInitialTemplates creates linux-router and alpine-host if devices dir has no templates.
func (s *Storage) seedInitialTemplates() error {
	devicesDir := s.DevicesDir()

	// Linux Router Sample
	routerDir := filepath.Join(devicesDir, "linux-router")
	if _, err := os.Stat(routerDir); os.IsNotExist(err) {
		if err := os.MkdirAll(routerDir, 0755); err != nil {
			return err
		}
		routerTmpl := model.MachineTemplate{
			ID:          "linux-router",
			Name:        "Linux Router",
			Description: "High-performance Linux Router template with 4 managed network interfaces.",
			Drawing:     "router.svg",
			System:      "qemu-system-x86_64",
			Memory:      512,
			SMP:         1,
			Ports: []model.PortTemplate{
				{ID: "port-eth0", Name: "eth0", Type: "managed"},
				{ID: "port-eth1", Name: "eth1", Type: "managed"},
				{ID: "port-eth2", Name: "eth2", Type: "managed"},
				{ID: "port-eth3", Name: "eth3", Type: "managed"},
			},
			Status: []model.StatusTemplate{
				{ID: "status-power", Type: "power"},
				{ID: "status-name", Type: "name"},
			},
		}
		data, _ := json.MarshalIndent(routerTmpl, "", "  ")
		_ = os.WriteFile(filepath.Join(routerDir, "template.json"), data, 0644)
		_ = os.WriteFile(filepath.Join(routerDir, "router.svg"), []byte(sampleSVG("router")), 0644)
	}

	// Alpine Host Sample
	alpineDir := filepath.Join(devicesDir, "alpine-host")
	if _, err := os.Stat(alpineDir); os.IsNotExist(err) {
		if err := os.MkdirAll(alpineDir, 0755); err != nil {
			return err
		}
		alpineTmpl := model.MachineTemplate{
			ID:          "alpine-host",
			Name:        "Alpine Host",
			Description: "Lightweight Alpine Linux host with 2 network interfaces.",
			Drawing:     "alpine.svg",
			System:      "qemu-system-x86_64",
			Memory:      256,
			SMP:         1,
			Ports: []model.PortTemplate{
				{ID: "port-eth0", Name: "eth0", Type: "managed"},
				{ID: "port-eth1", Name: "eth1", Type: "managed"},
			},
			Status: []model.StatusTemplate{
				{ID: "status-power", Type: "power"},
				{ID: "status-name", Type: "name"},
			},
		}
		data, _ := json.MarshalIndent(alpineTmpl, "", "  ")
		_ = os.WriteFile(filepath.Join(alpineDir, "template.json"), data, 0644)
		_ = os.WriteFile(filepath.Join(alpineDir, "alpine.svg"), []byte(sampleSVG("alpine")), 0644)
	}

	return nil
}

func sampleSVG(kind string) string {
	if kind == "router" {
		return `<svg width="120" height="80" xmlns="http://www.w3.org/2000/svg">
  <rect x="5" y="5" width="110" height="70" rx="8" ry="8" fill="#1e293b" stroke="#3b82f6" stroke-width="2"/>
  <text id="status-name" x="60" y="25" fill="#f8fafc" font-size="12" font-weight="bold" text-anchor="middle">Router</text>
  <circle id="status-power" cx="100" cy="18" r="4" class="off" fill="#ef4444"/>
  <circle id="port-eth0" cx="20" cy="65" r="5" class="disconnected" fill="#64748b" stroke="#0f172a" stroke-width="1.5"/>
  <circle id="port-eth1" cx="45" cy="65" r="5" class="disconnected" fill="#64748b" stroke="#0f172a" stroke-width="1.5"/>
  <circle id="port-eth2" cx="70" cy="65" r="5" class="disconnected" fill="#64748b" stroke="#0f172a" stroke-width="1.5"/>
  <circle id="port-eth3" cx="95" cy="65" r="5" class="disconnected" fill="#64748b" stroke="#0f172a" stroke-width="1.5"/>
</svg>`
	}
	return `<svg width="100" height="80" xmlns="http://www.w3.org/2000/svg">
  <rect x="5" y="5" width="90" height="70" rx="6" ry="6" fill="#0f172a" stroke="#10b981" stroke-width="2"/>
  <text id="status-name" x="50" y="25" fill="#f8fafc" font-size="12" font-weight="bold" text-anchor="middle">Alpine</text>
  <circle id="status-power" cx="82" cy="18" r="4" class="off" fill="#ef4444"/>
  <circle id="port-eth0" cx="30" cy="65" r="5" class="disconnected" fill="#64748b" stroke="#0f172a" stroke-width="1.5"/>
  <circle id="port-eth1" cx="70" cy="65" r="5" class="disconnected" fill="#64748b" stroke="#0f172a" stroke-width="1.5"/>
</svg>`
}
