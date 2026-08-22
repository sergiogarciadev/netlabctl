package model

// NodePort represents an assigned port on an instantiated node in a topology.
type NodePort struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	MAC        string `json:"mac"`
	NetdevType string `json:"netdevType"`
}

// Node represents an instantiated machine in the simulation canvas.
type Node struct {
	ID         string                 `json:"id"`
	TemplateID string                 `json:"templateId"`
	Name       string                 `json:"name"`
	X          float64                `json:"x"`
	Y          float64                `json:"y"`
	Memory     int                    `json:"memory,omitempty"`
	SMP        int                    `json:"smp,omitempty"`
	Userdata   string                 `json:"userdata,omitempty"`
	Metadata   string                 `json:"metadata,omitempty"`
	Properties map[string]interface{} `json:"properties,omitempty"`
	Ports      []NodePort             `json:"ports"`
}

// NetworkCondition specifies delay, jitter, and loss for a wire.
type NetworkCondition struct {
	DelayMs     int     `json:"delayMs,omitempty"`
	JitterMs    int     `json:"jitterMs,omitempty"`
	LossPercent float64 `json:"lossPercent,omitempty"`
}

// Wire represents an orthogonal connection between two ports.
type Wire struct {
	ID         string           `json:"id"`
	SrcNodeID  string           `json:"srcNodeId"`
	SrcPortID  string           `json:"srcPortId"`
	DstNodeID  string           `json:"dstNodeId"`
	DstPortID  string           `json:"dstPortId"`
	Conditions NetworkCondition `json:"conditions,omitempty"`
	TZSPTarget string           `json:"tzspTarget,omitempty"` // e.g. "127.0.0.1:37008"
}

// Topology represents a simulation project saved in topology.json.
type Topology struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Nodes []Node   `json:"nodes"`
	Wires []Wire   `json:"wires"`
}
