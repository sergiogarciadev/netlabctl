# AGENTS.md — Key Lessons Learned & Development Guidelines for netlabctl

## 1. Project Overview & Architecture
- **Backend**: Go application located under `cmd/netlabctl`, REST API, WebSocket server, and storage manager under `internal/`. Persistent state lives in `$HOME/.netlabctl`.
- **Client**: React SPA using Vite, Lucide icons, and Fabric.js canvas located under `client/src`.
- **Device Templates**: Pre-existing templates in `$HOME/.netlabctl/devices/` (e.g. `Mikrotik-4port`, `Mikrotik-8port`). Templates define `machine.json` or `template.json` and SVG drawings `drawing.svg`.
- **Deterministic MAC Generator**: Port MAC addresses must use base prefix `0x52` + 5 random bytes from `crypto/rand`. Subsequent ports on the same node use strictly incrementing sequential MACs.

---

## 2. Fabric.js v6 Lessons Learned & Pitfalls

### Canvas Viewport & Zoom Preservation
- **`canvas.clear()` Resets Viewport**: Calling `canvas.clear()` in Fabric.js v6 resets `canvas.viewportTransform` back to identity scale `[1, 0, 0, 1, 0, 0]`.
  - *Lesson*: Always store `viewportTransformRef.current = [...canvas.viewportTransform]` during zoom/pan events, and restore it via `canvas.setViewportTransform(viewportTransformRef.current)` immediately after clearing.
- **Selection Events Reset Zoom**: Fabric's default selection handlers (`selection:created`, `selection:updated`, `selection:cleared`) recalculate selection bounds and reset viewport scale when zoomed.
  - *Lesson*: Attach `lockViewportTransform()` handlers to selection events and lock group scaling/rotation controls (`lockScalingX: true`, `lockScalingY: true`, `lockRotation: true`, `hasBorders: false`, `hasControls: false`).

### Shortest-Path Parallel Non-Crossing Manhattan Wire Routing Rules
- **Rule 1 (Parallel Segments)**: Each port index receives a unique 14px track spacing (`trackOffset = (portIndex - 1) * 14px`). Every horizontal and vertical segment maintains this gap so wires never merge.
- **Rule 2 (Device Box Avoidance)**: Extracted padded device bounding boxes `getNodeBoundingBox(group)`. Candidate paths are evaluated with `pathIntersectsAnyDevice(path, allDeviceBoxes)` to guarantee ZERO intersections with any device on the canvas.
- **Rule 3 (Bottom Exit/Entry)**: All wires drop DOWNWARDS below the device bottom boundary (`srcBottom + 22px + trackOffset`) before turning, and enter UPWARDS from below the destination bottom boundary.
- **Rule 4 (Shortest Path Selection)**: Evaluates candidate corridors (direct vertical midpoint, bottom channel, right side bypass, left side bypass), filters out device intersections, and selects the shortest valid path (`calculatePathLength`).

### Performance & React State Isolation
- **Flicker Elimination During Dragging**: Triggering React state updates in parent components (`App.jsx`) on `mouse:move` causes continuous full app re-renders and canvas clearing.
  - *Lesson*: Keep transient canvas HUD telemetry (mouse coordinates, hovered targets, rubberband wire lines) strictly isolated within `Canvas.jsx` local state or refs. Use `nodeGroup.on("moving")` to update connected wire endpoints directly in-place at 60 FPS without clearing the canvas.

### Tool Modes & SubTarget Event Handling
- **Select vs. Wire Mode Isolation**:
  - In **Select Tool Mode**: Device SVG groups are draggable (`selectable: true`). Clicking devices opens Sidebar properties.
  - In **Wire Tool Mode**: Cursor switches to `crosshair`. Device groups are non-draggable (`selectable: false`). Clicking ports or near port anchors connects wires.
- **SubTarget Check**: Enable `subTargetCheck: true` on parent `fabric.Group` and recursively tag child elements with `portId` and cursor hints so sub-element clicks hit port targets reliably.

### Fabric.js Object Animations inside React Effects
- **React Commit Phase vs. Fabric Render Queue**: Triggering Fabric.js canvas object additions/animations (`canvas.add()`, `canvas.bringObjectToFront()`, `requestAnimationFrame()`) synchronously inside a React `useEffect` hook triggered by state updates causes Fabric's `requestRenderAll()` queue to be overridden or cancelled during React's commit phase DOM flush.
  - *Lesson*: Defer Fabric object additions and animation triggers using `setTimeout(() => triggerCircleAnimation(fabricCanvasRef.current, ...), 0)` to push canvas mutations into the macro-task queue *after* React has completed its commit phase and DOM flush.

---

## 3. Machine Properties & Sidebar Guidelines
- **System Specifications**: Memory (RAM) and vCPU (SMP) are stored per node on `model.Node` and are editable. Default values inherit from device template `machine.json`.
- **Scripts**: Userdata and metadata cloud-init script templates support `${{{ model.var }}}` placeholders.
- **Per-Port Connection Status & TZSP Forwarding**: Each port item card displays live connection status (`Connected → TargetDevice (targetPort)` vs `Disconnected`) and has its own dedicated **Forward Frames (TZSP)** UDP mirroring target button.

---

## 4. QEMU Simulation, Managed Network & Serial Console Guidelines

### Managed Network Sockets & Port Keying
- **Composite Port Keys**: Never key port address maps using template port IDs alone (e.g. `device-port-1`), as they are identical across devices. Always use a composite key `nodeID + ":" + portID` (e.g. `node-1:device-port-1` vs `node-2:device-port-1`).
- **Unique `127.0.N.P:PORT` Allocation**: Every port on every node is assigned a unique loopback IP `127.0.N.P` and TCP port `10000 + N*20 + P`. Do not use `-netdev user` driver.
- **Managed Network Listeners**: `ManagedNetwork` opens TCP listeners on `127.0.N.P:PORT`. QEMU instances connect using `-netdev socket,id=net<i&>,connect=127.0.<N>.<P>:<PORT>`.

### QEMU Stream Socket 4-Byte Framing
- **Packet Header Requirement**: QEMU stream socket netdevs prefix every Ethernet frame with a **4-byte big-endian network byte order length field** (`uint32_t len`).
- **Stream Forwarding**: When forwarding packets through a Go TCP proxy bridge (`WireBridge`), parse and forward the 4-byte length header along with the frame payload (`binary.BigEndian.Uint32(header)`). This preserves ICMP pings and Ethernet frame boundaries.

### QEMU Monitor UNIX Socket (`set_link`)
- **Monitor Parameter**: Pass `-monitor unix:<nodeDir>/monitor.sock,server,nowait` on QEMU startup.
- **Link Status Reporting**: Send HMP command `set_link eth<i&> on` for connected wire ports, and `set_link eth<i&> off` for unconnected ports over the node's QEMU monitor socket.

### Vite Dev Server & Serial Console Connection
- **Vite WebSocket Proxy**: In `vite.config.js`, set `ws: true` for the `/api` proxy rule (in addition to `/ws`).
- **Terminal Host Resolution**: In `TerminalWindow.jsx`, resolve host to port `8080` when running under Vite dev mode (`window.location.port === "3000"`).
- **Standby & Auto-Reconnect**: When a machine is powered off, display `Machine is powered off. Waiting for machine to start...` in `xterm.js`. Automatically poll and reconnect to the node's QEMU `serial.sock` as soon as the simulation is launched.

---

## 5. Frontend Code Quality & Biome Guidelines
- **Lint Verification Requirement**: Always run `cd client && npm run lint` before declaring frontend tasks complete to verify formatting and React hook exhaustive dependencies.
- **System Biome Version**: Use system Biome version `2.5.9` (`@biomejs/biome: "^2.5.9"` in `client/package.json`) and configure `client/biome.json` with `files.include` and `files.ignore` arrays.
