import { AlertTriangle, Cpu, HardDrive, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";

export function AddDeviceModal({ templates = [], isOpen, onClose, onSelectTemplate }) {
  const [activeTab, setActiveTab] = useState("All");

  const { groups, filteredTemplates } = useMemo(() => {
    const rawGroups = new Set();
    let hasOther = false;

    for (const tmpl of templates || []) {
      if (tmpl.group && tmpl.group.trim()) {
        rawGroups.add(tmpl.group.trim());
      } else {
        hasOther = true;
      }
    }

    const sortedCustomGroups = Array.from(rawGroups).sort();
    const groupList = ["All", ...sortedCustomGroups];
    if (hasOther) {
      groupList.push("Other");
    }

    const filtered = (templates || []).filter((tmpl) => {
      if (activeTab === "All") return true;
      if (activeTab === "Other") return !tmpl.group || !tmpl.group.trim();
      return tmpl.group?.trim() === activeTab;
    });

    return { groups: groupList, filteredTemplates: filtered };
  }, [templates, activeTab]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
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
        zIndex: 10000,
      }}
    >
      <div
        style={{
          width: "600px",
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

        {/* Group Tabs */}
        {groups.length > 1 && (
          <div
            style={{
              display: "flex",
              gap: "6px",
              padding: "12px 20px 8px 20px",
              borderBottom: "1px solid var(--border-color)",
              overflowX: "auto",
              background: "rgba(0, 0, 0, 0.2)",
            }}
          >
            {groups.map((grp) => {
              const isActive = activeTab === grp;
              return (
                <button
                  key={grp}
                  type="button"
                  onClick={() => setActiveTab(grp)}
                  style={{
                    padding: "4px 12px",
                    borderRadius: "6px",
                    border: isActive ? "1px solid #38bdf8" : "1px solid var(--border-color)",
                    background: isActive ? "rgba(56, 189, 248, 0.15)" : "var(--bg-card)",
                    color: isActive ? "#38bdf8" : "var(--text-muted)",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "all 0.15s ease",
                  }}
                >
                  {grp}
                </button>
              );
            })}
          </div>
        )}

        <div
          style={{
            padding: "20px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          {filteredTemplates.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "20px",
                color: "var(--text-muted)",
                fontSize: "0.9rem",
              }}
            >
              No machine templates found in this group.
            </div>
          ) : (
            filteredTemplates.map((tmpl) => {
              const isMissingDisk = !tmpl.image || tmpl.imageExists === false;
              return (
                <div
                  key={tmpl.id}
                  style={{
                    padding: "16px",
                    borderRadius: "8px",
                    background: "var(--bg-card-hover)",
                    border: isMissingDisk
                      ? "1px solid rgba(239, 68, 68, 0.4)"
                      : "1px solid var(--border-color)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    transition: "border-color 0.2s ease",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ flex: 1, paddingRight: "16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <h4
                          style={{
                            fontSize: "1rem",
                            fontWeight: 600,
                            color: "var(--accent-primary)",
                          }}
                        >
                          {tmpl.name}
                        </h4>
                        {tmpl.group && (
                          <span
                            style={{
                              fontSize: "0.7rem",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              background: "rgba(148, 163, 184, 0.15)",
                              color: "var(--text-muted)",
                              fontWeight: 600,
                            }}
                          >
                            {tmpl.group}
                          </span>
                        )}
                      </div>
                      <p
                        style={{
                          fontSize: "0.85rem",
                          color: "var(--text-muted)",
                          margin: "4px 0 8px 0",
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

                  {/* Warning banner for missing disk */}
                  {isMissingDisk && (
                    <div
                      style={{
                        padding: "6px 10px",
                        borderRadius: "6px",
                        background: "rgba(239, 68, 68, 0.15)",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                        color: "#f87171",
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <AlertTriangle size={14} />
                      <span>
                        Disk image file is missing from ~/.netlabctl/images/. Machine cannot boot.
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
