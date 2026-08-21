import { Canvas as FabricCanvas, Group, Line, loadSVGFromString, Rect } from "fabric";
import { useCallback, useEffect, useRef } from "react";
import { fetchTemplateDrawing } from "../services/api";

export function Canvas({ nodes, wires, templates, onSelectNode, onAddWire, onDeleteWire }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const wiringStateRef = useRef({
    active: false,
    srcNodeId: null,
    srcPortId: null,
    tempLine: null,
  });

  const cancelWiring = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (wiringStateRef.current.tempLine && canvas) {
      canvas.remove(wiringStateRef.current.tempLine);
    }
    wiringStateRef.current = { active: false, srcNodeId: null, srcPortId: null, tempLine: null };
    if (canvas) canvas.requestRenderAll();
  }, []);

  // Initialize Fabric Canvas
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const canvas = new FabricCanvas(canvasRef.current, {
      width,
      height,
      backgroundColor: "#090d16",
      selection: true,
      subTargetCheck: true,
    });

    fabricCanvasRef.current = canvas;

    const handleResize = () => {
      if (containerRef.current && fabricCanvasRef.current) {
        fabricCanvasRef.current.setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener("resize", handleResize);

    // Click handler for nodes, ports, and wiring mode
    canvas.on("mouse:down", (opt) => {
      const target = opt.target;
      const subTarget = opt.subTarget;

      // Check if user clicked directly on a port inside an SVG device group
      if (target?.isNodeGroup && subTarget?.portId) {
        opt.e.stopPropagation();
        const portId = subTarget.portId;
        const node = target.nodeData;
        const portAbsPos = target.getPortAbsPosition(portId);

        if (!wiringStateRef.current.active) {
          // Start wire creation from this port
          wiringStateRef.current = {
            active: true,
            srcNodeId: node.id,
            srcPortId: portId,
            tempLine: new Line([portAbsPos.x, portAbsPos.y, portAbsPos.x, portAbsPos.y], {
              stroke: "#3b82f6",
              strokeWidth: 3,
              strokeDashArray: [6, 4],
              selectable: false,
              evented: false,
            }),
          };
          canvas.add(wiringStateRef.current.tempLine);
        } else {
          // Complete wire connection to destination port
          const { srcNodeId, srcPortId } = wiringStateRef.current;
          if (srcNodeId !== node.id || srcPortId !== portId) {
            onAddWire(srcNodeId, srcPortId, node.id, portId);
          }
          cancelWiring();
        }
        return;
      }

      // Select node on click
      if (target?.isNodeGroup) {
        onSelectNode(target.nodeData);
      } else if (!target) {
        onSelectNode(null);
        if (wiringStateRef.current.active) {
          cancelWiring();
        }
      }
    });

    // Live mouse move during wiring mode
    canvas.on("mouse:move", (opt) => {
      if (wiringStateRef.current.active && wiringStateRef.current.tempLine) {
        const pointer = canvas.getScenePoint(opt.e);
        wiringStateRef.current.tempLine.set({ x2: pointer.x, y2: pointer.y });
        canvas.requestRenderAll();
      }
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      canvas.dispose();
    };
  }, [cancelWiring, onSelectNode, onAddWire]);

  // Render/Sync Nodes and Wires on Canvas
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    canvas.clear();
    canvas.backgroundColor = "#090d16";

    const nodeGroupsMap = new Map();

    const renderAll = async () => {
      // 1. Load and render each device node exact SVG
      for (const node of nodes) {
        const tmpl = templates.find((t) => t.id === node.templateId);
        let svgStr = "";
        try {
          if (tmpl) {
            svgStr = await fetchTemplateDrawing(tmpl.id);
          }
        } catch (err) {
          console.error(`Failed to load SVG for template ${node.templateId}:`, err);
        }

        const nodeGroup = await createExactSVGDeviceGroup(node, tmpl, svgStr, wires);
        nodeGroup.on("moving", () => {
          node.x = nodeGroup.left;
          node.y = nodeGroup.top;
          updateWirePositions(canvas, nodes, wires, nodeGroupsMap);
        });

        canvas.add(nodeGroup);
        nodeGroupsMap.set(node.id, nodeGroup);
      }

      // 2. Render Wires connecting exact port SVG locations
      updateWirePositions(canvas, nodes, wires, nodeGroupsMap, onDeleteWire);

      canvas.requestRenderAll();
    };

    renderAll();
  }, [nodes, wires, templates, onDeleteWire]);

  return (
    <div className="canvas-wrapper" ref={containerRef}>
      <canvas ref={canvasRef} id="netlab-canvas" />
    </div>
  );
}

// Update Wire Lines on Canvas between exact SVG port anchor positions
function updateWirePositions(canvas, _nodes, wires, nodeGroupsMap, onDeleteWire) {
  // Remove existing lines
  const existingLines = canvas.getObjects("line").filter((obj) => obj.isWireLine);
  for (const lineObj of existingLines) {
    canvas.remove(lineObj);
  }

  for (const wire of wires) {
    const srcGroup = nodeGroupsMap.get(wire.srcNodeId);
    const dstGroup = nodeGroupsMap.get(wire.dstNodeId);

    if (srcGroup && dstGroup) {
      const p1 = srcGroup.getPortAbsPosition(wire.srcPortId);
      const p2 = dstGroup.getPortAbsPosition(wire.dstPortId);

      const wireLine = new Line([p1.x, p1.y, p2.x, p2.y], {
        stroke: "#10b981",
        strokeWidth: 3,
        selectable: true,
        hasControls: false,
      });
      wireLine.isWireLine = true;
      wireLine.wireData = wire;

      if (onDeleteWire) {
        wireLine.on("mousedblclick", () => {
          onDeleteWire(wire.id);
        });
      }

      canvas.add(wireLine);
      canvas.sendObjectToBack(wireLine);
    }
  }
}

// Parses exact SVG string from $HOME/.netlabctl/devices, applies node state to elements, and builds Fabric Group
async function createExactSVGDeviceGroup(node, tmpl, svgStr, wires) {
  let svgObjects = [];

  if (svgStr) {
    try {
      const parsed = await loadSVGFromString(svgStr);
      if (parsed.objects && parsed.objects.length > 0) {
        svgObjects = parsed.objects.filter((o) => o !== null);
      }
    } catch (e) {
      console.warn("Failed to parse exact device SVG:", e);
    }
  }

  // Fallback if SVG missing
  if (svgObjects.length === 0) {
    const fallbackBox = new Rect({
      width: 120,
      height: 80,
      fill: "#1e293b",
      stroke: "#3b82f6",
      strokeWidth: 2,
      rx: 8,
      ry: 8,
    });
    svgObjects.push(fallbackBox);
  }

  // Process and style SVG elements according to netlabctl rules
  const processElement = (obj) => {
    const elemId = obj.id || "";

    // 1. Name Status Text: update text content to machine name
    if (elemId === "status-name" || elemId === "device-name" || elemId.includes("name")) {
      if (typeof obj.set === "function") {
        obj.set({ text: node.name });
      }
    }

    // 2. Power Status Indicator: apply .on / .off styling
    if (elemId === "status-power" || elemId === "device-power" || elemId.includes("power")) {
      const isPoweredOn = node.isPoweredOn || false; // default off in canvas design
      const powerColor = isPoweredOn ? "#00ff00" : "#ff0000";
      if (typeof obj.set === "function") {
        obj.set({ fill: powerColor });
      }
    }

    // 3. Port Elements: apply .connected, .disconnected, .user, .qemu states
    const nodePorts = node.ports || tmpl?.ports || [];
    nodePorts.forEach((port) => {
      const isMatch =
        elemId === port.id ||
        elemId === `port-${port.name}` ||
        elemId === `device-port-${port.id}` ||
        elemId.endsWith(port.id);

      if (isMatch) {
        obj.portId = port.id;
        obj.hoverCursor = "pointer";

        // Check if connected to any wire
        const isConnected = wires.some(
          (w) =>
            (w.srcNodeId === node.id && w.srcPortId === port.id) ||
            (w.dstNodeId === node.id && w.dstPortId === port.id),
        );

        let portColor = "#4d4d4d"; // .disconnected
        if (isConnected) {
          portColor = "#00ff00"; // .connected (green)
        } else if (port.netdevType === "user") {
          portColor = "#0000ff"; // .user (blue)
        } else if (port.netdevType === "qemu") {
          portColor = "#8800ff"; // .qemu (purple)
        }

        if (typeof obj.set === "function") {
          obj.set({ fill: portColor });
        }
      }
    });

    if (obj._objects && Array.isArray(obj._objects)) {
      obj._objects.forEach(processElement);
    }
  };

  svgObjects.forEach(processElement);

  const nodeGroup = new Group(svgObjects, {
    left: node.x,
    top: node.y,
    selectable: true,
    hasControls: false,
    subTargetCheck: true,
  });

  nodeGroup.isNodeGroup = true;
  nodeGroup.nodeData = node;

  // Function to calculate exact absolute canvas coordinates of an SVG port anchor
  nodeGroup.getPortAbsPosition = (portId) => {
    // Traverse group objects to find matching port element
    let targetPortObj = null;

    const findPort = (objs) => {
      for (const obj of objs) {
        if (
          obj.portId === portId ||
          obj.id === portId ||
          obj.id === `port-${portId}` ||
          obj.id === `device-port-${portId}`
        ) {
          targetPortObj = obj;
          return;
        }
        if (obj._objects) findPort(obj._objects);
      }
    };
    findPort(nodeGroup.getObjects());

    if (targetPortObj) {
      // Get center point of port object relative to group center
      const center = targetPortObj.getCenterPoint();
      return {
        x: nodeGroup.left + (center.x + nodeGroup.width / 2),
        y: nodeGroup.top + (center.y + nodeGroup.height / 2),
      };
    }

    // Default fallback port coordinate if element id not found
    return {
      x: nodeGroup.left + nodeGroup.width / 2,
      y: nodeGroup.top + nodeGroup.height / 2,
    };
  };

  return nodeGroup;
}
