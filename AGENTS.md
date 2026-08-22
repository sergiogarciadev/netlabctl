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

### SVG Object Hierarchy & Nested Group Transformations
- **Nested SVG Groups**: `loadSVGFromString` parses nested SVG `<g>` elements (e.g., `<g class="device-ports" transform="translate(13 30)">` -> `<g id="device-port-1">`) into nested Fabric Groups.
- **`calcTransformMatrix` Parent Chain Truncation**: Calling `obj.calcTransformMatrix()` on deeply nested child objects inside a Group hierarchy does not automatically include outer group transform matrices.
  - *Lesson*: Use deterministic relative port anchor maps (`nodeGroup.portRelativePositions.set(port.id, { x, y })`) relative to node top-left `(0, 0)`, or multiply parent group matrices using `util.multiplyTransformMatrices(parentMatrix, childMatrix)` to compute exact scene coordinates.

### Performance & React State Isolation
- **Flicker Elimination During Dragging**: Triggering React state updates in parent components (`App.jsx`) on `mouse:move` causes continuous full app re-renders and canvas clearing.
  - *Lesson*: Keep transient canvas HUD telemetry (mouse coordinates, hovered targets, rubberband wire lines) strictly isolated within `Canvas.jsx` local state or refs. Use `nodeGroup.on("moving")` to update connected wire endpoints directly in-place at 60 FPS without clearing the canvas.

### Tool Modes & SubTarget Event Handling
- **Select vs. Wire Mode Isolation**:
  - In **Select Tool Mode**: Device SVG groups are draggable (`selectable: true`). Clicking devices opens Sidebar properties.
  - In **Wire Tool Mode**: Cursor switches to `crosshair`. Device groups are non-draggable (`selectable: false`). Clicking ports or near port anchors connects wires.
- **SubTarget Check**: Enable `subTargetCheck: true` on parent `fabric.Group` and recursively tag child elements with `portId` and cursor hints so sub-element clicks hit port targets reliably.

---

## 3. Machine Properties & Sidebar Guidelines
- **System Specifications**: Memory (RAM) and vCPU (SMP) are stored per node on `model.Node` and are editable. Default values inherit from device template `machine.json`.
- **Scripts**: Userdata and metadata cloud-init script templates support `${{{ model.var }}}` placeholders.
- **Per-Port Connection Status & TZSP Forwarding**: Each port item card displays live connection status (`Connected → TargetDevice (targetPort)` vs `Disconnected`) and has its own dedicated **Forward Frames (TZSP)** UDP mirroring target button.
