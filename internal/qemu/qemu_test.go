package qemu

import (
	"os"
	"path/filepath"
	"testing"

	"netlabctl/internal/model"
)

func TestPrepareNodeDiskFailsWithoutBackingImage(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "netlabctl_qemu_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	mgr := NewManager(tempDir)
	node := &model.Node{
		ID:         "node-1",
		TemplateID: "no-disk-tmpl",
	}

	tmplNoImage := &model.MachineTemplate{
		ID:   "no-disk-tmpl",
		Name: "Template Without Image",
	}

	// Should fail because template specifies no image
	_, err = mgr.PrepareNodeDisk("proj-1", node, filepath.Join(tempDir, "devices", "no-disk-tmpl"), tmplNoImage)
	if err == nil {
		t.Fatalf("PrepareNodeDisk expected error when backing image is missing, got nil")
	}

	tmplMissingImageFile := &model.MachineTemplate{
		ID:    "missing-disk-tmpl",
		Name:  "Template With Missing File",
		Image: "nonexistent.qcow2",
	}

	// Should fail because image file does not exist on disk
	_, err = mgr.PrepareNodeDisk("proj-1", node, filepath.Join(tempDir, "devices", "missing-disk-tmpl"), tmplMissingImageFile)
	if err == nil {
		t.Fatalf("PrepareNodeDisk expected error when disk image file is missing on disk, got nil")
	}
}

func TestPrepareNodeDiskRejectsPathTraversal(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "netlabctl_qemu_traversal_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	mgr := NewManager(tempDir)
	node := &model.Node{
		ID:         "node-malicious",
		TemplateID: "malicious-tmpl",
	}

	tmplMalicious := &model.MachineTemplate{
		ID:    "malicious-tmpl",
		Name:  "Malicious Path Traversal Template",
		Image: "../../etc/shadow",
	}

	_, err = mgr.PrepareNodeDisk("proj-1", node, filepath.Join(tempDir, "devices", "malicious-tmpl"), tmplMalicious)
	if err == nil {
		t.Fatalf("PrepareNodeDisk expected failure for path traversal image filename, got nil")
	}
}

func TestRenderCloudInitTemplate(t *testing.T) {
	node := &model.Node{
		ID:     "router-1",
		Name:   "Core-Router",
		Memory: 256,
		SMP:    2,
		Ports: []model.NodePort{
			{ID: "port-0", Name: "eth0", MAC: "52:54:00:12:34:56"},
			{ID: "port-1", Name: "eth1", MAC: "52:54:00:12:34:57"},
		},
	}

	tmpl := "hostname: {{{ node.name }}}\nid: {{{node.id}}}\nmac: {{{ port0.mac }}}\nmac1: {{{ node.ports[1].mac }}}\nmem: {{{ node.memory }}}MB\nsmp: {{{ node.smp }}}\nignored: ${node.name} and {node.id}"
	rendered := renderCloudInitTemplate(tmpl, node)

	expected := "hostname: Core-Router\nid: router-1\nmac: 52:54:00:12:34:56\nmac1: 52:54:00:12:34:57\nmem: 256MB\nsmp: 2\nignored: ${node.name} and {node.id}"
	if rendered != expected {
		t.Fatalf("renderCloudInitTemplate mismatch.\nExpected:\n%s\nGot:\n%s", expected, rendered)
	}
}
