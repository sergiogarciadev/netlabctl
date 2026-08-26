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
