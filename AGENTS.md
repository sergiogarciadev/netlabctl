# AGENTS.md — Key Lessons Learned & Development Guidelines for netlabctl

## 1. Project Overview & Architecture
- **Backend**: Go 1.22+ application under `cmd/netlabctl`, REST API, WebSocket server, QEMU process manager, and storage manager under `internal/`. Persistent state lives under `$HOME/.netlabctl`.
- **Client**: React SPA using Vite, Lucide icons, xterm.js, and Fabric.js (v7.4.0) located under `client/src`.
- **Embedded Device Templates**: Pre-packaged templates in `./devices` are embedded into the Go binary (`devices/embedded.go`) via `//go:embed *`. If `$HOME/.netlabctl/devices/` does not exist or is empty, `Storage` automatically extracts them on startup.
- **Dedicated Image Storage**: Centralized disk image storage lives under `$HOME/.netlabctl/images/`.
- **Deterministic MAC Generator**: Port MAC addresses use prefix `0x52` + 5 random bytes from `crypto/rand`. Subsequent ports on the same node use strictly incrementing sequential MACs.

---

## 2. Fabric.js v7 & Canvas Performance Lessons Learned

### Canvas Viewport & Zoom Preservation
- **`canvas.clear()` Resets Viewport**: Calling `canvas.clear()` in Fabric.js resets `canvas.viewportTransform` back to identity scale `[1, 0, 0, 1, 0, 0]`. Always store `viewportTransformRef.current = [...canvas.viewportTransform]` during zoom/pan events, and restore via `canvas.setViewportTransform(...)` immediately after clearing.
- **Selection Events Reset Zoom**: Attach `lockViewportTransform()` handlers to selection events (`selection:created`, `selection:updated`, `selection:cleared`) and lock group scaling/rotation controls (`lockScalingX: true`, `lockScalingY: true`, `lockRotation: true`, `hasBorders: false`, `hasControls: false`).

### Fabric.js v7 Import Schema
- **Fabric v7 Symbols**: Import named symbols from `"fabric"`: `import { Canvas as FabricCanvas, Text as FabricText, Group, loadSVGFromString } from "fabric"`.

### Performance & React State Isolation
- **Eliminating `mouse:move` Re-renders**: Never call React state setters with raw mouse coordinates on every pixel moved. Use `lastDebugStateRef` to compare target element IDs (`nodeId`, `nearestPortId`, `hoveredWireId`) so `setDebugInfo` ONLY executes when hovering over a NEW element.
- **Preventing Canvas Destruction on Tool Change**: Never pass un-memoized array references to `useEffect` for `renderAll()`. Memoize `nodesKey` and `wiresKey` string primitives (`JSON.stringify(...)`). `renderAll()` and `canvas.clear()` execute ONLY when topology positions or connections change. Tool switching updates `group.selectable` and cursor hints in-place without clearing canvas objects.
- **Parallel SVG Parsing Cache**: `loadSVGFromString` parses XML string ONCE per template ID into `parsedSvgCache`. Node instances clone master Fabric objects concurrently via `Promise.all(masterObjects.map(o => o.clone()))`, completely eliminating sequential XML string parsing.

### Shortest-Path Parallel Non-Crossing Manhattan Wire Routing Rules
- **Rule 1 (Parallel Segments)**: Each port index receives a unique 14px track spacing (`trackOffset = (portIndex - 1) * 14px`). Every horizontal and vertical segment maintains this gap so wires never merge.
- **Rule 2 (Device Box Avoidance)**: Extracted padded device bounding boxes `getNodeBoundingBox(group)`. Candidate paths are evaluated with `pathIntersectsAnyDevice(path, allDeviceBoxes)` to guarantee ZERO intersections with any device on the canvas.
- **Rule 3 (Bottom Exit/Entry)**: All wires drop DOWNWARDS below the device bottom boundary (`srcBottom + 22px + trackOffset`) before turning, and enter UPWARDS from below the destination bottom boundary.
- **Rule 4 (Shortest Path Selection)**: Evaluates candidate corridors (direct vertical midpoint, bottom channel, right side bypass, left side bypass), filters out device intersections, and selects the shortest valid path (`calculatePathLength`).

### Tool Modes & SubTarget Event Handling
- **Select vs. Wire Mode Isolation**:
  - In **Select Tool Mode**: Device SVG groups are draggable (`selectable: true`). Clicking devices opens Sidebar properties.
  - In **Wire Tool Mode**: Cursor switches to `crosshair`. Device groups are non-draggable (`selectable: false`). Clicking ports or near port anchors connects wires.
- **SubTarget Check**: Enable `subTargetCheck: true` on parent `fabric.Group` and recursively tag child elements with `portId` and cursor hints so sub-element clicks hit port targets reliably.

---

## 3. Strict Disk Rules, Machine Properties & Sidebar Guidelines
- **Strict Disk Image Boot Rule**: A machine MUST NOT boot without a disk image. If `.imageExists` is false or the `.qcow2` file is missing from `$HOME/.netlabctl/images/`, QEMU startup aborts immediately with an error toast broadcast.
- **Canvas Disabled Visual Filter**: Devices missing disk images render with a dimmed opacity filter (`opacity: 0.4`) and a bright warning badge (`⚠️`) at top-left.
- **Sidebar Warning Banner**: The Machine Properties sidebar displays a prominent red warning banner when the selected node's template is missing its disk image.
- **Add Device Modal Group Tabs**: Templates support optional `group` properties (e.g. `"MikroTik"`, `"Cisco"`). Ungrouped templates fall under an `"Other"` tab. Cards for templates missing disk images display a red warning banner.
- **System Specifications**: Memory (RAM) and vCPU (SMP) are stored per node on `model.Node` and are editable. Default values inherit from device template `machine.json`.
- **Scripts**: Userdata and metadata cloud-init script templates support `${{{ model.var }}}` placeholders.
- **Per-Port Connection Status & TZSP Forwarding**: Each port item card displays live connection status (`Connected → TargetDevice (targetPort)` vs `Disconnected`) and has its own dedicated **Forward Frames (TZSP)** UDP mirroring target button.

---

## 4. QEMU Simulation, Managed Network, Signal Handling & Terminal Guidelines

### Process Lifecycle & OS Signal Handling
- **Guaranteed Server Shutdown**: `main.go` registers `SIGINT`, `SIGTERM`, `SIGHUP`, and `SIGQUIT` via `signal.Notify` and listens via a non-blocking `select` loop.
- **QEMU Process Cleanup**: Signal reception or HTTP server exit ALWAYS triggers `srv.Shutdown(ctx)`, which stops all QEMU process instances (`s.qemuMgr.StopAllNodes()`) and network socket proxies (`s.netMgr.StopAllProxies()`), eliminating orphaned QEMU processes.

### Managed Network Sockets & Port Keying
- **Composite Port Keys**: Never key port address maps using template port IDs alone (e.g. `device-port-1`). Always use composite key `nodeID + ":" + portID` (e.g. `node-1:device-port-1` vs `node-2:device-port-1`).
- **Unique `127.0.N.P:PORT` Allocation**: Every port on every node is assigned a unique loopback IP `127.0.N.P` and TCP port `10000 + N*20 + P`. Do not use `-netdev user` driver.
- **Managed Network Listeners**: `ManagedNetwork` opens TCP listeners on `127.0.N.P:PORT`. QEMU instances connect using `-netdev socket,id=net<i&>,connect=127.0.<N>.<P>:<PORT>`.

### QEMU Stream Socket 4-Byte Framing
- **Packet Header Requirement**: QEMU stream socket netdevs prefix every Ethernet frame with a 4-byte big-endian network byte order length field (`uint32_t len`).
- **Stream Forwarding**: Parse and forward the 4-byte length header along with frame payload (`binary.BigEndian.Uint32(header)`) in `WireBridge`.

### QEMU Monitor UNIX Socket (`set_link`)
- **Monitor Parameter**: Pass `-monitor unix:<nodeDir>/monitor.sock,server,nowait` on QEMU startup.
- **Link Status Reporting**: Send HMP command `set_link eth<i&> on` for connected wire ports, and `set_link eth<i&> off` for unconnected ports over the monitor socket.

### Cloud-Init ISO Generation
- Generates `cidata.iso` for NoCloud cloud-init when userdata/metadata is present. `RecreateNodeDisk` removes `cidata.iso` along with `disk.qcow2`.

### Vite Dev Server & Serial Console Connection
- **Vite WebSocket Proxy**: In `vite.config.js`, set `ws: true` for `/api` proxy rule (in addition to `/ws`).
- **Terminal Host Resolution**: In `TerminalWindow.jsx`, resolve host to port `8080` when running under Vite dev mode (`window.location.port === "3000"`).
- **Standby & Auto-Reconnect**: Display standby message in `xterm.js` when machine is powered off, and poll/reconnect automatically to `serial.sock` when simulation launches.

---

## 5. Frontend Code Quality & Biome Guidelines
- **Lint & Format Verification Requirement**: Always run `cd client && npm run format && npm run lint` before declaring frontend tasks complete to format files and verify React hook exhaustive dependencies.
- **System Biome Version**: Use system Biome version `2.5.10` (`@biomejs/biome: "^2.5.10"` in `client/package.json`) and execute formatting via `npm run format` (`biome format --write .`).
