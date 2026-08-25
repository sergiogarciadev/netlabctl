import {
  Activity,
  Check,
  Cpu,
  Edit2,
  FileCode,
  HardDrive,
  Play,
  Power,
  Radio,
  RefreshCw,
  RotateCcw,
  Server,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
  onStartNode,
  onShutdownNode,
  onResetNode,
  onStopNode,
  onRecreateNodeDisk,
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

  const portWireMap = useMemo(() => {
    if (!selectedNode || !wires || !nodes) return new Map();
    const nodeMap = new Map((nodes || []).map((n) => [n.id, n]));
    const map = new Map();

    for (const wire of wires || []) {
      if (wire.srcNodeId === selectedNode.id) {
        const remoteNode = nodeMap.get(wire.dstNodeId);
        const remotePort = remoteNode?.ports?.find((p) => p.id === wire.dstPortId);
        map.set(wire.srcPortId, {
          isConnected: true,
          wire,
          remoteNode,
          remotePortName: remotePort ? remotePort.name : wire.dstPortId,
        });
      } else if (wire.dstNodeId === selectedNode.id) {
        const remoteNode = nodeMap.get(wire.srcNodeId);
        const remotePort = remoteNode?.ports?.find((p) => p.id === wire.srcPortId);
        map.set(wire.dstPortId, {
          isConnected: true,
          wire,
          remoteNode,
          remotePortName: remotePort ? remotePort.name : wire.srcPortId,
        });
      }
    }
    return map;
  }, [selectedNode, wires, nodes]);

  const getConnectedWireInfo = (portId) => {
    return (
      portWireMap.get(portId) || {
        isConnected: false,
        wire: null,
        remoteNode: null,
        remotePortName: null,
      }
    );
  };

  const handlePortDriverChange = (portId, newDriver) => {
    const updatedPorts = (selectedNode.ports || []).map((p) =>
      p.id === portId ? { ...p, netdevDriver: newDriver } : p,
    );
    onUpdateNode({
      ...selectedNode,
      ports: updatedPorts,
    });
  };

  const handlePortPropertyChange = (portId, key, value) => {
    const updatedPorts = (selectedNode.ports || []).map((p) =>
      p.id === portId ? { ...p, [key]: value } : p,
    );
    onUpdateNode({
      ...selectedNode,
      ports: updatedPorts,
    });
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
              title="Save Name"
              aria-label="Save Name"
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
              aria-label="Rename device"
            >
              <Edit2 size={14} />
            </button>
          </div>
        )}

        <button
          type="button"
          className="btn"
          style={{ padding: "4px 8px" }}
          onClick={onClose}
          title="Close Sidebar"
          aria-label="Close Sidebar"
        >
          <X size={16} />
        </button>
      </div>

      {/* Row 1: Template Name + Power Badge */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.8rem",
          color: "var(--text-muted)",
          marginBottom: "10px",
        }}
      >
        <div>
          Template:{" "}
          <strong style={{ color: "var(--text-main)" }}>
            {tmpl ? tmpl.name : selectedNode.templateId}
          </strong>
        </div>

        <span
          style={{
            padding: "2px 8px",
            borderRadius: "10px",
            fontSize: "0.75rem",
            fontWeight: 600,
            background:
              selectedNode.power === "on" || selectedNode.status === "running"
                ? "rgba(34, 197, 94, 0.15)"
                : "rgba(239, 68, 68, 0.15)",
            color:
              selectedNode.power === "on" || selectedNode.status === "running"
                ? "#22c55e"
                : "#ef4444",
            border: `1px solid ${
              selectedNode.power === "on" || selectedNode.status === "running"
                ? "#22c55e44"
                : "#ef444444"
            }`,
          }}
        >
          Power: {selectedNode.power === "on" || selectedNode.status === "running" ? "ON" : "OFF"}
        </span>
      </div>

      {/* Row 2: Power Controls (Start / Shutdown / Reset / Force Power Off) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          marginBottom: "14px",
          flexWrap: "nowrap",
        }}
      >
        {selectedNode.power !== "on" && selectedNode.status !== "running" ? (
          <button
            type="button"
            className="btn btn-success"
            style={{
              padding: "4px 10px",
              fontSize: "0.75rem",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              whiteSpace: "nowrap",
            }}
            onClick={() => onStartNode?.(selectedNode.id)}
            title="Power On / Start Machine Instance"
          >
            <Play size={13} /> Start Machine
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-danger"
              style={{
                padding: "4px 8px",
                fontSize: "0.75rem",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                whiteSpace: "nowrap",
                flex: "1 1 auto",
                justifyContent: "center",
              }}
              onClick={() => onShutdownNode?.(selectedNode.id)}
              title="Send ACPI Shutdown Signal via QMP"
            >
              <Power size={13} /> Shutdown
            </button>

            <button
              type="button"
              className="btn"
              style={{
                padding: "4px 8px",
                fontSize: "0.75rem",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                color: "#f59e0b",
                whiteSpace: "nowrap",
                flex: "1 1 auto",
                justifyContent: "center",
              }}
              onClick={() => onResetNode?.(selectedNode.id)}
              title="Reset / Reboot Machine via QMP"
            >
              <RefreshCw size={13} /> Reset
            </button>

            <button
              type="button"
              className="btn"
              style={{
                padding: "4px 8px",
                fontSize: "0.75rem",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid #ef444444",
                color: "#ef4444",
                whiteSpace: "nowrap",
                flex: "1 1 auto",
                justifyContent: "center",
              }}
              onClick={() => onStopNode?.(selectedNode.id)}
              title="Force Power Off Immediately"
            >
              <Square size={13} /> Force Power Off
            </button>
          </>
        )}
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
          {/* Auto-start Setting */}
          <div
            style={{
              background: "var(--bg-card)",
              padding: "10px",
              borderRadius: "6px",
              border: "1px solid var(--border-color)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-main)" }}>
                Auto-start with Lab
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                Boot machine automatically when Lab starts
              </div>
            </div>
            <input
              type="checkbox"
              checked={selectedNode.autoStart !== false}
              onChange={(e) =>
                onUpdateNode({
                  ...selectedNode,
                  autoStart: e.target.checked,
                })
              }
              style={{ cursor: "pointer", accentColor: "#38bdf8", width: "16px", height: "16px" }}
              title="When enabled, starting simulation automatically boots this machine instance."
            />
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
                    className={`port ${port.type || "managed"}`}
                    style={{ fontSize: "0.75rem" }}
                  >
                    {port.type || "managed"}
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

                {/* Netdev Type Selector (Managed, User, Bridge, TAP) */}
                <div
                  style={{
                    marginTop: "6px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <label
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--text-muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      width: "100%",
                    }}
                  >
                    Type:
                    <select
                      value={port.type || "managed"}
                      onChange={(e) => handlePortPropertyChange(port.id, "type", e.target.value)}
                      style={{
                        background: "var(--bg-dark)",
                        border: "1px solid var(--border-color)",
                        color: "#38bdf8",
                        fontWeight: 600,
                        borderRadius: "4px",
                        padding: "2px 6px",
                        fontSize: "0.75rem",
                        cursor: "pointer",
                        width: "100%",
                      }}
                    >
                      <option value="managed">Managed Proxy (Default)</option>
                      <option value="user">QEMU User (SLIRP + Port Fwd)</option>
                      <option value="bridge">QEMU Bridge (br0/virbr0)</option>
                      <option value="tap">QEMU TAP Interface</option>
                    </select>
                  </label>
                </div>

                {/* Extra UI Field: User Mode Port Forwarding */}
                {(port.type === "user" || port.type === "slirp") && (
                  <div style={{ marginTop: "6px" }}>
                    <label
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--text-muted)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                      }}
                    >
                      <span>Port Forwarding (hostfwd):</span>
                      <input
                        type="text"
                        placeholder="tcp::2222-:22"
                        value={port.hostFwd || ""}
                        onChange={(e) =>
                          handlePortPropertyChange(port.id, "hostFwd", e.target.value)
                        }
                        style={{
                          background: "var(--bg-dark)",
                          border: "1px solid var(--border-color)",
                          color: "#10b981",
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.75rem",
                          borderRadius: "4px",
                          padding: "3px 6px",
                          width: "100%",
                        }}
                        title="Format: tcp::host_port-:guest_port (e.g. tcp::2222-:22)"
                      />
                    </label>
                    <div
                      style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "2px" }}
                    >
                      Format: <code>tcp::2222-:22</code> or <code>udp::8080-:80</code>
                    </div>
                  </div>
                )}

                {/* Extra UI Field: Bridge Interface Select */}
                {port.type === "bridge" && (
                  <div style={{ marginTop: "6px" }}>
                    <label
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--text-muted)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                      }}
                    >
                      <span>Bridge Interface:</span>
                      <div style={{ display: "flex", gap: "4px" }}>
                        <select
                          value={port.bridgeIf || "br0"}
                          onChange={(e) =>
                            handlePortPropertyChange(port.id, "bridgeIf", e.target.value)
                          }
                          style={{
                            background: "var(--bg-dark)",
                            border: "1px solid var(--border-color)",
                            color: "#38bdf8",
                            fontWeight: 600,
                            borderRadius: "4px",
                            padding: "2px 6px",
                            fontSize: "0.75rem",
                            cursor: "pointer",
                            width: "50%",
                          }}
                        >
                          <option value="br0">br0</option>
                          <option value="virbr0">virbr0</option>
                          <option value="docker0">docker0</option>
                          <option value="custom">Custom...</option>
                        </select>
                        <input
                          type="text"
                          placeholder="br0"
                          value={port.bridgeIf || "br0"}
                          onChange={(e) =>
                            handlePortPropertyChange(port.id, "bridgeIf", e.target.value)
                          }
                          style={{
                            background: "var(--bg-dark)",
                            border: "1px solid var(--border-color)",
                            color: "#38bdf8",
                            fontFamily: "var(--font-mono)",
                            fontSize: "0.75rem",
                            borderRadius: "4px",
                            padding: "3px 6px",
                            width: "50%",
                          }}
                          title="Host Linux network bridge interface name"
                        />
                      </div>
                    </label>
                  </div>
                )}

                {/* Extra UI Field: TAP Interface Name (Optional) */}
                {port.type === "tap" && (
                  <div style={{ marginTop: "6px" }}>
                    <label
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--text-muted)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                      }}
                    >
                      <span>TAP Interface Name (Optional):</span>
                      <input
                        type="text"
                        placeholder="tap0 (Auto-allocated if blank)"
                        value={port.tapIf || ""}
                        onChange={(e) => handlePortPropertyChange(port.id, "tapIf", e.target.value)}
                        style={{
                          background: "var(--bg-dark)",
                          border: "1px solid var(--border-color)",
                          color: "#38bdf8",
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.75rem",
                          borderRadius: "4px",
                          padding: "3px 6px",
                          width: "100%",
                        }}
                        title="Optional Linux TAP interface name (e.g. tap0)"
                      />
                    </label>
                  </div>
                )}

                {/* Editable Ethernet Driver Model */}
                <div
                  style={{
                    marginTop: "6px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <label
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--text-muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      width: "100%",
                    }}
                  >
                    Driver:
                    <select
                      value={port.netdevDriver || "virtio-net-pci"}
                      onChange={(e) => handlePortDriverChange(port.id, e.target.value)}
                      style={{
                        background: "var(--bg-dark)",
                        border: "1px solid var(--border-color)",
                        color: "#38bdf8",
                        fontWeight: 600,
                        borderRadius: "4px",
                        padding: "2px 6px",
                        fontSize: "0.75rem",
                        cursor: "pointer",
                        width: "100%",
                      }}
                    >
                      <option value="virtio-net-pci">virtio-net-pci (Default)</option>
                      <option value="e1000">e1000</option>
                      <option value="rtl8139">rtl8139</option>
                      <option value="virtio-net-ccw">virtio-net-ccw</option>
                    </select>
                  </label>
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
                        background: wire?.tzspTarget ? "rgba(239, 68, 68, 0.15)" : "none",
                        borderColor: wire?.tzspTarget ? "#ef4444" : "var(--border-color)",
                        color: wire?.tzspTarget ? "#ef4444" : "var(--text-main)",
                      }}
                      onClick={() => {
                        if (!isConnected) {
                          alert("Connect this port to a wire first to forward TZSP frames!");
                          return;
                        }
                        if (wire?.tzspTarget) {
                          // Deactivate TZSP directly on click when currently active!
                          if (onUpdateWire && wire) {
                            onUpdateWire({
                              ...wire,
                              tzspTarget: "",
                            });
                          }
                          setActiveTzspPortId(null);
                        } else {
                          setActiveTzspPortId(port.id);
                        }
                      }}
                    >
                      <Radio size={12} />{" "}
                      {wire?.tzspTarget
                        ? `Stop TZSP (${wire.tzspTarget})`
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
          paddingBottom: "60px",
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

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="btn"
            style={{
              flex: 1,
              background: "rgba(245, 158, 11, 0.15)",
              border: "1px solid rgba(245, 158, 11, 0.4)",
              color: "#f59e0b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              fontSize: "0.8rem",
            }}
            onClick={() => onRecreateNodeDisk?.(selectedNode.id)}
            title="Wipe machine overlay and recreate fresh disk from template defaults"
          >
            <RotateCcw size={15} /> Recreate Disk
          </button>

          <button
            type="button"
            className="btn btn-danger"
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              fontSize: "0.8rem",
            }}
            onClick={() => onDeleteNode(selectedNode.id)}
            title="Delete this device from the network topology"
          >
            <Trash2 size={15} /> Remove Device
          </button>
        </div>
      </div>
    </div>
  );
}
