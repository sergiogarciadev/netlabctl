# netlabctl API Documentation

`netlabctl` provides a REST API and real-time WebSocket protocol for controlling network lab topology simulations, device templates, QEMU process instances, disk overlay management, and serial console terminals.

Interactive Swagger UI documentation is served live at `http://localhost:8080/swagger` or `http://localhost:8080/docs`.

---

## Interactive Swagger UI & OpenAPI Spec

- **Swagger UI Interactive Documentation**: `http://localhost:8080/swagger` (or `/docs`)
- **OpenAPI 3.0 JSON Specification**: `http://localhost:8080/swagger/doc.json` (or `/api/docs/openapi.json`)

---

## REST API Reference

### 1. Device Templates & Images

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/templates` | List all available machine device templates |
| `POST` | `/api/templates/import` | Import a new template package (zip archive or directory) |
| `GET` | `/api/templates/{id}/drawing` | Fetch SVG canvas drawing template content for a template |
| `GET` | `/api/images` | List dedicated disk images in `~/.netlabctl/images/` |
| `POST` | `/api/images/upload` | Upload a disk image file (`.qcow2`, `.raw`, `.img`) |

---

### 2. Topology Projects

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/projects` | List all topology projects |
| `POST` | `/api/projects` | Create a new empty topology project |
| `POST` | `/api/projects/import` | Import a project topology JSON document |
| `GET` | `/api/projects/{id}` | Get project topology details (nodes, wires, status) |
| `PUT` | `/api/projects/{id}` | Save/update project topology configuration |
| `DELETE` | `/api/projects/{id}` | Delete a project topology and purge its node files |
| `POST` | `/api/projects/{id}/clone` | Duplicate an existing project topology |

---

### 3. Simulation Control

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/projects/{id}/start` | Launch simulation for all auto-start nodes in the project |
| `POST` | `/api/projects/{id}/stop` | Gracefully stop simulation (sends ACPI shutdown via QMP; pass `?force=true` or `{ "force": true }` to hard stop) |

---

### 4. Node Power & Lifecycle Operations

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/projects/{id}/nodes` | Add a new device node instance to a project topology |
| `POST` | `/api/projects/{id}/nodes/{nodeId}/start` | Power ON single node process |
| `POST` | `/api/projects/{id}/nodes/{nodeId}/shutdown` | Send ACPI powerdown signal via QMP monitor socket to single node |
| `POST` | `/api/projects/{id}/nodes/{nodeId}/reset` | Send system reset signal via QMP monitor socket to single node |
| `POST` | `/api/projects/{id}/nodes/{nodeId}/stop` | Force stop (terminate) single node QEMU process |
| `POST` | `/api/projects/{id}/nodes/{nodeId}/recreate-disk` | Recreate a fresh qcow2 disk overlay for single node |
| `DELETE` | `/api/projects/{id}/nodes/{nodeId}` | Remove node instance from project topology |

---

## WebSockets Reference

### 1. Main Telemetry & Canvas Event Stream (`ws://localhost:8080/ws`)

Connect to `/ws` to send real-time actions and receive live project updates.

#### Incoming Server Messages (`type`):
- `project_state`: Full updated topology JSON state.
- `wire_stats`: 100ms packet throughput and byte count metrics.
- `simulation_started` / `simulation_stopping` / `simulation_stopped`: Lab status transitions.
- `error`: Error notification message object (`{ "message": "...", "nodeId": "..." }`).

#### Outgoing Client Actions (`type`):
- `subscribe_project`: `{ "projectId": "default" }`
- `start_simulation`: `{ "projectId": "default" }`
- `stop_simulation`: `{ "projectId": "default", "force": false }`
- `start_node`: `{ "projectId": "default", "nodeId": "node-1" }`
- `shutdown_node`: `{ "projectId": "default", "nodeId": "node-1" }`
- `reset_node`: `{ "projectId": "default", "nodeId": "node-1" }`
- `stop_node`: `{ "projectId": "default", "nodeId": "node-1" }`

---

### 2. Serial Console Terminal WebSocket (`ws://localhost:8080/api/v1/projects/{id}/nodes/{nodeId}/terminal`)

Connect to this endpoint using xterm.js or standard WebSockets to stream interactive raw serial console I/O from QEMU's `serial.sock`.
