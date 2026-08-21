import {
  Cable,
  MousePointer,
  Network,
  Play,
  Plus,
  Square,
  Terminal as TerminalIcon,
} from "lucide-react";

export function Toolbar({
  projectName,
  isRunning,
  activeTool,
  onSelectTool,
  onStart,
  onStop,
  onAddDevice,
  selectedNode,
  onOpenTerminal,
}) {
  return (
    <div className="toolbar">
      <div className="toolbar-brand">
        <Network size={22} className="text-blue-500" />
        <span>netlabctl</span>
        <span style={{ fontSize: "0.8rem", opacity: 0.6, marginLeft: "6px" }}>
          / {projectName || "Untitled Lab"}
        </span>
      </div>

      <div
        className="toolbar-tools"
        style={{
          display: "flex",
          gap: "4px",
          background: "var(--bg-card)",
          padding: "3px",
          borderRadius: "8px",
          border: "1px solid var(--border-color)",
        }}
      >
        <button
          type="button"
          className={`btn ${activeTool === "select" ? "btn-primary" : ""}`}
          style={{ padding: "4px 10px", fontSize: "0.8rem" }}
          onClick={() => onSelectTool("select")}
          title="Select Mode (Pointer & Drag)"
        >
          <MousePointer size={14} /> Select
        </button>
        <button
          type="button"
          className={`btn ${activeTool === "wire" ? "btn-primary" : ""}`}
          style={{ padding: "4px 10px", fontSize: "0.8rem" }}
          onClick={() => onSelectTool("wire")}
          title="Wire Mode (Connect Ports)"
        >
          <Cable size={14} /> Wire
        </button>
      </div>

      <div className="toolbar-controls">
        {!isRunning ? (
          <button type="button" className="btn btn-success" onClick={onStart}>
            <Play size={16} /> Start Lab
          </button>
        ) : (
          <button type="button" className="btn btn-danger" onClick={onStop}>
            <Square size={16} /> Stop Lab
          </button>
        )}

        <button type="button" className="btn btn-primary" onClick={onAddDevice}>
          <Plus size={16} /> Add Device
        </button>

        {selectedNode && (
          <button type="button" className="btn" onClick={() => onOpenTerminal(selectedNode)}>
            <TerminalIcon size={16} /> Serial Console ({selectedNode.name})
          </button>
        )}
      </div>
    </div>
  );
}
