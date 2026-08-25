package model

import "encoding/json"

// Message Types - Client to Server
const (
	MsgTypeSubscribeProject = "subscribe_project"
	MsgTypeStartSimulation  = "start_simulation"
	MsgTypeStopSimulation   = "stop_simulation"
	MsgTypeStartNode        = "start_node"
	MsgTypeShutdownNode     = "shutdown_node"
	MsgTypeResetNode        = "reset_node"
	MsgTypeStopNode         = "stop_node"
	MsgTypeRecreateNodeDisk = "recreate_node_disk"
	MsgTypeTerminalInput    = "terminal_input"
	MsgTypeSetWireCondition = "set_wire_condition"
	MsgTypeEnableTZSP       = "enable_tzsp"
	MsgTypeUpdateTopology   = "update_topology"
)

// Message Types - Server to Client
const (
	MsgTypeProjectState     = "project_state"
	MsgTypeNodeStatusChange = "node_status_change"
	MsgTypeWireStats        = "wire_stats"
	MsgTypeTerminalOutput   = "terminal_output"
	MsgTypeErrorEvent       = "error_event"
)

// WSMessage is the top-level envelope for all WebSocket messages.
type WSMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data,omitempty"`
}

// SubscribeProjectPayload payload for subscribing to a project updates.
type SubscribeProjectPayload struct {
	ProjectID string `json:"projectId"`
}

// NodeActionPayload payload for starting/stopping a node.
type NodeActionPayload struct {
	ProjectID string `json:"projectId"`
	NodeID    string `json:"nodeId"`
}

// TerminalInputPayload payload for sending stdin/keys to node serial terminal.
type TerminalInputPayload struct {
	ProjectID string `json:"projectId"`
	NodeID    string `json:"nodeId"`
	Data      string `json:"data"` // string or base64
}

// SetWireConditionPayload payload for updating network conditions on a wire.
type SetWireConditionPayload struct {
	ProjectID   string           `json:"projectId"`
	WireID      string           `json:"wireId"`
	Conditions  NetworkCondition `json:"conditions,omitempty"`
	DelayMs     int              `json:"delayMs,omitempty"`
	JitterMs    int              `json:"jitterMs,omitempty"`
	LossPercent float64          `json:"lossPercent,omitempty"`
}

// GetConditions returns normalized NetworkCondition struct from payload.
func (s *SetWireConditionPayload) GetConditions() NetworkCondition {
	if s.Conditions.DelayMs > 0 || s.Conditions.JitterMs > 0 || s.Conditions.LossPercent > 0 {
		return s.Conditions
	}
	return NetworkCondition{
		DelayMs:     s.DelayMs,
		JitterMs:    s.JitterMs,
		LossPercent: s.LossPercent,
	}
}

// EnableTZSPPayload payload for configuring TZSP forwarding.
type EnableTZSPPayload struct {
	ProjectID string `json:"projectId"`
	WireID    string `json:"wireId"`
	TargetUDP string `json:"targetUdp"` // e.g. "127.0.0.1:37008"
}

// NodeStatusChangePayload sent when node power state changes.
type NodeStatusChangePayload struct {
	NodeID string `json:"nodeId"`
	Status string `json:"status"` // "running", "stopped", "error"
}

// WireStatItem represents 100ms sliding window packet statistics for a single wire.
type WireStatItem struct {
	WireID        string `json:"wireId"`
	Count         int    `json:"count"`
	Bytes         int64  `json:"bytes,omitempty"`
	SrcToDst100ms int64  `json:"srcToDst100ms,omitempty"`
	DstToSrc100ms int64  `json:"dstToSrc100ms,omitempty"`
}

// WireStatsPayload sent every 100ms tick to clients with active traffic stats.
type WireStatsPayload struct {
	Stats []WireStatItem `json:"stats"`
}

// TerminalOutputPayload sent to client for xterm.js rendering.
type TerminalOutputPayload struct {
	NodeID string `json:"nodeId"`
	Data   string `json:"data"`
}

// ErrorPayload sent when an action fails.
type ErrorPayload struct {
	Message string `json:"message"`
	Code    string `json:"code,omitempty"`
}
