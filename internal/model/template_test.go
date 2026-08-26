package model

import (
	"testing"
)

func TestSanitizeImageFilename(t *testing.T) {
	validCases := []string{
		"chr-7.21.5.qcow2",
		"debian-13.qcow2",
		"disk.img",
		"routeros.vmdk",
	}

	for _, tc := range validCases {
		clean, err := SanitizeImageFilename(tc)
		if err != nil {
			t.Errorf("SanitizeImageFilename(%q) expected success, got error: %v", tc, err)
		}
		if clean != tc {
			t.Errorf("SanitizeImageFilename(%q) expected %q, got %q", tc, tc, clean)
		}
	}

	invalidPathTraversalCases := []string{
		"../../etc/shadow",
		"../etc/passwd",
		"/etc/passwd",
		"\\Windows\\System32\\config\\SAM",
		"..\\..\\secret.txt",
		".",
		"..",
		"foo/bar.qcow2",
		"   ",
	}

	for _, tc := range invalidPathTraversalCases {
		clean, err := SanitizeImageFilename(tc)
		if err == nil {
			t.Errorf("SanitizeImageFilename(%q) expected error for path traversal attempt, got clean string %q", tc, clean)
		}
	}
}

func TestMachineTemplateGetCleanImageFilename(t *testing.T) {
	tmplValid := &MachineTemplate{
		ID:    "t1",
		Image: "valid-disk.qcow2",
	}
	if tmplValid.GetCleanImageFilename() != "valid-disk.qcow2" {
		t.Errorf("GetCleanImageFilename expected 'valid-disk.qcow2', got %q", tmplValid.GetCleanImageFilename())
	}

	tmplMalicious := &MachineTemplate{
		ID:    "t2",
		Image: "../../etc/shadow",
	}
	if tmplMalicious.GetCleanImageFilename() != "" {
		t.Errorf("GetCleanImageFilename expected empty string for path traversal, got %q", tmplMalicious.GetCleanImageFilename())
	}
}
