package qemu

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"netlabctl/internal/logger"
	"netlabctl/internal/model"
)

type NodeInstance struct {
	NodeID          string
	ProjectID       string
	Cmd             *exec.Cmd
	Dir             string
	SerialSockPath  string
	MonitorSockPath string
	IsRunning       bool
}

type Manager struct {
	baseDir   string
	mu        sync.Mutex
	instances map[string]*NodeInstance
}

func NewManager(baseDir string) *Manager {
	return &Manager{
		baseDir:   baseDir,
		instances: make(map[string]*NodeInstance),
	}
}

// NodeDir returns the working directory for a given project node.
func (m *Manager) NodeDir(projectID, nodeID string) string {
	return filepath.Join(m.baseDir, "projects", projectID, "nodes", nodeID)
}

// PrepareNodeDisk creates a differential .qcow2 overlay disk backed by the template's image file.
func (m *Manager) PrepareNodeDisk(projectID string, node *model.Node, tmplDir string, tmpl *model.MachineTemplate) (string, error) {
	nDir := m.NodeDir(projectID, node.ID)
	if err := os.MkdirAll(nDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create node directory: %w", err)
	}

	diskPath := filepath.Join(nDir, "disk.qcow2")

	// If disk already exists, reuse it
	if _, err := os.Stat(diskPath); err == nil {
		return diskPath, nil
	}

	backingFile := ""
	if tmpl != nil && tmpl.Image != "" {
		backingFile = filepath.Join(tmplDir, tmpl.Image)
	}

	qemuImg, err := exec.LookPath("qemu-img")
	if err != nil {
		logger.Log.Warn("qemu-img binary not found on system; creating empty placeholder disk file", "diskPath", diskPath)
		if err := os.WriteFile(diskPath, []byte("QCOW2_PLACEHOLDER"), 0644); err != nil {
			return "", err
		}
		return diskPath, nil
	}

	var args []string
	if backingFile != "" {
		if _, err := os.Stat(backingFile); err == nil {
			args = []string{"create", "-f", "qcow2", "-b", backingFile, "-F", "qcow2", diskPath}
		} else {
			logger.Log.Warn("Template backing image file not found, creating 2G blank qcow2 disk", "backingFile", backingFile)
			args = []string{"create", "-f", "qcow2", diskPath, "2G"}
		}
	} else {
		args = []string{"create", "-f", "qcow2", diskPath, "2G"}
	}

	cmd := exec.Command(qemuImg, args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		logger.Log.Warn("Failed to create qcow2 disk with backing image, falling back to standalone 2G disk", "output", string(out))
		fallbackCmd := exec.Command(qemuImg, "create", "-f", "qcow2", diskPath, "2G")
		if fbOut, fbErr := fallbackCmd.CombinedOutput(); fbErr != nil {
			return "", fmt.Errorf("qemu-img fallback failed: %w (out: %s)", fbErr, string(fbOut))
		}
	}

	logger.Log.Info("Created qcow2 disk for node", "nodeID", node.ID, "diskPath", diskPath)
	return diskPath, nil
}

// StartNode launches a QEMU process for the specified node with managed network sockets and monitor socket.
func (m *Manager) StartNode(projectID string, node *model.Node, tmplDir string, tmpl *model.MachineTemplate, portAddrs map[string]string) (*NodeInstance, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if inst, exists := m.instances[node.ID]; exists && inst.IsRunning {
		return inst, nil
	}

	diskPath, err := m.PrepareNodeDisk(projectID, node, tmplDir, tmpl)
	if err != nil {
		return nil, fmt.Errorf("failed to prepare node disk: %w", err)
	}

	nDir := m.NodeDir(projectID, node.ID)
	serialSock := filepath.Join(nDir, "serial.sock")
	monitorSock := filepath.Join(nDir, "monitor.sock")

	_ = os.Remove(serialSock)  // Remove stale socket
	_ = os.Remove(monitorSock) // Remove stale socket

	sysBinary := "qemu-system-x86_64"
	if tmpl != nil && tmpl.System != "" {
		sysBinary = tmpl.System
	}

	qemuPath, err := exec.LookPath(sysBinary)
	if err != nil {
		logger.Log.Warn("QEMU binary not found; simulating node startup", "binary", sysBinary, "nodeID", node.ID)
		inst := &NodeInstance{
			NodeID:          node.ID,
			ProjectID:       projectID,
			Dir:             nDir,
			SerialSockPath:  serialSock,
			MonitorSockPath: monitorSock,
			IsRunning:       true,
		}
		m.instances[node.ID] = inst
		return inst, nil
	}

	mem := node.Memory
	if mem <= 0 && tmpl != nil {
		mem = tmpl.Memory
	}
	if mem <= 0 {
		mem = 256
	}

	smp := node.SMP
	if smp <= 0 && tmpl != nil {
		smp = tmpl.GetSMP()
	}
	if smp <= 0 {
		smp = 1
	}

	args := []string{
		"-name", node.ID,
		"-m", fmt.Sprintf("%dM", mem),
		"-smp", fmt.Sprintf("%d", smp),
		"-drive", fmt.Sprintf("file=%s,format=qcow2,if=virtio", diskPath),
		"-nographic",
		"-serial", fmt.Sprintf("unix:%s,server,nowait", serialSock),
		"-monitor", fmt.Sprintf("unix:%s,server,nowait", monitorSock),
	}

	if isKVMAvailable() {
		args = append(args, "-enable-kvm")
		logger.Log.Info("Enabled KVM hardware acceleration for QEMU instance", "nodeID", node.ID)
	} else {
		logger.Log.Info("KVM hardware acceleration not available (/dev/kvm), using TCG software emulation", "nodeID", node.ID)
	}

	// Generate Cloud-Init NoCloud ISO if Userdata or Metadata is provided
	isoPath, err := m.createCloudInitISO(nDir, node, tmpl)
	if err != nil {
		logger.Log.Warn("Failed to create NoCloud cloud-init ISO", "nodeID", node.ID, "error", err)
	} else if isoPath != "" {
		args = append(args, "-drive", fmt.Sprintf("file=%s,format=raw,media=cdrom,readonly=on", isoPath))
	}

	// Add managed port netdev sockets for ALL node ports
	for i, port := range node.Ports {
		portKey := fmt.Sprintf("%s:%s", node.ID, port.ID)
		targetAddr, ok := portAddrs[portKey]
		netdevID := fmt.Sprintf("net%d", i)
		devID := fmt.Sprintf("eth%d", i)

		devDriver := port.NetdevDriver
		if devDriver == "" {
			devDriver = "virtio-net-pci"
		}

		if ok && targetAddr != "" {
			args = append(args,
				"-netdev", fmt.Sprintf("socket,id=%s,connect=%s", netdevID, targetAddr),
				"-device", fmt.Sprintf("%s,netdev=%s,mac=%s,id=%s", devDriver, netdevID, port.MAC, devID),
			)
		}
	}

	if tmpl != nil && len(tmpl.Qemu) > 0 {
		args = append(args, tmpl.Qemu...)
	}

	logger.Log.Info("Executing QEMU command", "nodeID", node.ID, "binary", qemuPath, "args", args)

	cmd := exec.Command(qemuPath, args...)
	cmd.Dir = nDir

	logFile, logErr := os.Create(filepath.Join(nDir, "qemu.log"))
	if logErr == nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
	}

	if err := cmd.Start(); err != nil {
		if logFile != nil {
			_ = logFile.Close()
		}
		logger.Log.Error("Failed to start QEMU instance", "nodeID", node.ID, "error", err)
		return nil, fmt.Errorf("failed to start QEMU: %w", err)
	}

	inst := &NodeInstance{
		NodeID:          node.ID,
		ProjectID:       projectID,
		Cmd:             cmd,
		Dir:             nDir,
		SerialSockPath:  serialSock,
		MonitorSockPath: monitorSock,
		IsRunning:       true,
	}

	go func() {
		err := cmd.Wait()
		if logFile != nil {
			_ = logFile.Close()
		}
		m.mu.Lock()
		inst.IsRunning = false
		m.mu.Unlock()

		if err != nil {
			logger.Log.Warn("QEMU process exited with error", "nodeID", node.ID, "error", err)
		} else {
			logger.Log.Info("QEMU process exited cleanly", "nodeID", node.ID)
		}
	}()

	m.instances[node.ID] = inst
	logger.Log.Info("Started QEMU instance for node", "nodeID", node.ID, "pid", cmd.Process.Pid)
	return inst, nil
}

// SetPortLinkStatus connects to the node's QEMU monitor socket and sets link status on/off.
func (m *Manager) SetPortLinkStatus(projectID, nodeID, deviceID string, linkOn bool) error {
	nDir := m.NodeDir(projectID, nodeID)
	monitorSock := filepath.Join(nDir, "monitor.sock")

	conn, err := net.DialTimeout("unix", monitorSock, 2*time.Second)
	if err != nil {
		return fmt.Errorf("failed to dial QEMU monitor socket for node %s: %w", nodeID, err)
	}
	defer conn.Close()

	stateStr := "off"
	if linkOn {
		stateStr = "on"
	}

	cmdStr := fmt.Sprintf("set_link %s %s\n", deviceID, stateStr)
	_, err = conn.Write([]byte(cmdStr))
	if err != nil {
		return fmt.Errorf("failed to send set_link to monitor for %s: %w", deviceID, err)
	}

	logger.Log.Info("Updated QEMU monitor link status", "nodeID", nodeID, "deviceID", deviceID, "linkOn", linkOn)
	return nil
}

// StopNode stops the QEMU process for a given node.
func (m *Manager) StopNode(nodeID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	inst, exists := m.instances[nodeID]
	if !exists || !inst.IsRunning {
		return nil
	}

	if inst.Cmd != nil && inst.Cmd.Process != nil {
		_ = inst.Cmd.Process.Kill()
	}

	inst.IsRunning = false
	delete(m.instances, nodeID)
	logger.Log.Info("Stopped QEMU instance for node", "nodeID", nodeID)
	return nil
}

// StopAllNodes stops all running QEMU instances.
func (m *Manager) StopAllNodes() {
	m.mu.Lock()
	nodes := make([]string, 0, len(m.instances))
	for id := range m.instances {
		nodes = append(nodes, id)
	}
	m.mu.Unlock()

	for _, id := range nodes {
		_ = m.StopNode(id)
	}
}

// GetSerialSocketPath returns the path to a node's serial console UNIX domain socket.
func (m *Manager) GetSerialSocketPath(projectID, nodeID string) string {
	return filepath.Join(m.NodeDir(projectID, nodeID), "serial.sock")
}

// IsNodeRunning checks if a QEMU node process is active.
func (m *Manager) IsNodeRunning(nodeID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	inst, exists := m.instances[nodeID]
	return exists && inst.IsRunning
}

func isKVMAvailable() bool {
	f, err := os.OpenFile("/dev/kvm", os.O_RDWR, 0)
	if err != nil {
		return false
	}
	_ = f.Close()
	return true
}

func renderCloudInitTemplate(tmplStr string, node *model.Node) string {
	if node == nil {
		return tmplStr
	}
	res := strings.ReplaceAll(tmplStr, "${node.id}", node.ID)
	res = strings.ReplaceAll(res, "${node.name}", node.Name)
	res = strings.ReplaceAll(res, "${{{ node.id }}}", node.ID)
	res = strings.ReplaceAll(res, "${{{ node.name }}}", node.Name)
	return res
}

func (m *Manager) createCloudInitISO(nDir string, node *model.Node, tmpl *model.MachineTemplate) (string, error) {
	if node == nil {
		return "", nil
	}
	userdata := node.Userdata
	if userdata == "" && tmpl != nil {
		userdata = tmpl.Userdata
	}
	metadata := node.Metadata
	if metadata == "" && tmpl != nil {
		metadata = tmpl.Metadata
	}

	if strings.TrimSpace(userdata) == "" && strings.TrimSpace(metadata) == "" {
		isoPath := filepath.Join(nDir, "cidata.iso")
		_ = os.Remove(isoPath)
		return "", nil
	}

	if metadata == "" {
		hostName := node.Name
		if hostName == "" {
			hostName = node.ID
		}
		metadata = fmt.Sprintf("instance-id: %s\nlocal-hostname: %s\n", node.ID, hostName)
	}

	userdata = renderCloudInitTemplate(userdata, node)
	metadata = renderCloudInitTemplate(metadata, node)

	tmpDir, err := os.MkdirTemp("", "cidata-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmpDir)

	userDataPath := filepath.Join(tmpDir, "user-data")
	metaDataPath := filepath.Join(tmpDir, "meta-data")

	if err := os.WriteFile(userDataPath, []byte(userdata), 0644); err != nil {
		return "", err
	}
	if err := os.WriteFile(metaDataPath, []byte(metadata), 0644); err != nil {
		return "", err
	}

	isoPath := filepath.Join(nDir, "cidata.iso")

	var cmd *exec.Cmd
	if _, err := exec.LookPath("genisoimage"); err == nil {
		cmd = exec.Command("genisoimage", "-output", isoPath, "-volid", "cidata", "-joliet", "-rock", tmpDir)
	} else if _, err := exec.LookPath("mkisofs"); err == nil {
		cmd = exec.Command("mkisofs", "-output", isoPath, "-volid", "cidata", "-joliet", "-rock", tmpDir)
	} else if _, err := exec.LookPath("xorriso"); err == nil {
		cmd = exec.Command("xorriso", "-as", "mkisofs", "-output", isoPath, "-volid", "cidata", "-joliet", "-rock", tmpDir)
	} else {
		logger.Log.Warn("No ISO generation tool (genisoimage/mkisofs/xorriso) found to build NoCloud cloud-init ISO", "nodeID", node.ID)
		return "", nil
	}

	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to generate cidata.iso: %w (output: %s)", err, string(out))
	}

	logger.Log.Info("Generated NoCloud cloud-init cidata.iso", "nodeID", node.ID, "isoPath", isoPath)
	return isoPath, nil
}
