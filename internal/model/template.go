package model

// PortTemplate defines a network interface port in a machine template.
type PortTemplate struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Type   string `json:"type"`   // "managed", "user", "tap", etc.
	Netdev string `json:"netdev,omitempty"`
	Device string `json:"device,omitempty"`
}

// StatusTemplate defines an SVG element indicator for machine status.
type StatusTemplate struct {
	ID   string `json:"id"`   // SVG element ID
	Type string `json:"type"` // "name" or "power"
}

// MachineTemplate represents the device definition loaded from JSON.
type MachineTemplate struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Drawing     string           `json:"drawing"`
	System      string           `json:"system"`
	Memory      int              `json:"memory"`
	SMP         int              `json:"smp"`
	CPU         string           `json:"cpu,omitempty"`
	Userdata    string           `json:"userdata,omitempty"`
	Metadata    string           `json:"metadata,omitempty"`
	Ports       []PortTemplate   `json:"ports"`
	Status      []StatusTemplate `json:"status"`
	Qemu        []string         `json:"qemu,omitempty"`
}
