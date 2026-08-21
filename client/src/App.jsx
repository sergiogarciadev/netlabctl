import React, { useState, useEffect, useRef } from 'react';
import { Toolbar } from './components/Toolbar';
import { Canvas } from './components/Canvas';
import { Sidebar } from './components/Sidebar';
import { TerminalWindow } from './components/TerminalWindow';
import { fetchTemplates, fetchProjects, WSClient } from './services/api';

export function App() {
  const [templates, setTemplates] = useState([]);
  const [project, setProject] = useState({ id: 'default', name: 'Sample Network Lab', nodes: [], wires: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [activeTerminalNode, setActiveTerminalNode] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const wsClientRef = useRef(null);

  useEffect(() => {
    // Load initial machine templates
    fetchTemplates()
      .then(setTemplates)
      .catch((err) => console.error('Failed to load templates:', err));

    // Connect WebSocket
    const ws = new WSClient((msg) => {
      if (msg.type === 'project_state') {
        setProject(msg.data);
      }
    });
    ws.connect();
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

  const handleAddDevice = () => {
    if (templates.length === 0) return;
    const tmpl = templates[0];
    const newNode = {
      id: `node-${Date.now()}`,
      templateId: tmpl.id,
      name: `${tmpl.name} ${project.nodes.length + 1}`,
      x: 100 + project.nodes.length * 140,
      y: 150,
      ports: tmpl.ports.map((p, idx) => ({
        id: p.id,
        name: p.name,
        mac: `52:00:00:00:00:0${idx + 1}`,
        netdevType: p.type,
      })),
    };

    const updatedNodes = [...project.nodes, newNode];
    setProject((prev) => ({ ...prev, nodes: updatedNodes }));
    setSelectedNode(newNode);
  };

  return (
    <div className="app-container">
      <Toolbar
        projectName={project.name}
        isRunning={isRunning}
        onStart={handleStartLab}
        onStop={handleStopLab}
        onAddDevice={handleAddDevice}
        selectedNode={selectedNode}
        onOpenTerminal={(node) => setActiveTerminalNode(node)}
      />

      <div className="main-content">
        <Canvas
          nodes={project.nodes}
          wires={project.wires}
          onSelectNode={(node) => setSelectedNode(node)}
        />

        <Sidebar
          selectedNode={selectedNode}
          onClose={() => setSelectedNode(null)}
          templates={templates}
          onOpenTerminal={(node) => setActiveTerminalNode(node)}
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
