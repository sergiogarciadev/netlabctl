import { useCallback, useEffect, useRef, useState } from "react";
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
  const [activeTool, setActiveTool] = useState("select");

  // History State Stack for Undo / Redo
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const wsClientRef = useRef(null);

  const updateHistoryButtons = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const pushStateToHistory = useCallback(
    (newProject) => {
      const clone = JSON.parse(JSON.stringify(newProject));
      const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
      nextHistory.push(clone);
      historyRef.current = nextHistory;
      historyIndexRef.current = nextHistory.length - 1;
      updateHistoryButtons();
    },
    [updateHistoryButtons],
  );

  const commitProjectUpdate = useCallback(
    async (updatedProject, saveToHistory = true) => {
      console.log("[NETLAB-APP-DEBUG] Committing project update:", updatedProject);
      setProject(updatedProject);
      if (saveToHistory) {
        pushStateToHistory(updatedProject);
      }
      try {
        await updateProject(updatedProject.id, updatedProject);
      } catch (err) {
        console.error("[NETLAB-APP-DEBUG] Failed to sync project update to server:", err);
      }
    },
    [pushStateToHistory],
  );

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current -= 1;
      const prevProject = JSON.parse(JSON.stringify(historyRef.current[historyIndexRef.current]));
      console.log("[NETLAB-APP-DEBUG] Performing UNDO to state index:", historyIndexRef.current);
      commitProjectUpdate(prevProject, false);
      updateHistoryButtons();
    }
  }, [commitProjectUpdate, updateHistoryButtons]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current += 1;
      const nextProject = JSON.parse(JSON.stringify(historyRef.current[historyIndexRef.current]));
      console.log("[NETLAB-APP-DEBUG] Performing REDO to state index:", historyIndexRef.current);
      commitProjectUpdate(nextProject, false);
      updateHistoryButtons();
    }
  }, [commitProjectUpdate, updateHistoryButtons]);

  // Global Keyboard listener for Undo (Ctrl+Z) and Redo (Ctrl+Y / Ctrl+Shift+Z)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        handleRedo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    fetchTemplates()
      .then((tmplList) => {
        console.log("[NETLAB-APP-DEBUG] Loaded templates:", tmplList);
        setTemplates(tmplList);
      })
      .catch((err) => console.error("[NETLAB-APP-DEBUG] Failed to load templates:", err));

    fetchProject("default")
      .then((top) => {
        console.log("[NETLAB-APP-DEBUG] Loaded project topology:", top);
        setProject(top);
        historyRef.current = [JSON.parse(JSON.stringify(top))];
        historyIndexRef.current = 0;
        updateHistoryButtons();
      })
      .catch(() => {
        const initTop = {
          id: "default",
          name: "Sample Network Lab",
          nodes: [],
          wires: [],
        };
        updateProject("default", initTop).then((top) => {
          setProject(top);
          historyRef.current = [JSON.parse(JSON.stringify(top))];
          historyIndexRef.current = 0;
          updateHistoryButtons();
        });
      });

    const ws = new WSClient((msg) => {
      if (msg.type === "project_state") {
        console.log("[NETLAB-APP-DEBUG] Received WS project_state:", msg.data);
        setProject(msg.data);
      }
    });
    ws.connect();
    ws.subscribeProject("default");
    wsClientRef.current = ws;
  }, [updateHistoryButtons]);

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
      console.log("[NETLAB-APP-DEBUG] Adding node from template:", tmpl.id, { posX, posY });
      const newNode = await addNodeToProject(project.id, tmpl.id, "", posX, posY);
      const updatedNodes = [...(project.nodes || []), newNode];
      const updatedProject = { ...project, nodes: updatedNodes };

      commitProjectUpdate(updatedProject, true);
      setSelectedNode(newNode);
    } catch (err) {
      console.error("[NETLAB-APP-DEBUG] Failed to add node from template:", err);
    }
  };

  const handleAddWire = async (srcNodeId, srcPortId, dstNodeId, dstPortId) => {
    console.log("[NETLAB-APP-DEBUG] Requesting wire creation:", {
      srcNodeId,
      srcPortId,
      dstNodeId,
      dstPortId,
      currentWires: project.wires,
    });

    const isPortConnected = (nodeId, portId) => {
      return (project.wires || []).some(
        (w) =>
          (w.srcNodeId === nodeId && w.srcPortId === portId) ||
          (w.dstNodeId === nodeId && w.dstPortId === portId),
      );
    };

    if (isPortConnected(srcNodeId, srcPortId)) {
      console.warn("[NETLAB-APP-DEBUG] Rejected: Source port already connected.");
      alert(`Port ${srcPortId} on device ${srcNodeId} is already connected to a wire!`);
      return;
    }
    if (isPortConnected(dstNodeId, dstPortId)) {
      console.warn("[NETLAB-APP-DEBUG] Rejected: Destination port already connected.");
      alert(`Port ${dstPortId} on device ${dstNodeId} is already connected to a wire!`);
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
    console.log("[NETLAB-APP-DEBUG] Wire created successfully:", newWire);
    commitProjectUpdate(updatedProject, true);
  };

  const handleDeleteWire = async (wireId) => {
    console.log("[NETLAB-APP-DEBUG] Deleting wire:", wireId);
    const updatedWires = (project.wires || []).filter((w) => w.id !== wireId);
    const updatedProject = { ...project, wires: updatedWires };
    commitProjectUpdate(updatedProject, true);
  };

  const handleUpdateWire = async (updatedWire) => {
    console.log("[NETLAB-APP-DEBUG] Updating wire:", updatedWire);
    const updatedWires = (project.wires || []).map((w) =>
      w.id === updatedWire.id ? updatedWire : w,
    );
    const updatedProject = { ...project, wires: updatedWires };
    commitProjectUpdate(updatedProject, true);
  };

  const handleUpdateNode = async (updatedNode) => {
    console.log("[NETLAB-APP-DEBUG] Updating node:", updatedNode);
    const updatedNodes = (project.nodes || []).map((n) =>
      n.id === updatedNode.id ? updatedNode : n,
    );
    const updatedProject = { ...project, nodes: updatedNodes };
    setSelectedNode(updatedNode);
    commitProjectUpdate(updatedProject, true);
  };

  const handleDeleteNode = async (nodeId) => {
    console.log("[NETLAB-APP-DEBUG] Deleting node:", nodeId);
    const updatedNodes = (project.nodes || []).filter((n) => n.id !== nodeId);
    const updatedWires = (project.wires || []).filter(
      (w) => w.srcNodeId !== nodeId && w.dstNodeId !== nodeId,
    );
    const updatedProject = { ...project, nodes: updatedNodes, wires: updatedWires };
    setSelectedNode(null);
    commitProjectUpdate(updatedProject, true);
  };

  return (
    <div className="app-container">
      <Toolbar
        projectName={project.name}
        isRunning={isRunning}
        activeTool={activeTool}
        onSelectTool={(tool) => {
          console.log("[NETLAB-APP-DEBUG] Tool selected:", tool);
          setActiveTool(tool);
        }}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
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
          activeTool={activeTool}
          onSelectNode={(node) => setSelectedNode(node)}
          onAddWire={handleAddWire}
          onDeleteWire={handleDeleteWire}
          onDeleteNode={handleDeleteNode}
        />

        <Sidebar
          selectedNode={selectedNode}
          onClose={() => setSelectedNode(null)}
          templates={templates}
          nodes={project.nodes || []}
          wires={project.wires || []}
          onOpenTerminal={(node) => setActiveTerminalNode(node)}
          onUpdateNode={handleUpdateNode}
          onDeleteNode={handleDeleteNode}
          onUpdateWire={handleUpdateWire}
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
