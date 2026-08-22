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

export async function addNodeToProject(projectId, templateId, name, x, y) {
  const res = await fetch(`/api/projects/${projectId}/nodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId, name, x, y }),
  });
  if (!res.ok) throw new Error("Failed to add node to project");
  return res.json();
}

export async function startProjectSimulation(projectId) {
  const res = await fetch(`/api/projects/${projectId}/start`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to start project simulation");
  return res.json();
}

export async function stopProjectSimulation(projectId) {
  const res = await fetch(`/api/projects/${projectId}/stop`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to stop project simulation");
  return res.json();
}

export class WSClient {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.ws = null;
    this.connected = false;
  }

  connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      console.log("[WS] Connected to netlabctl server");
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
      console.log("[WS] Disconnected, reconnecting in 2s...");
      setTimeout(() => this.connect(), 2000);
    };
  }

  send(type, data) {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  subscribeProject(projectId) {
    this.send("subscribe_project", { projectId });
  }

  startSimulation(projectId) {
    this.send("start_simulation", { projectId });
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

  sendTerminalInput(projectId, nodeId, data) {
    this.send("terminal_input", { projectId, nodeId, data });
  }
}
