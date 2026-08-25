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
    >
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
        style={{ maxWidth: "520px", width: "90%" }}
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Settings size={20} className="text-blue-500" />
            <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Application Settings</h2>
          </div>
          <button type="button" className="btn" onClick={onClose} aria-label="Close Settings">
            <X size={16} />
          </button>
        </div>

        <div
          className="modal-body"
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
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
              background: "var(--bg-card)",
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

        <div className="modal-footer" style={{ marginTop: "20px" }}>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
