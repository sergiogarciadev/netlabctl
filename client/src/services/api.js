// API Service for netlabctl REST endpoints & WebSocket connections

export async function fetchTemplates() {
  const res = await fetch("/api/templates");
  if (!res.ok) throw new Error("Failed to fetch machine templates");
  return res.json();
}

export async function fetchTemplateDrawing(templateId) {
  const res = await fetch(`/api/templates/${templateId}/drawing`);
  if (!res.ok) throw new Error(`Failed to fetch SVG for template ${templateId}`);
  return res.text();
}

export async function fetchProjects() {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function fetchProject(id) {
  const res = await fetch(`/api/projects/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch project ${id}`);
  return res.json();
}

export async function createProject(project) {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
  if (!res.ok) throw new Error("Failed to create project");
  return res.json();
}

export async function updateProject(id, project) {
  const res = await fetch(`/api/projects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
  if (!res.ok) throw new Error("Failed to update project");
  return res.json();
}

export async function cloneProject(id, newName) {
  const res = await fetch(`/api/projects/${id}/clone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) throw new Error("Failed to clone project");
  return res.json();
}

export async function deleteProject(id) {
  const res = await fetch(`/api/projects/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete project");
  return true;
}

export async function addNodeToProject(projectId, templateId, name, x, y) {
  const res = await fetch(`/api/projects/${projectId}/nodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId, name, x, y }),
  });
  if (!res.ok) throw new Error("Failed to add node to project");
  return res.json();
}

export async function startProjectSimulation(projectId, startNodes = true) {
  const res = await fetch(`/api/projects/${projectId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startNodes }),
  });
  if (!res.ok) throw new Error("Failed to start project simulation");
  return res.json();
}

export async function stopProjectSimulation(projectId) {
  const res = await fetch(`/api/projects/${projectId}/stop`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to stop project simulation");
  return res.json();
}

export async function startNodePower(projectId, nodeId) {
  const res = await fetch(`/api/projects/${projectId}/nodes/${nodeId}/start`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Failed to start node ${nodeId}`);
  return res.json();
}

export async function stopNodePower(projectId, nodeId) {
  const res = await fetch(`/api/projects/${projectId}/nodes/${nodeId}/stop`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Failed to stop node ${nodeId}`);
  return res.json();
}

export class WSClient {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.ws = null;
    this.connected = false;
    this.intentionalClose = false;
    this.currentProjectId = "default";
  }

  connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      console.log("[WS] Connected to netlabctl server");
      if (this.currentProjectId) {
        this.send("subscribe_project", { projectId: this.currentProjectId });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (this.onMessage) this.onMessage(msg);
      } catch (err) {
        console.error("[WS] Failed to parse message", err);
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      if (this.intentionalClose) return;
      console.log("[WS] Disconnected, reconnecting in 2s...");
      setTimeout(() => this.connect(), 2000);
    };
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.ws) this.ws.close();
  }

  send(type, data) {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  subscribeProject(projectId) {
    this.currentProjectId = projectId;
    this.send("subscribe_project", { projectId });
  }

  startSimulation(projectId, startNodes = true) {
    this.send("start_simulation", { projectId, startNodes });
    this.send("start_project", { projectId, startNodes });
  }

  stopSimulation(projectId) {
    this.send("stop_simulation", { projectId });
  }

  startNode(projectId, nodeId) {
    this.send("start_node", { projectId, nodeId });
  }

  stopNode(projectId, nodeId) {
    this.send("stop_node", { projectId, nodeId });
  }

  setWireCondition(wireId, conditions) {
    this.send("set_wire_condition", { wireId, conditions });
  }

  enableTZSP(wireId, targetUdp) {
    this.send("enable_tzsp", { wireId, targetUdp });
  }

  sendTerminalInput(projectId, nodeId, data) {
    this.send("terminal_input", { projectId, nodeId, data });
  }
}
