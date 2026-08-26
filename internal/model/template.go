package model

import (
	"encoding/json"
	"strings"
)

// PortTemplate defines a network interface port in a machine template.
type PortTemplate struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Type       string `json:"type"` // "managed", "ethernet", "user", "tap", etc.
	Netdev     string `json:"netdev,omitempty"`
	Device     string `json:"device,omitempty"`
	DeviceOpts string `json:"device_opts,omitempty"`
}

// StatusTemplate defines an SVG element indicator for machine status.
type StatusTemplate struct {
	ID   string `json:"id"`
	Type string `json:"type,omitempty"`
	Name string `json:"name,omitempty"` // Alternative key for status type
}

// GetStatusType returns the normalized status type ("name" or "power").
func (s *StatusTemplate) GetStatusType() string {
	if s.Type != "" {
		return s.Type
	}
	return s.Name
}

// MachineTemplate represents the device definition loaded from JSON.
type MachineTemplate struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Drawing     string           `json:"drawing"`
	System      string           `json:"system,omitempty"`
	Memory      int              `json:"memory"`
	SMP         int              `json:"smp,omitempty"`
	Cores       int              `json:"cores,omitempty"`
	CPU         string           `json:"cpu,omitempty"`
	Image       string           `json:"image,omitempty"`
	ImageExists bool             `json:"imageExists"`
	Userdata    string           `json:"userdata,omitempty"`
	Metadata    string           `json:"metadata,omitempty"`
	Ports       []PortTemplate   `json:"ports"`
	Status      []StatusTemplate `json:"status"`
	Qemu        []string         `json:"qemu,omitempty"`
	QEMUArgs    json.RawMessage  `json:"qemu_args,omitempty"`
}

// GetSMP returns SMP cores count (or Cores fallback).
func (m *MachineTemplate) GetSMP() int {
	if m.SMP > 0 {
		return m.SMP
	}
	if m.Cores > 0 {
		return m.Cores
	}
	return 1
}

// GetQEMUArgs returns normalized custom extra QEMU command line arguments.
func (m *MachineTemplate) GetQEMUArgs() []string {
	if len(m.Qemu) > 0 {
		return m.Qemu
	}
	if len(m.QEMUArgs) == 0 {
		return nil
	}
	var arr []string
	if err := json.Unmarshal(m.QEMUArgs, &arr); err == nil {
		return arr
	}
	var str string
	if err := json.Unmarshal(m.QEMUArgs, &str); err == nil && str != "" {
		return strings.Fields(str)
	}
	return nil
}
