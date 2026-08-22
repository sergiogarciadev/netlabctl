import { Bug, Crosshair } from "lucide-react";

export function DebugPanel({ debugInfo }) {
  if (!debugInfo) return null;

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
          gap: "6px",
          fontWeight: 700,
          color: "#3b82f6",
          marginBottom: "8px",
          borderBottom: "1px solid #1e293b",
          paddingBottom: "6px",
        }}
      >
        <Bug size={14} /> Port Inspector Debug HUD
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
