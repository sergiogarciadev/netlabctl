import {
  Cable,
  Copy,
  Download,
  Edit2,
  FolderPlus,
  MousePointer,
  Network,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Settings,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Upload,
} from "lucide-react";

export function Toolbar({
  projectName,
  projects,
  currentProjectId,
  onSwitchProject,
  onCreateProject,
  onRenameProject,
  onCloneProject,
  onImportProject,
  onExportProject,
  onDeleteProject,
  isRunning,
  activeTool,
  onSelectTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onStart,
  onStop,
  onAddDevice,
  nodes = [],
  onJumpToNode,
  selectedNode,
  onOpenTerminal,
  onOpenSettings,
}) {
  return (
    <div className="toolbar">
      <div className="toolbar-brand" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <Network size={22} className="text-blue-500" />
        <span style={{ fontWeight: 700 }}>netlabctl</span>

        {/* Multi-Project Lab Switcher & Management */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "10px" }}>
          <select
            value={currentProjectId || "default"}
            onChange={(e) => onSwitchProject(e.target.value)}
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-color)",
              color: "#38bdf8",
              borderRadius: "6px",
              padding: "3px 8px",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
            title="Switch Active Lab / Project"
          >
            {projects && projects.length > 0 ? (
              projects.map((p) => (
                <option key={p.id} value={p.id}>
                  📁 {p.name || p.id}
                </option>
              ))
            ) : (
              <option value={currentProjectId || "default"}>
                📁 {projectName || "Untitled Lab"}
              </option>
            )}
          </select>

          <button
            type="button"
            className="btn"
            style={{ padding: "4px 8px", fontSize: "0.75rem" }}
            onClick={onRenameProject}
            title="Rename Active Lab Project"
          >
            <Edit2 size={13} /> Rename
          </button>

          <button
            type="button"
            className="btn"
            style={{ padding: "4px 8px", fontSize: "0.75rem" }}
            onClick={onCreateProject}
            title="Create New Lab Project"
          >
            <FolderPlus size={13} /> New
          </button>

          <button
            type="button"
            className="btn"
            style={{ padding: "4px 8px", fontSize: "0.75rem" }}
            onClick={onCloneProject}
            title="Clone Current Lab"
          >
            <Copy size={13} /> Clone
          </button>

          <button
            type="button"
            className="btn"
            style={{ padding: "4px 8px", fontSize: "0.75rem" }}
            onClick={onImportProject}
            title="Import Topology JSON File"
          >
            <Upload size={13} /> Import
          </button>

          <button
            type="button"
            className="btn"
            style={{ padding: "4px 8px", fontSize: "0.75rem" }}
            onClick={onExportProject}
            title="Export Lab Topology JSON File"
          >
            <Download size={13} /> Export
          </button>

          <button
            type="button"
            className="btn"
            style={{
              padding: "4px 8px",
              fontSize: "0.75rem",
              color: projects?.length <= 1 ? "var(--text-muted)" : "#ef4444",
              opacity: projects?.length <= 1 ? 0.5 : 1,
            }}
            disabled={projects?.length <= 1}
            onClick={onDeleteProject}
            title="Delete Current Lab"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
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
            title="Select Mode (Inspect & Move Devices)"
          >
            <MousePointer size={14} /> Select
          </button>
          <button
            type="button"
            className={`btn ${activeTool === "wire" ? "btn-primary" : ""}`}
            style={{ padding: "4px 10px", fontSize: "0.8rem" }}
            onClick={() => onSelectTool("wire")}
            title="Wire Mode (Connect Ports Only)"
          >
            <Cable size={14} /> Wire
          </button>
        </div>

        <div
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
            className="btn"
            style={{ padding: "4px 8px", opacity: canUndo ? 1 : 0.4 }}
            disabled={!canUndo}
            onClick={onUndo}
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 8px", opacity: canRedo ? 1 : 0.4 }}
            disabled={!canRedo}
            onClick={onRedo}
            title="Redo (Ctrl+Y)"
          >
            <RotateCw size={14} />
          </button>
        </div>
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

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button type="button" className="btn btn-primary" onClick={onAddDevice}>
            <Plus size={16} /> Add Device
          </button>

          {nodes && nodes.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const targetNodeId = e.target.value;
                if (targetNodeId && onJumpToNode) {
                  onJumpToNode(targetNodeId);
                }
              }}
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                color: "#38bdf8",
                borderRadius: "6px",
                padding: "6px 10px",
                fontSize: "0.85rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
              title="Jump to device & center on canvas"
            >
              <option value="" disabled hidden>
                🎯 Jump to Device ({nodes.length})...
              </option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.power === "started" || node.power === "running" ? "🟢" : "🔴"}{" "}
                  {node.name || node.id} ({node.ports?.length || 0} ports)
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          type="button"
          className="btn"
          onClick={onOpenSettings}
          title="Application Settings & Configuration"
        >
          <Settings size={16} /> Settings
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
