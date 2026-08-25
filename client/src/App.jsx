import { useCallback, useEffect, useRef, useState } from "react";
import { AddDeviceModal } from "./components/AddDeviceModal";
import { Canvas } from "./components/Canvas";
import { Sidebar } from "./components/Sidebar";
import { TerminalWindow } from "./components/TerminalWindow";
import { Toolbar } from "./components/Toolbar";
import {
  WSClient,
  addNodeToProject,
  cloneProject,
  createProject,
  deleteProject,
  fetchProject,
  fetchProjects,
  fetchTemplates,
  resetNodePower,
  shutdownNodePower,
  startNodePower,
  startProjectSimulation,
  stopNodePower,
  stopProjectSimulation,
  updateProject,
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
  const [activeTerminalNodes, setActiveTerminalNodes] = useState([]);
  const [focusedTerminalNodeId, setFocusedTerminalNodeId] = useState(null);
  const [terminalOrder, setTerminalOrder] = useState([]);
  const [activeTool, setActiveTool] = useState("select");
  const [isRunning, setIsRunning] = useState(false);

  const handleFocusTerminal = useCallback((nodeId) => {
    setFocusedTerminalNodeId(nodeId);
    setTerminalOrder((prev) => [...prev.filter((id) => id !== nodeId), nodeId]);
  }, []);

  const handleOpenTerminal = useCallback(
    (node) => {
      setActiveTerminalNodes((prev) => {
        if (prev.some((n) => n.id === node.id)) {
          return prev;
        }
        return [...prev, node];
      });
      handleFocusTerminal(node.id);
    },
    [handleFocusTerminal],
  );
  const [isAddDeviceOpen, setIsAddDeviceOpen] = useState(false);

  // Stable ref for project state — allows useCallback handlers to always
  // read the latest project without needing project in their dependency arrays.
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // Keep selectedNode synchronized with the latest node object in project.nodes
  useEffect(() => {
    if (selectedNode) {
      const latestNode = project.nodes?.find((n) => n.id === selectedNode.id);
      if (latestNode && latestNode !== selectedNode) {
        setSelectedNode(latestNode);
      }
    }
  }, [project.nodes, selectedNode]);

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
      const tag = document.activeElement?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable) {
        return;
      }

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

  const [wireStats, setWireStats] = useState([]);
  const [projects, setProjects] = useState([]);

  const loadProjectsList = useCallback(async () => {
    try {
      const list = await fetchProjects();
      setProjects(list || []);
    } catch (err) {
      console.error("[NETLAB-APP-DEBUG] Failed to load projects list:", err);
    }
  }, []);

  const handleSwitchProject = useCallback(
    async (projectId) => {
      try {
        setSelectedNode(null);
        const top = await fetchProject(projectId);
        setProject(top);
        const active =
          top.simulationStatus === "running" ||
          top.nodes?.some((n) => n.power === "on" || n.status === "running");
        setIsRunning(Boolean(active));
        historyRef.current = [JSON.parse(JSON.stringify(top))];
        historyIndexRef.current = 0;
        updateHistoryButtons();

        if (wsClientRef.current) {
          wsClientRef.current.subscribeProject(projectId);
        }
        await loadProjectsList();
      } catch (err) {
        console.error("[NETLAB-APP-DEBUG] Failed to switch project:", err);
      }
    },
    [updateHistoryButtons, loadProjectsList],
  );

  const handleCreateProject = useCallback(async () => {
    const name = window.prompt("Enter new lab name:", "New Network Lab");
    if (!name) return;
    try {
      const newId = `proj-${Date.now()}`;
      const newTop = {
        id: newId,
        name,
        nodes: [],
        wires: [],
      };
      await createProject(newTop);
      await handleSwitchProject(newId);
    } catch (err) {
      console.error("[NETLAB-APP-DEBUG] Failed to create project:", err);
      alert("Failed to create new project.");
    }
  }, [handleSwitchProject]);

  const handleCloneProject = useCallback(async () => {
    const current = projectRef.current;
    const name = window.prompt("Enter name for cloned lab:", `${current.name} (Copy)`);
    if (!name) return;
    try {
      const cloned = await cloneProject(current.id, name);
      await handleSwitchProject(cloned.id);
    } catch (err) {
      console.error("[NETLAB-APP-DEBUG] Failed to clone project:", err);
      alert("Failed to clone project.");
    }
  }, [handleSwitchProject]);

  const handleDeleteProject = useCallback(async () => {
    const current = projectRef.current;
    if (projects.length <= 1) {
      alert("Cannot delete the only remaining lab project.");
      return;
    }
    if (!window.confirm(`Are you sure you want to delete lab "${current.name}"?`)) {
      return;
    }
    try {
      await deleteProject(current.id);
      const remaining = projects.filter((p) => p.id !== current.id);
      const nextId = remaining.length > 0 ? remaining[0].id : "default";
      await handleSwitchProject(nextId);
    } catch (err) {
      console.error("[NETLAB-APP-DEBUG] Failed to delete project:", err);
      alert("Failed to delete project.");
    }
  }, [projects, handleSwitchProject]);

  useEffect(() => {
    fetchTemplates()
      .then((tmplList) => {
        console.log("[NETLAB-APP-DEBUG] Loaded templates:", tmplList);
        setTemplates(tmplList);
      })
      .catch((err) => console.error("[NETLAB-APP-DEBUG] Failed to load templates:", err));

    loadProjectsList();

    const updateProjectState = (top) => {
      setProject(top);
      const active =
        top.simulationStatus === "running" ||
        top.nodes?.some((n) => n.power === "on" || n.status === "running");
      setIsRunning(Boolean(active));
    };

    fetchProject("default")
      .then((top) => {
        console.log("[NETLAB-APP-DEBUG] Loaded project topology:", top);
        updateProjectState(top);
        historyRef.current = [JSON.parse(JSON.stringify(top))];
        historyIndexRef.current = 0;
        setCanUndo(false);
        setCanRedo(false);
      })
      .catch(() => {
        const initTop = {
          id: "default",
          name: "Sample Network Lab",
          nodes: [],
          wires: [],
        };
        updateProject("default", initTop).then((top) => {
          updateProjectState(top);
          historyRef.current = [JSON.parse(JSON.stringify(top))];
          historyIndexRef.current = 0;
          setCanUndo(false);
          setCanRedo(false);
          loadProjectsList();
        });
      });

    const ws = new WSClient((msg) => {
      if (msg.type === "project_state") {
        console.log("[NETLAB-APP-DEBUG] Received WS project_state:", msg.data);
        updateProjectState(msg.data);
      } else if (msg.type === "simulation_started") {
        setIsRunning(true);
      } else if (msg.type === "simulation_stopped") {
        setIsRunning(false);
      } else if (msg.type === "wire_stats") {
        if (Array.isArray(msg.data?.stats)) {
          setWireStats(msg.data.stats);
        }
      }
    });
    ws.connect();
    ws.subscribeProject("default");
    wsClientRef.current = ws;

    return () => ws.disconnect();
  }, [loadProjectsList]);

  const handleStartLab = useCallback(async () => {
    setIsRunning(true);
    try {
      await startProjectSimulation(projectRef.current.id);
    } catch (err) {
      console.error("[NETLAB-APP-DEBUG] Failed to start simulation via REST:", err);
    }
    wsClientRef.current?.startSimulation(projectRef.current.id);
  }, []);

  const handleStopLab = useCallback(async () => {
    setIsRunning(false);
    try {
      await stopProjectSimulation(projectRef.current.id);
    } catch (err) {
      console.error("[NETLAB-APP-DEBUG] Failed to stop simulation via REST:", err);
    }
    wsClientRef.current?.stopSimulation(projectRef.current.id);
  }, []);

  const handleStartNode = useCallback(async (nodeId) => {
    const proj = projectRef.current;
    try {
      await startNodePower(proj.id, nodeId);
    } catch (err) {
      console.error("[NETLAB-APP-DEBUG] Failed to start node power via REST:", err);
    }
    wsClientRef.current?.startNode(proj.id, nodeId);
  }, []);

  const handleShutdownNode = useCallback(async (nodeId) => {
    const proj = projectRef.current;
    try {
      await shutdownNodePower(proj.id, nodeId);
    } catch (err) {
      console.error("[NETLAB-APP-DEBUG] Failed to shutdown node via REST:", err);
    }
    wsClientRef.current?.shutdownNode(proj.id, nodeId);
  }, []);

  const handleResetNode = useCallback(async (nodeId) => {
    const proj = projectRef.current;
    try {
      await resetNodePower(proj.id, nodeId);
    } catch (err) {
      console.error("[NETLAB-APP-DEBUG] Failed to reset node via REST:", err);
    }
    wsClientRef.current?.resetNode(proj.id, nodeId);
  }, []);

  const handleStopNode = useCallback(async (nodeId) => {
    const proj = projectRef.current;
    try {
      await stopNodePower(proj.id, nodeId);
    } catch (err) {
      console.error("[NETLAB-APP-DEBUG] Failed to force stop node via REST:", err);
    }
    wsClientRef.current?.stopNode(proj.id, nodeId);
  }, []);

  const handleAddNodeFromTemplate = useCallback(
    async (tmpl) => {
      try {
        const proj = projectRef.current;
        const count = proj.nodes?.length || 0;
        const posX = 100 + (count % 3) * 240;
        const posY = 120 + Math.floor(count / 3) * 200;
        console.log("[NETLAB-APP-DEBUG] Adding node from template:", tmpl.id, { posX, posY });
        const newNode = await addNodeToProject(proj.id, tmpl.id, "", posX, posY);
        const updatedNodes = [...(proj.nodes || []), newNode];
        const updatedProject = { ...proj, nodes: updatedNodes };

        commitProjectUpdate(updatedProject, true);
        setSelectedNode(newNode);
      } catch (err) {
        console.error("[NETLAB-APP-DEBUG] Failed to add node from template:", err);
      }
    },
    [commitProjectUpdate],
  );

  const handleAddWire = useCallback(
    async (srcNodeId, srcPortId, dstNodeId, dstPortId) => {
      const proj = projectRef.current;
      console.log("[NETLAB-APP-DEBUG] Requesting wire creation:", {
        srcNodeId,
        srcPortId,
        dstNodeId,
        dstPortId,
        currentWires: proj.wires,
      });

      const isPortConnected = (nodeId, portId) => {
        return (proj.wires || []).some(
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

      const updatedWires = [...(proj.wires || []), newWire];
      const updatedProject = { ...proj, wires: updatedWires };
      console.log("[NETLAB-APP-DEBUG] Wire created successfully:", newWire);
      commitProjectUpdate(updatedProject, true);
    },
    [commitProjectUpdate],
  );

  const handleDeleteWire = useCallback(
    async (wireId) => {
      const proj = projectRef.current;
      console.log("[NETLAB-APP-DEBUG] Deleting wire:", wireId);
      const updatedWires = (proj.wires || []).filter((w) => w.id !== wireId);
      const updatedProject = { ...proj, wires: updatedWires };
      commitProjectUpdate(updatedProject, true);
    },
    [commitProjectUpdate],
  );

  const handleUpdateWire = useCallback(
    async (updatedWire) => {
      const proj = projectRef.current;
      console.log("[NETLAB-APP-DEBUG] Updating wire:", updatedWire);
      const updatedWires = (proj.wires || []).map((w) =>
        w.id === updatedWire.id ? updatedWire : w,
      );
      const updatedProject = { ...proj, wires: updatedWires };
      commitProjectUpdate(updatedProject, true);

      if (updatedWire.conditions) {
        wsClientRef.current?.setWireCondition(updatedWire.id, updatedWire.conditions);
      }
      if (updatedWire.tzspTarget !== undefined) {
        wsClientRef.current?.enableTZSP(updatedWire.id, updatedWire.tzspTarget);
      }
    },
    [commitProjectUpdate],
  );

  const handleUpdateNode = useCallback(
    async (updatedNode) => {
      const proj = projectRef.current;
      console.log("[NETLAB-APP-DEBUG] Updating node:", updatedNode);
      const updatedNodes = (proj.nodes || []).map((n) =>
        n.id === updatedNode.id ? updatedNode : n,
      );
      const updatedProject = { ...proj, nodes: updatedNodes };
      setSelectedNode(updatedNode);
      commitProjectUpdate(updatedProject, true);
    },
    [commitProjectUpdate],
  );

  const handleDeleteNode = useCallback(
    async (nodeId) => {
      const proj = projectRef.current;
      console.log("[NETLAB-APP-DEBUG] Deleting node:", nodeId);
      const updatedNodes = (proj.nodes || []).filter((n) => n.id !== nodeId);
      const updatedWires = (proj.wires || []).filter(
        (w) => w.srcNodeId !== nodeId && w.dstNodeId !== nodeId,
      );
      const updatedProject = { ...proj, nodes: updatedNodes, wires: updatedWires };
      setSelectedNode(null);
      commitProjectUpdate(updatedProject, true);
    },
    [commitProjectUpdate],
  );

  const handleSelectNode = useCallback((node) => {
    setSelectedNode(node);
  }, []);

  return (
    <div className="app-container">
      <Toolbar
        projectName={project.name}
        projects={projects}
        currentProjectId={project.id}
        onSwitchProject={handleSwitchProject}
        onCreateProject={handleCreateProject}
        onCloneProject={handleCloneProject}
        onDeleteProject={handleDeleteProject}
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
        onOpenTerminal={handleOpenTerminal}
      />

      <div className="main-content">
        <Canvas
          nodes={project.nodes || []}
          wires={project.wires || []}
          wireStats={wireStats}
          templates={templates}
          activeTool={activeTool}
          selectedNode={selectedNode}
          onSelectNode={handleSelectNode}
          onAddWire={handleAddWire}
          onDeleteWire={handleDeleteWire}
          onDeleteNode={handleDeleteNode}
          onUpdateNode={handleUpdateNode}
        />

        <Sidebar
          selectedNode={selectedNode}
          onClose={() => setSelectedNode(null)}
          templates={templates}
          nodes={project.nodes || []}
          wires={project.wires || []}
          onOpenTerminal={handleOpenTerminal}
          onUpdateNode={handleUpdateNode}
          onDeleteNode={handleDeleteNode}
          onUpdateWire={handleUpdateWire}
          onStartNode={handleStartNode}
          onShutdownNode={handleShutdownNode}
          onResetNode={handleResetNode}
          onStopNode={handleStopNode}
        />

        <AddDeviceModal
          templates={templates}
          isOpen={isAddDeviceOpen}
          onClose={() => setIsAddDeviceOpen(false)}
          onSelectTemplate={handleAddNodeFromTemplate}
        />

        {activeTerminalNodes.length > 0 &&
          (() => {
            const isNodeDetached = (nodeId) => {
              try {
                const saved = localStorage.getItem(`netlab_terminal_${nodeId}`);
                if (saved) return Boolean(JSON.parse(saved).isDetached);
              } catch (err) {
                // ignore
              }
              return false;
            };

            const dockedNodes = activeTerminalNodes.filter((n) => !isNodeDetached(n.id));
            const detachedNodes = activeTerminalNodes.filter((n) => isNodeDetached(n.id));

            return (
              <>
                {dockedNodes.length > 0 && (
                  <div
                    className="terminal-dock-container"
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      width: "100%",
                      display: "flex",
                      alignItems: "flex-end",
                      zIndex: 30,
                    }}
                  >
                    {dockedNodes.map((node, idx) => {
                      const isFocused = focusedTerminalNodeId === node.id;
                      return (
                        <div key={node.id} style={{ flex: 1, minWidth: 0 }}>
                          <TerminalWindow
                            projectId={project.id}
                            node={node}
                            terminalIndex={idx}
                            totalTerminals={dockedNodes.length}
                            isFocused={isFocused}
                            onFocus={() => handleFocusTerminal(node.id)}
                            onClose={() =>
                              setActiveTerminalNodes((prev) => prev.filter((n) => n.id !== node.id))
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {detachedNodes.map((node, idx) => {
                  const isFocused = focusedTerminalNodeId === node.id;
                  const orderIdx = terminalOrder.indexOf(node.id);
                  const computedZIndex =
                    orderIdx >= 0 ? 200 + orderIdx * 10 : isFocused ? 290 : 200 + idx;

                  return (
                    <TerminalWindow
                      key={node.id}
                      projectId={project.id}
                      node={node}
                      terminalIndex={dockedNodes.length + idx}
                      totalTerminals={activeTerminalNodes.length}
                      isFocused={isFocused}
                      zIndex={computedZIndex}
                      onFocus={() => handleFocusTerminal(node.id)}
                      onClose={() =>
                        setActiveTerminalNodes((prev) => prev.filter((n) => n.id !== node.id))
                      }
                    />
                  );
                })}
              </>
            );
          })()}
      </div>
    </div>
  );
}
