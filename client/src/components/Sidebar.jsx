import { Cpu, HardDrive, Radio, Terminal as TerminalIcon, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

export function Sidebar({
  selectedNode,
  onClose,
  templates,
  onOpenTerminal,
  onUpdateNode,
  onDeleteNode,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    if (selectedNode) {
      setName(selectedNode.name);
      setIsEditing(false);
    }
  }, [selectedNode]);

  if (!selectedNode) return null;

  const tmpl = templates.find((t) => t.id === selectedNode.templateId);

  const handleSave = () => {
    onUpdateNode({
      ...selectedNode,
      name,
    });
    setIsEditing(false);
  };

  return (
    <div className={`sidebar ${selectedNode ? "open" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {isEditing ? (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            style={{
              background: "var(--bg-dark)",
              border: "1px solid var(--accent-primary)",
              color: "var(--text-main)",
              borderRadius: "4px",
              padding: "4px 8px",
              fontSize: "1rem",
            }}
          />
        ) : (
          <button
            type="button"
            style={{
              fontSize: "1.1rem",
              fontWeight: 600,
              cursor: "pointer",
              background: "none",
              border: "none",
              color: "var(--text-main)",
              textAlign: "left",
              padding: 0,
            }}
            onClick={() => setIsEditing(true)}
            title="Click to rename"
          >
            {selectedNode.name}
          </button>
        )}
        <button type="button" className="btn" style={{ padding: "4px 8px" }} onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
        Template: {tmpl ? tmpl.name : selectedNode.templateId}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.9rem" }}>
          <Cpu size={16} /> {tmpl?.smp || tmpl?.cores || 1} vCPU core(s)
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.9rem" }}>
          <HardDrive size={16} /> {tmpl?.memory || 512} MB RAM
        </div>
      </div>

      <div style={{ marginTop: "10px" }}>
        <h4 style={{ fontSize: "0.95rem", marginBottom: "10px", color: "var(--text-main)" }}>
          Network Ports ({selectedNode.ports?.length || 0})
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {selectedNode.ports?.map((port) => (
            <div
              key={port.id}
              style={{
                padding: "8px 12px",
                background: "var(--bg-card)",
                borderRadius: "6px",
                border: "1px solid var(--border-color)",
                fontSize: "0.85rem",
              }}
            >
              <div style={{ fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                <span>{port.name}</span>
                <span
                  className={`port ${port.netdevType || "managed"}`}
                  style={{ fontSize: "0.75rem" }}
                >
                  {port.netdevType || "managed"}
                </span>
              </div>
              <div
                style={{
                  fontSize: "0.75rem",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-muted)",
                  marginTop: "4px",
                }}
              >
                MAC: {port.mac}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onOpenTerminal(selectedNode)}
        >
          <TerminalIcon size={16} /> Open Serial Terminal
        </button>
        <button type="button" className="btn">
          <Radio size={16} /> Forward Frames (TZSP)
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => onDeleteNode(selectedNode.id)}
        >
          <Trash2 size={16} /> Remove Device
        </button>
      </div>
    </div>
  );
}
