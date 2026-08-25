import { Bug, Settings, X } from "lucide-react";

export function SettingsModal({ isOpen, onClose, config, onUpdateConfig }) {
  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && onClose()}
      role="button"
      tabIndex={0}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
        style={{
          width: "520px",
          maxWidth: "90vw",
          maxHeight: "85vh",
          background: "var(--bg-card)",
          borderRadius: "12px",
          border: "1px solid var(--border-color)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.8)",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Settings size={20} className="text-blue-500" />
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Application Settings</h3>
          </div>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 8px" }}
            onClick={onClose}
            aria-label="Close Settings"
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Section: Debugging & Inspection */}
          <div
            style={{
              fontWeight: 600,
              fontSize: "0.85rem",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Debugging & Display
          </div>

          <div
            style={{
              background: "rgba(15, 23, 42, 0.6)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
              <Bug size={20} style={{ color: "#38bdf8", marginTop: "2px", flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-main)" }}>
                  Show Debug HUD
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "2px" }}>
                  Displays the canvas Port Inspector Debug HUD (hover telemetry, port coordinates,
                  target hits).
                </div>
              </div>
            </div>

            <input
              type="checkbox"
              checked={config?.showDebugHud !== false}
              onChange={(e) =>
                onUpdateConfig({
                  ...config,
                  showDebugHud: e.target.checked,
                })
              }
              style={{
                cursor: "pointer",
                accentColor: "#38bdf8",
                width: "18px",
                height: "18px",
                flexShrink: 0,
              }}
            />
          </div>
        </div>

        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border-color)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
