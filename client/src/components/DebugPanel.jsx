import { Bug, ChevronDown, Crosshair, X } from "lucide-react";
import { useEffect, useState } from "react";

export function DebugPanel({ debugInfo }) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    return localStorage.getItem("netlabctl_debug_hud_collapsed") === "true";
  });

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("netlabctl_debug_hud_collapsed", String(next));
      return next;
    });
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Shortcut Ctrl+Shift+D to toggle Debug HUD
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        toggleCollapse();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!debugInfo) return null;

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={toggleCollapse}
        title="Show Port Inspector Debug HUD (Ctrl+Shift+D)"
        style={{
          position: "absolute",
          bottom: "16px",
          left: "16px",
          background: "rgba(15, 23, 42, 0.92)",
          backdropFilter: "blur(12px)",
          border: "1px solid #3b82f6",
          borderRadius: "20px",
          padding: "6px 12px",
          fontSize: "0.78rem",
          fontFamily: "var(--font-mono)",
          color: "#3b82f6",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          zIndex: 90,
          boxShadow: "0 6px 20px rgba(0, 0, 0, 0.5)",
          transition: "all 0.2s ease",
        }}
      >
        <Bug size={14} /> Debug HUD
      </button>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        bottom: "16px",
        left: "16px",
        width: "320px",
        background: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(12px)",
        border: "1px solid #3b82f6",
        borderRadius: "8px",
        padding: "12px",
        fontSize: "0.78rem",
        fontFamily: "var(--font-mono)",
        color: "#f8fafc",
        zIndex: 90,
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.6)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontWeight: 700,
          color: "#3b82f6",
          marginBottom: "8px",
          borderBottom: "1px solid #1e293b",
          paddingBottom: "6px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Bug size={14} /> Port Inspector Debug HUD
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            type="button"
            onClick={toggleCollapse}
            title="Minimize Debug HUD"
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: "2px",
              display: "flex",
              alignItems: "center",
              borderRadius: "4px",
            }}
          >
            <ChevronDown size={14} />
          </button>
          <button
            type="button"
            onClick={toggleCollapse}
            title="Close Debug HUD"
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: "2px",
              display: "flex",
              alignItems: "center",
              borderRadius: "4px",
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <div>
          <span style={{ color: "#94a3b8" }}>Tool Mode:</span>{" "}
          <span
            style={{
              color: debugInfo.activeTool === "wire" ? "#10b981" : "#3b82f6",
              fontWeight: "bold",
            }}
          >
            {debugInfo.activeTool?.toUpperCase()}
          </span>
        </div>

        <div>
          <span style={{ color: "#94a3b8" }}>Mouse Scene Pos:</span>{" "}
          <span>
            X: {Math.round(debugInfo.pointer?.x || 0)}, Y: {Math.round(debugInfo.pointer?.y || 0)}
          </span>
        </div>

        <div>
          <span style={{ color: "#94a3b8" }}>Hovered Node:</span>{" "}
          <span style={{ color: debugInfo.nodeId ? "#f59e0b" : "#64748b" }}>
            {debugInfo.nodeId || "None"}
          </span>
        </div>

        <div>
          <span style={{ color: "#94a3b8" }}>SubTarget Tag:</span>{" "}
          <span>{debugInfo.subTargetTag || "None"}</span>
        </div>

        <div style={{ marginTop: "6px", paddingTop: "6px", borderTop: "1px stroke #1e293b" }}>
          <div
            style={{
              fontWeight: 600,
              color: "#10b981",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Crosshair size={12} /> Detected Port:
          </div>
          {debugInfo.nearestPort ? (
            <div
              style={{
                marginTop: "2px",
                background: "rgba(16, 185, 129, 0.1)",
                padding: "6px",
                borderRadius: "4px",
                border: "1px solid rgba(16, 185, 129, 0.3)",
              }}
            >
              <div>
                <span style={{ color: "#94a3b8" }}>Port ID:</span>{" "}
                <strong style={{ color: "#10b981" }}>{debugInfo.nearestPort.portId}</strong>
              </div>
              <div>
                <span style={{ color: "#94a3b8" }}>Abs Pos:</span> X:{" "}
                {Math.round(debugInfo.nearestPort.absPos?.x || 0)}, Y:{" "}
                {Math.round(debugInfo.nearestPort.absPos?.y || 0)}
              </div>
              <div>
                <span style={{ color: "#94a3b8" }}>Distance:</span>{" "}
                {Math.round(debugInfo.nearestPort.dist * 10) / 10}px
              </div>
            </div>
          ) : (
            <div style={{ color: "#ef4444", marginTop: "2px" }}>
              No port detected within threshold
            </div>
          )}
        </div>

        <div style={{ marginTop: "6px", fontSize: "0.72rem", color: "#64748b" }}>
          <span style={{ color: "#94a3b8" }}>Wiring State:</span>{" "}
          {debugInfo.isWiring ? `Active from ${debugInfo.srcPortId}` : "Idle"}
        </div>
      </div>
    </div>
  );
}
