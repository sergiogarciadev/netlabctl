import {
  Activity,
  Check,
  Cpu,
  Edit2,
  FileCode,
  HardDrive,
  Radio,
  Server,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

export function Sidebar({
  selectedNode,
  onClose,
  templates,
  nodes = [],
  wires = [],
  onOpenTerminal,
  onUpdateNode,
  onDeleteNode,
  onUpdateWire,
}) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [name, setName] = useState("");
  const [memory, setMemory] = useState(512);
  const [smp, setSmp] = useState(1);
  const [userdata, setUserdata] = useState("");
  const [metadata, setMetadata] = useState("");
  const [activeTab, setActiveTab] = useState("hardware"); // "hardware" | "scripts" | "ports"
  const [activeTzspPortId, setActiveTzspPortId] = useState(null);
  const [tzspInputMap, setTzspInputMap] = useState({});

  useEffect(() => {
    if (selectedNode) {
      const tmpl = templates.find((t) => t.id === selectedNode.templateId);
      setName(selectedNode.name || "");
      setMemory(selectedNode.memory || tmpl?.memory || 512);
      setSmp(selectedNode.smp || tmpl?.smp || tmpl?.cores || 1);
      setUserdata(selectedNode.userdata || tmpl?.userdata || "");
      setMetadata(selectedNode.metadata || tmpl?.metadata || "");
      setIsEditingName(false);
    }
  }, [selectedNode, templates]);

  if (!selectedNode) return null;

  const tmpl = templates.find((t) => t.id === selectedNode.templateId);
  const systemType =
    tmpl?.system || tmpl?.status?.type || tmpl?.status?.name || "qemu-system-x86_64";
  const diskImage = tmpl?.image || tmpl?.disk || tmpl?.qcow2 || "chr-7.21.5.qcow2";

  const handleSaveNodeProperties = () => {
    onUpdateNode({
      ...selectedNode,
      name,
      memory: Number(memory) || 512,
      smp: Number(smp) || 1,
      userdata,
      metadata,
    });
    setIsEditingName(false);
  };

  const getConnectedWireInfo = (portId) => {
    const wire = wires.find(
      (w) =>
        (w.srcNodeId === selectedNode.id && w.srcPortId === portId) ||
        (w.dstNodeId === selectedNode.id && w.dstPortId === portId),
    );

    if (!wire) return { isConnected: false, wire: null, remoteNode: null, remotePortName: null };

    const isSrc = wire.srcNodeId === selectedNode.id && wire.srcPortId === portId;
    const remoteNodeId = isSrc ? wire.dstNodeId : wire.srcNodeId;
    const remotePortId = isSrc ? wire.dstPortId : wire.srcPortId;

    const remoteNode = nodes.find((n) => n.id === remoteNodeId);
    const remotePort = remoteNode?.ports?.find((p) => p.id === remotePortId);

    return {
      isConnected: true,
      wire,
      remoteNode,
      remotePortName: remotePort ? remotePort.name : remotePortId,
    };
  };

  const handleSaveTzspForPort = (portId, wire) => {
    const targetAddr = tzspInputMap[portId] || "127.0.0.1:37008";
    if (wire && onUpdateWire) {
      onUpdateWire({
        ...wire,
        tzspTarget: targetAddr,
      });
    }
    setActiveTzspPortId(null);
  };

  return (
    <div className={`sidebar ${selectedNode ? "open" : ""}`}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        {isEditingName ? (
          <div style={{ display: "flex", gap: "6px", alignItems: "center", width: "100%" }}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveNodeProperties()}
              style={{
                background: "var(--bg-dark)",
                border: "1px solid var(--accent-primary)",
                color: "var(--text-main)",
                borderRadius: "4px",
                padding: "4px 8px",
                fontSize: "0.95rem",
                width: "100%",
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: "4px 8px" }}
              onClick={handleSaveNodeProperties}
            >
              <Check size={14} />
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3
              style={{
                fontSize: "1.1rem",
                fontWeight: 700,
                color: "var(--text-main)",
                margin: 0,
              }}
            >
              {selectedNode.name}
            </h3>
            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "2px",
              }}
              onClick={() => setIsEditingName(true)}
              title="Rename device"
            >
              <Edit2 size={14} />
            </button>
          </div>
        )}

        <button type="button" className="btn" style={{ padding: "4px 8px" }} onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "12px" }}>
        Template:{" "}
        <strong style={{ color: "var(--text-main)" }}>
          {tmpl ? tmpl.name : selectedNode.templateId}
        </strong>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: "4px",
          borderBottom: "1px solid var(--border-color)",
          marginBottom: "14px",
        }}
      >
        <button
          type="button"
          className={`btn ${activeTab === "hardware" ? "btn-primary" : ""}`}
          style={{ padding: "6px 10px", fontSize: "0.8rem" }}
          onClick={() => setActiveTab("hardware")}
        >
          <Server size={14} /> System & Spec
        </button>
        <button
          type="button"
          className={`btn ${activeTab === "scripts" ? "btn-primary" : ""}`}
          style={{ padding: "6px 10px", fontSize: "0.8rem" }}
          onClick={() => setActiveTab("scripts")}
        >
          <FileCode size={14} /> Scripts
        </button>
        <button
          type="button"
          className={`btn ${activeTab === "ports" ? "btn-primary" : ""}`}
          style={{ padding: "6px 10px", fontSize: "0.8rem" }}
          onClick={() => setActiveTab("ports")}
        >
          Ports ({selectedNode.ports?.length || 0})
        </button>
      </div>

      {/* Tab 1: System & Specs */}
      {activeTab === "hardware" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div
            style={{
              background: "var(--bg-card)",
              padding: "10px",
              borderRadius: "6px",
              border: "1px solid var(--border-color)",
              fontSize: "0.85rem",
            }}
          >
            <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginBottom: "2px" }}>
              System Binary / Architecture
            </div>
            <div style={{ fontWeight: 600, color: "#3b82f6", fontFamily: "var(--font-mono)" }}>
              {systemType}
            </div>
          </div>

          <div
            style={{
              background: "var(--bg-card)",
              padding: "10px",
              borderRadius: "6px",
              border: "1px solid var(--border-color)",
              fontSize: "0.85rem",
            }}
          >
            <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginBottom: "2px" }}>
              Disk Image
            </div>
            <div
              style={{
                fontWeight: 600,
                color: "#10b981",
                fontFamily: "var(--font-mono)",
                wordBreak: "break-all",
              }}
            >
              {diskImage}
            </div>
          </div>

          {/* Editable Memory */}
          <div
            style={{
              background: "var(--bg-card)",
              padding: "10px",
              borderRadius: "6px",
              border: "1px solid var(--border-color)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "var(--text-main)",
                marginBottom: "6px",
              }}
            >
              <HardDrive size={16} /> Memory (RAM in MB)
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                id="memory-input"
                type="number"
                min="64"
                step="128"
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
                style={{
                  background: "var(--bg-dark)",
                  border: "1px solid var(--border-color)",
                  color: "var(--text-main)",
                  borderRadius: "4px",
                  padding: "6px 10px",
                  fontSize: "0.9rem",
                  width: "100%",
                }}
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                onClick={handleSaveNodeProperties}
              >
                Save
              </button>
            </div>
          </div>

          {/* Editable SMP vCPU */}
          <div
            style={{
              background: "var(--bg-card)",
              padding: "10px",
              borderRadius: "6px",
              border: "1px solid var(--border-color)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "var(--text-main)",
                marginBottom: "6px",
              }}
            >
              <Cpu size={16} /> vCPU (SMP Cores)
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                id="smp-input"
                type="number"
                min="1"
                max="32"
                value={smp}
                onChange={(e) => setSmp(e.target.value)}
                style={{
                  background: "var(--bg-dark)",
                  border: "1px solid var(--border-color)",
                  color: "var(--text-main)",
                  borderRadius: "4px",
                  padding: "6px 10px",
                  fontSize: "0.9rem",
                  width: "100%",
                }}
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                onClick={handleSaveNodeProperties}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Userdata & Metadata Scripts */}
      {activeTab === "scripts" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <div
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "var(--text-main)",
                marginBottom: "4px",
              }}
            >
              Userdata Template Script:
            </div>
            <textarea
              rows={5}
              value={userdata}
              onChange={(e) => setUserdata(e.target.value)}
              placeholder="# Cloud-init or RouterOS script template..."
              style={{
                width: "100%",
                background: "var(--bg-dark)",
                border: "1px solid var(--border-color)",
                color: "var(--text-main)",
                borderRadius: "6px",
                padding: "8px",
                fontFamily: "var(--font-mono)",
                fontSize: "0.78rem",
                resize: "vertical",
              }}
            />
          </div>

          <div>
            <div
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "var(--text-main)",
                marginBottom: "4px",
              }}
            >
              Metadata Configuration:
            </div>
            <textarea
              rows={4}
              value={metadata}
              onChange={(e) => setMetadata(e.target.value)}
              placeholder="{ 'instance-id': 'router-1' }"
              style={{
                width: "100%",
                background: "var(--bg-dark)",
                border: "1px solid var(--border-color)",
                color: "var(--text-main)",
                borderRadius: "6px",
                padding: "8px",
                fontFamily: "var(--font-mono)",
                fontSize: "0.78rem",
                resize: "vertical",
              }}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: "8px", fontSize: "0.85rem" }}
            onClick={handleSaveNodeProperties}
          >
            Save Template Configuration
          </button>
        </div>
      )}

      {/* Tab 3: Ports & Connection Status */}
      {activeTab === "ports" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {selectedNode.ports?.map((port) => {
            const { isConnected, wire, remoteNode, remotePortName } = getConnectedWireInfo(port.id);
            const isEditingTzsp = activeTzspPortId === port.id;

            return (
              <div
                key={port.id}
                style={{
                  padding: "10px",
                  background: "var(--bg-card)",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                  fontSize: "0.85rem",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
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

                {/* Connection Status */}
                <div
                  style={{
                    marginTop: "6px",
                    fontSize: "0.78rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span style={{ color: "var(--text-muted)" }}>Status:</span>
                  {isConnected ? (
                    <span style={{ color: "#10b981", fontWeight: 600 }}>
                      Connected → {remoteNode ? remoteNode.name : "Remote"} ({remotePortName})
                    </span>
                  ) : (
                    <span style={{ color: "#94a3b8", fontStyle: "italic" }}>Disconnected</span>
                  )}
                </div>

                {/* Per-Port TZSP Frame Forwarding */}
                <div
                  style={{
                    marginTop: "8px",
                    paddingTop: "6px",
                    borderTop: "1px dashed var(--border-color)",
                  }}
                >
                  {isEditingTzsp ? (
                    <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                      <input
                        type="text"
                        placeholder="127.0.0.1:37008"
                        value={tzspInputMap[port.id] ?? wire?.tzspTarget ?? "127.0.0.1:37008"}
                        onChange={(e) =>
                          setTzspInputMap({ ...tzspInputMap, [port.id]: e.target.value })
                        }
                        style={{
                          background: "var(--bg-dark)",
                          border: "1px solid var(--accent-primary)",
                          color: "var(--text-main)",
                          borderRadius: "4px",
                          padding: "4px 6px",
                          fontSize: "0.75rem",
                          width: "100%",
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                        onClick={() => handleSaveTzspForPort(port.id, wire)}
                      >
                        Set
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      style={{
                        padding: "4px 8px",
                        fontSize: "0.75rem",
                        width: "100%",
                        justifyContent: "center",
                        background: wire?.tzspTarget ? "rgba(16, 185, 129, 0.15)" : "none",
                        borderColor: wire?.tzspTarget ? "#10b981" : "var(--border-color)",
                        color: wire?.tzspTarget ? "#10b981" : "var(--text-main)",
                      }}
                      onClick={() => {
                        if (!isConnected) {
                          alert("Connect this port to a wire first to forward TZSP frames!");
                          return;
                        }
                        setActiveTzspPortId(port.id);
                      }}
                    >
                      <Radio size={12} />{" "}
                      {wire?.tzspTarget
                        ? `TZSP Active (${wire.tzspTarget})`
                        : "Forward Frames (TZSP)"}
                    </button>
                  )}
                </div>

                {/* Per-Wire Network Conditions (Delay, Jitter, Loss) */}
                {isConnected && wire && (
                  <div
                    style={{
                      marginTop: "8px",
                      paddingTop: "6px",
                      borderTop: "1px dashed var(--border-color)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: "var(--text-main)",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <Activity size={12} style={{ color: "#3b82f6" }} /> Link Conditions (Latency &
                      Loss):
                    </div>
                    <div
                      style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}
                    >
                      <div>
                        <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                          Delay (ms):
                          <input
                            type="number"
                            min="0"
                            max="5000"
                            value={wire.conditions?.delayMs ?? 0}
                            onChange={(e) => {
                              const delayMs = Math.max(0, Number(e.target.value) || 0);
                              onUpdateWire({
                                ...wire,
                                conditions: { ...(wire.conditions || {}), delayMs },
                              });
                            }}
                            style={{
                              width: "100%",
                              background: "var(--bg-dark)",
                              border: "1px solid var(--border-color)",
                              color: "var(--text-main)",
                              borderRadius: "4px",
                              padding: "2px 4px",
                              fontSize: "0.75rem",
                              marginTop: "2px",
                            }}
                          />
                        </label>
                      </div>
                      <div>
                        <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                          Jitter (ms):
                          <input
                            type="number"
                            min="0"
                            max="1000"
                            value={wire.conditions?.jitterMs ?? 0}
                            onChange={(e) => {
                              const jitterMs = Math.max(0, Number(e.target.value) || 0);
                              onUpdateWire({
                                ...wire,
                                conditions: { ...(wire.conditions || {}), jitterMs },
                              });
                            }}
                            style={{
                              width: "100%",
                              background: "var(--bg-dark)",
                              border: "1px solid var(--border-color)",
                              color: "var(--text-main)",
                              borderRadius: "4px",
                              padding: "2px 4px",
                              fontSize: "0.75rem",
                              marginTop: "2px",
                            }}
                          />
                        </label>
                      </div>
                      <div>
                        <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                          Loss (%):
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.5"
                            value={wire.conditions?.lossPercent ?? 0}
                            onChange={(e) => {
                              const lossPercent = Math.max(
                                0,
                                Math.min(100, Number(e.target.value) || 0),
                              );
                              onUpdateWire({
                                ...wire,
                                conditions: { ...(wire.conditions || {}), lossPercent },
                              });
                            }}
                            style={{
                              width: "100%",
                              background: "var(--bg-dark)",
                              border: "1px solid var(--border-color)",
                              color: "var(--text-main)",
                              borderRadius: "4px",
                              padding: "2px 4px",
                              fontSize: "0.75rem",
                              marginTop: "2px",
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer Actions */}
      <div
        style={{
          marginTop: "auto",
          paddingTop: "14px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onOpenTerminal(selectedNode)}
        >
          <TerminalIcon size={16} /> Open Serial Terminal
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
