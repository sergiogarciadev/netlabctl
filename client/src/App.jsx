import { useEffect, useRef, useState } from "react";
import { AddDeviceModal } from "./components/AddDeviceModal";
import { Canvas } from "./components/Canvas";
import { Sidebar } from "./components/Sidebar";
import { TerminalWindow } from "./components/TerminalWindow";
import { Toolbar } from "./components/Toolbar";
import {
  addNodeToProject,
  fetchProject,
  fetchTemplates,
  updateProject,
  WSClient,
} from "./services/api";

export function App() {
  const [templates, setTemplates] = useState([]);
  const [project, setProject] = useState({
    id: "default",
    name: "Sample Network Lab",
    nodes: [],
    wires: [],
  });
  const [selectedNode, setSelectedNode] = useState(null);
  const [activeTerminalNode, setActiveTerminalNode] = useState(null);
  const [isAddDeviceOpen, setIsAddDeviceOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const wsClientRef = useRef(null);

  useEffect(() => {
    // Fetch machine templates
    fetchTemplates()
      .then(setTemplates)
      .catch((err) => console.error("Failed to load templates:", err));

    // Fetch initial project topology
    fetchProject("default")
      .then((top) => setProject(top))
      .catch(() => {
        // Create default initial project topology
        const initTop = {
          id: "default",
          name: "Sample Network Lab",
          nodes: [],
          wires: [],
        };
        updateProject("default", initTop).then(setProject);
      });

    // Connect WebSocket
    const ws = new WSClient((msg) => {
      if (msg.type === "project_state") {
        setProject(msg.data);
      }
    });
    ws.connect();
    ws.subscribeProject("default");
    wsClientRef.current = ws;
  }, []);

  const handleStartLab = () => {
    setIsRunning(true);
    wsClientRef.current?.startSimulation(project.id);
  };

  const handleStopLab = () => {
    setIsRunning(false);
    wsClientRef.current?.stopSimulation(project.id);
  };

  const handleAddNodeFromTemplate = async (tmpl) => {
    try {
      const posX = 100 + (project.nodes?.length || 0) * 160;
      const posY = 150;
      const newNode = await addNodeToProject(project.id, tmpl.id, "", posX, posY);

      setProject((prev) => ({
        ...prev,
        nodes: [...(prev.nodes || []), newNode],
      }));
      setSelectedNode(newNode);
    } catch (err) {
      console.error("Failed to add node from template:", err);
    }
  };

  const handleAddWire = async (srcNodeId, srcPortId, dstNodeId, dstPortId) => {
    // Rule: Each Port MUST HAVE only one connection to another Port.
    const isPortConnected = (nodeId, portId) => {
      return (project.wires || []).some(
        (w) =>
          (w.srcNodeId === nodeId && w.srcPortId === portId) ||
          (w.dstNodeId === nodeId && w.dstPortId === portId),
      );
    };

    if (isPortConnected(srcNodeId, srcPortId)) {
      alert(`Port ${srcPortId} on node ${srcNodeId} already has an active connection!`);
      return;
    }
    if (isPortConnected(dstNodeId, dstPortId)) {
      alert(`Port ${dstPortId} on node ${dstNodeId} already has an active connection!`);
      return;
    }

    const newWire = {
      id: `wire-${Date.now()}`,
      srcNodeId,
      srcPortId,
      dstNodeId,
      dstPortId,
    };

    const updatedWires = [...(project.wires || []), newWire];
    const updatedProject = { ...project, wires: updatedWires };

    setProject(updatedProject);
    await updateProject(project.id, updatedProject);
  };

  const handleDeleteWire = async (wireId) => {
    const updatedWires = (project.wires || []).filter((w) => w.id !== wireId);
    const updatedProject = { ...project, wires: updatedWires };
    setProject(updatedProject);
    await updateProject(project.id, updatedProject);
  };

  const handleUpdateNode = async (updatedNode) => {
    const updatedNodes = (project.nodes || []).map((n) =>
      n.id === updatedNode.id ? updatedNode : n,
    );
    const updatedProject = { ...project, nodes: updatedNodes };
    setProject(updatedProject);
    setSelectedNode(updatedNode);
    await updateProject(project.id, updatedProject);
  };

  const handleDeleteNode = async (nodeId) => {
    const updatedNodes = (project.nodes || []).filter((n) => n.id !== nodeId);
    const updatedWires = (project.wires || []).filter(
      (w) => w.srcNodeId !== nodeId && w.dstNodeId !== nodeId,
    );
    const updatedProject = { ...project, nodes: updatedNodes, wires: updatedWires };
    setProject(updatedProject);
    setSelectedNode(null);
    await updateProject(project.id, updatedProject);
  };

  return (
    <div className="app-container">
      <Toolbar
        projectName={project.name}
        isRunning={isRunning}
        onStart={handleStartLab}
        onStop={handleStopLab}
        onAddDevice={() => setIsAddDeviceOpen(true)}
        selectedNode={selectedNode}
        onOpenTerminal={(node) => setActiveTerminalNode(node)}
      />

      <div className="main-content">
        <Canvas
          nodes={project.nodes || []}
          wires={project.wires || []}
          templates={templates}
          onSelectNode={(node) => setSelectedNode(node)}
          onAddWire={handleAddWire}
          onDeleteWire={handleDeleteWire}
        />

        <Sidebar
          selectedNode={selectedNode}
          onClose={() => setSelectedNode(null)}
          templates={templates}
          onOpenTerminal={(node) => setActiveTerminalNode(node)}
          onUpdateNode={handleUpdateNode}
          onDeleteNode={handleDeleteNode}
        />

        <AddDeviceModal
          templates={templates}
          isOpen={isAddDeviceOpen}
          onClose={() => setIsAddDeviceOpen(false)}
          onSelectTemplate={handleAddNodeFromTemplate}
        />

        {activeTerminalNode && (
          <TerminalWindow
            node={activeTerminalNode}
            onClose={() => setActiveTerminalNode(null)}
            wsClient={wsClientRef.current}
          />
        )}
      </div>
    </div>
  );
}
