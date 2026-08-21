import { Cpu, HardDrive, Plus, X } from "lucide-react";

export function AddDeviceModal({ templates, isOpen, onClose, onSelectTemplate }) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: "560px",
          maxHeight: "80vh",
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
          <h3 style={{ fontSize: "1.1rem", fontWeight: 600 }}>Add Device Machine Template</h3>
          <button type="button" className="btn" style={{ padding: "4px 8px" }} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div
          style={{
            padding: "20px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          {templates.map((tmpl) => (
            <div
              key={tmpl.id}
              style={{
                padding: "16px",
                borderRadius: "8px",
                background: "var(--bg-card-hover)",
                border: "1px solid var(--border-color)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                transition: "border-color 0.2s ease",
              }}
            >
              <div style={{ flex: 1, paddingRight: "16px" }}>
                <h4 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--accent-primary)" }}>
                  {tmpl.name}
                </h4>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                    margin: "4px 0 10px 0",
                  }}
                >
                  {tmpl.description}
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: "16px",
                    fontSize: "0.8rem",
                    color: "var(--text-main)",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <Cpu size={14} /> {tmpl.smp || tmpl.cores || 1} vCPU
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <HardDrive size={14} /> {tmpl.memory} MB RAM
                  </span>
                  <span>{tmpl.ports?.length || 0} Ports</span>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onSelectTemplate(tmpl);
                  onClose();
                }}
              >
                <Plus size={16} /> Add
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
