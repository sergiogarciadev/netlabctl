package storage

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"netlabctl/devices"
	"netlabctl/internal/logger"
	"netlabctl/internal/model"
)

// Storage handles local persistence under $HOME/.netlabctl.
type Storage struct {
	baseDir      string
	projectLocks map[string]*sync.RWMutex
	locksMu      sync.Mutex
}

func (s *Storage) getProjectLock(id string) *sync.RWMutex {
	s.locksMu.Lock()
	defer s.locksMu.Unlock()

	if s.projectLocks == nil {
		s.projectLocks = make(map[string]*sync.RWMutex)
	}
	lock, exists := s.projectLocks[id]
	if !exists {
		lock = &sync.RWMutex{}
		s.projectLocks[id] = lock
	}
	return lock
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

	imagesDir := filepath.Join(dir, "images")
	devicesDir := filepath.Join(dir, "devices")
	projectsDir := filepath.Join(dir, "projects")

	if err := os.MkdirAll(imagesDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create images dir: %w", err)
	}
	if err := os.MkdirAll(devicesDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create devices dir: %w", err)
	}
	if err := os.MkdirAll(projectsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create projects dir: %w", err)
	}

	s := &Storage{
		baseDir:      dir,
		projectLocks: make(map[string]*sync.RWMutex),
	}
	s.ensureDefaultTemplates()
	return s, nil
}

// ensureDefaultTemplates unpacks embedded device templates from devices.EmbeddedDevicesFS
// into s.DevicesDir() if the devices directory is empty or missing.
func (s *Storage) ensureDefaultTemplates() {
	devicesDir := s.DevicesDir()
	entries, err := os.ReadDir(devicesDir)
	if err == nil && len(entries) > 0 {
		return
	}

	err = fs.WalkDir(devices.EmbeddedDevicesFS, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == "." || strings.HasSuffix(path, ".go") {
			return nil
		}

		targetPath := filepath.Join(devicesDir, path)

		if d.IsDir() {
			return os.MkdirAll(targetPath, 0755)
		}

		data, err := devices.EmbeddedDevicesFS.ReadFile(path)
		if err != nil {
			return err
		}

		if _, err := os.Stat(targetPath); os.IsNotExist(err) {
			if err := os.WriteFile(targetPath, data, 0644); err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		logger.Log.Error("Failed to unpack embedded device templates", "error", err)
	} else {
		logger.Log.Info("Unpacked embedded device templates to devices directory", "dir", devicesDir)
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

// SanitizeID cleans an identifier and enforces strict path traversal protection.
func SanitizeID(id string) (string, error) {
	if id == "" {
		return "", fmt.Errorf("id cannot be empty")
	}
	clean := filepath.Clean(id)
	if strings.ContainsAny(clean, "/\\:\x00") || strings.HasPrefix(clean, "..") || clean == "." || clean == ".." {
		return "", fmt.Errorf("invalid path traversal characters in id: %q", id)
	}
	base := filepath.Base(clean)
	if base == "." || base == ".." || base == "/" {
		return "", fmt.Errorf("invalid id: %q", id)
	}
	return base, nil
}

// ProjectsDir returns the path to projects directory.
func (s *Storage) ProjectsDir() string {
	return filepath.Join(s.baseDir, "projects")
}

// ProjectDir returns the validated path for a specific project, preventing path traversal.
func (s *Storage) ProjectDir(projectID string) (string, error) {
	cleanID, err := SanitizeID(projectID)
	if err != nil {
		return "", fmt.Errorf("invalid project id %q: %w", projectID, err)
	}

	projectsDir := filepath.Clean(s.ProjectsDir())
	pDir := filepath.Join(projectsDir, cleanID)

	rel, err := filepath.Rel(projectsDir, pDir)
	if err != nil || strings.HasPrefix(rel, "..") || rel == "." {
		return "", fmt.Errorf("path traversal detected in project id %q", projectID)
	}

	return pDir, nil
}

// ListTemplates scans the devices directory and loads machine.json or template.json files.
// ImagesDir returns the dedicated disk images path ($HOME/.netlabctl/images).
func (s *Storage) ImagesDir() string {
	return filepath.Join(s.baseDir, "images")
}

// CheckImageExists checks if the image specified in the template exists in ~/.netlabctl/images or device template folders.
func (s *Storage) CheckImageExists(tmpl *model.MachineTemplate) bool {
	if tmpl == nil {
		return false
	}
	cleanImg := tmpl.GetCleanImageFilename()
	if cleanImg == "" {
		return false
	}

	// 1. Check dedicated images directory (~/.netlabctl/images/<cleanImg>)
	imgPath := filepath.Join(s.ImagesDir(), cleanImg)
	if info, err := os.Stat(imgPath); err == nil && !info.IsDir() && info.Size() > 0 {
		return true
	}

	// 2. Check template device directory (~/.netlabctl/devices/<cleanID>/<cleanImg>)
	if tmpl.ID != "" {
		cleanID, err := model.SanitizeImageFilename(tmpl.ID)
		if err == nil && cleanID != "" {
			deviceImgPath := filepath.Join(s.DevicesDir(), cleanID, cleanImg)
			if info, err := os.Stat(deviceImgPath); err == nil && !info.IsDir() && info.Size() > 0 {
				return true
			}
		}
	}

	// 3. Search across all device directories
	entries, err := os.ReadDir(s.DevicesDir())
	if err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				p := filepath.Join(s.DevicesDir(), entry.Name(), cleanImg)
				if info, err := os.Stat(p); err == nil && !info.IsDir() && info.Size() > 0 {
					return true
				}
			}
		}
	}

	return false
}

// ImageFileInfo holds details of a stored disk image.
type ImageFileInfo struct {
	Filename  string `json:"filename"`
	SizeBytes int64  `json:"sizeBytes"`
	Location  string `json:"location"`
}

// SaveImage writes a disk image file into s.ImagesDir() ($HOME/.netlabctl/images).
func (s *Storage) SaveImage(filename string, r io.Reader) error {
	cleanName, err := model.SanitizeImageFilename(filename)
	if err != nil {
		return fmt.Errorf("invalid filename: %w", err)
	}
	dstPath := filepath.Join(s.ImagesDir(), cleanName)
	out, err := os.Create(dstPath)
	if err != nil {
		return fmt.Errorf("failed to create image file: %w", err)
	}
	defer out.Close()

	if _, err := io.Copy(out, r); err != nil {
		_ = os.Remove(dstPath)
		return fmt.Errorf("failed to write image content: %w", err)
	}
	return nil
}

// ListImages returns disk images found in ~/.netlabctl/images and device directories.
func (s *Storage) ListImages() ([]ImageFileInfo, error) {
	seen := make(map[string]bool)
	var list []ImageFileInfo

	entries, err := os.ReadDir(s.ImagesDir())
	if err == nil {
		for _, entry := range entries {
			if !entry.IsDir() {
				info, err := entry.Info()
				if err == nil {
					seen[entry.Name()] = true
					list = append(list, ImageFileInfo{
						Filename:  entry.Name(),
						SizeBytes: info.Size(),
						Location:  "images",
					})
				}
			}
		}
	}

	devEntries, devErr := os.ReadDir(s.DevicesDir())
	if devErr == nil {
		for _, d := range devEntries {
			if d.IsDir() {
				dPath := filepath.Join(s.DevicesDir(), d.Name())
				files, fErr := os.ReadDir(dPath)
				if fErr == nil {
					for _, f := range files {
						if !f.IsDir() {
							ext := strings.ToLower(filepath.Ext(f.Name()))
							if ext == ".qcow2" || ext == ".img" || ext == ".iso" || ext == ".vmdk" || ext == ".raw" {
								if !seen[f.Name()] {
									seen[f.Name()] = true
									info, iErr := f.Info()
									if iErr == nil {
										list = append(list, ImageFileInfo{
											Filename:  f.Name(),
											SizeBytes: info.Size(),
											Location:  fmt.Sprintf("devices/%s", d.Name()),
										})
									}
								}
							}
						}
					}
				}
			}
		}
	}

	return list, nil
}

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
			tmpl.ImageExists = s.CheckImageExists(tmpl)
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

	if tmpl != nil {
		tmpl.ImageExists = s.CheckImageExists(tmpl)
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
	pDir, err := s.ProjectDir(id)
	if err != nil {
		return nil, err
	}

	lock := s.getProjectLock(id)
	lock.RLock()
	defer lock.RUnlock()

	topPath := filepath.Join(pDir, "topology.json")
	data, err := os.ReadFile(topPath)
	if err != nil {
		return nil, fmt.Errorf("project %s not found: %w", id, err)
	}

	var top model.Topology
	if err := json.Unmarshal(data, &top); err != nil {
		return nil, fmt.Errorf("failed to parse topology.json for project %s: %w", id, err)
	}

	if model.SanitizeTopologyNodeIDs(&top) {
		logger.Log.Warn("Repaired duplicate node IDs in topology", "projectID", id)
		_ = s.saveProjectInternal(&top, pDir)
	}

	return &top, nil
}

// SaveProject writes a project's topology.json.
func (s *Storage) SaveProject(top *model.Topology) error {
	if top == nil || top.ID == "" {
		return fmt.Errorf("topology or project ID cannot be empty")
	}

	pDir, err := s.ProjectDir(top.ID)
	if err != nil {
		return err
	}

	lock := s.getProjectLock(top.ID)
	lock.Lock()
	defer lock.Unlock()

	return s.saveProjectInternal(top, pDir)
}

func (s *Storage) saveProjectInternal(top *model.Topology, pDir string) error {
	if top != nil {
		_ = model.SanitizeTopologyNodeIDs(top)
	}
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
	pDir, err := s.ProjectDir(id)
	if err != nil {
		return err
	}

	lock := s.getProjectLock(id)
	lock.Lock()
	defer lock.Unlock()

	return os.RemoveAll(pDir)
}

// ImportTemplateZipFile extracts a ZIP archive file directly from disk into s.DevicesDir() ($HOME/.netlabctl/devices/).
// Supports large ZIP files (up to 2GB+).
func (s *Storage) ImportTemplateZipFile(zipFilePath string) error {
	zr, err := zip.OpenReader(zipFilePath)
	if err != nil {
		return fmt.Errorf("invalid zip archive: %w", err)
	}
	defer zr.Close()

	devicesDir := filepath.Clean(s.DevicesDir())

	for _, f := range zr.File {
		cleanName := filepath.Clean(f.Name)
		if strings.HasPrefix(cleanName, "..") || strings.Contains(cleanName, ":") {
			continue
		}

		targetPath := filepath.Join(devicesDir, cleanName)
		if !strings.HasPrefix(filepath.Clean(targetPath), devicesDir+string(filepath.Separator)) && filepath.Clean(targetPath) != devicesDir {
			return fmt.Errorf("illegal file path in zip: %s", f.Name)
		}

		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(targetPath, 0755); err != nil {
				return fmt.Errorf("failed to create directory %s: %w", targetPath, err)
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
			return fmt.Errorf("failed to create parent directory for %s: %w", targetPath, err)
		}

		rc, err := f.Open()
		if err != nil {
			return fmt.Errorf("failed to open zip entry %s: %w", f.Name, err)
		}

		outFile, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			_ = rc.Close()
			return fmt.Errorf("failed to create target file %s: %w", targetPath, err)
		}

		_, err = io.Copy(outFile, rc)
		_ = outFile.Close()
		_ = rc.Close()
		if err != nil {
			return fmt.Errorf("failed to extract zip entry %s: %w", targetPath, err)
		}
	}

	logger.Log.Info("Successfully imported device template ZIP archive into devices directory", "devicesDir", devicesDir)
	return nil
}

// ImportTemplateZip extracts an in-memory ZIP byte slice into s.DevicesDir() ($HOME/.netlabctl/devices/).
func (s *Storage) ImportTemplateZip(zipData []byte) error {
	tmpFile, err := os.CreateTemp("", "netlabctl_zip_*.zip")
	if err != nil {
		return fmt.Errorf("failed to create temporary zip file: %w", err)
	}
	defer func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpFile.Name())
	}()

	if _, err := tmpFile.Write(zipData); err != nil {
		return fmt.Errorf("failed to write temporary zip data: %w", err)
	}
	_ = tmpFile.Close()

	return s.ImportTemplateZipFile(tmpFile.Name())
}
