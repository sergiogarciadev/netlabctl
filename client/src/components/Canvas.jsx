import { Canvas as FabricCanvas, Group, Line, loadSVGFromString, Rect } from "fabric";
import { useCallback, useEffect, useRef } from "react";
import { fetchTemplateDrawing } from "../services/api";

const svgCache = new Map();

export function Canvas({
  nodes,
  wires,
  templates,
  activeTool,
  onSelectNode,
  onAddWire,
  onDeleteWire,
  onDeleteNode,
}) {
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

    // Keyboard listener for Delete / Backspace key to remove selected device or wire
    const handleKeyDown = (e) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        const activeObj = canvas.getActiveObject();
        if (activeObj?.isNodeGroup && onDeleteNode) {
          onDeleteNode(activeObj.nodeData.id);
        } else if (activeObj?.isWireLine && onDeleteWire) {
          onDeleteWire(activeObj.wireData.id);
        }
      } else if (e.key === "Escape") {
        cancelWiring();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    // Click handler strictly honoring activeTool
    canvas.on("mouse:down", (opt) => {
      const target = opt.target;
      const subTarget = opt.subTarget;
      const pointer = canvas.getScenePoint(opt.e);

      // WIRE TOOL MODE ONLY
      if (activeTool === "wire") {
        if (target?.isNodeGroup) {
          let clickedPortId = subTarget?.portId;
          let portAbsPos = null;

          if (clickedPortId) {
            portAbsPos = target.getPortAbsPosition(clickedPortId);
          } else {
            const nearPort = findClosestPortInNode(target, pointer.x, pointer.y);
            if (nearPort) {
              clickedPortId = nearPort.portId;
              portAbsPos = nearPort.absPos;
            }
          }

          if (clickedPortId && portAbsPos) {
            opt.e.stopPropagation();
            const node = target.nodeData;

            if (!wiringStateRef.current.active) {
              // Start wire creation
              wiringStateRef.current = {
                active: true,
                srcNodeId: node.id,
                srcPortId: clickedPortId,
                tempLine: new Line([portAbsPos.x, portAbsPos.y, pointer.x, pointer.y], {
                  stroke: "#3b82f6",
                  strokeWidth: 3,
                  strokeDashArray: [6, 4],
                  selectable: false,
                  evented: false,
                }),
              };
              canvas.add(wiringStateRef.current.tempLine);
            } else {
              // Complete wire connection
              const { srcNodeId, srcPortId } = wiringStateRef.current;
              if (srcNodeId !== node.id || srcPortId !== clickedPortId) {
                onAddWire(srcNodeId, srcPortId, node.id, clickedPortId);
              }
              cancelWiring();
            }
            return;
          }
        }

        // Cancel wiring if clicked outside ports in wire mode
        if (wiringStateRef.current.active) {
          cancelWiring();
        }
        return;
      }

      // SELECT TOOL MODE ONLY
      if (activeTool === "select") {
        if (wiringStateRef.current.active) {
          cancelWiring();
        }

        if (target?.isNodeGroup) {
          onSelectNode(target.nodeData);
        } else if (!target) {
          onSelectNode(null);
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
      window.removeEventListener("keydown", handleKeyDown);
      canvas.dispose();
    };
  }, [cancelWiring, onSelectNode, onAddWire, onDeleteWire, onDeleteNode, activeTool]);

  // Sync Nodes and Wires without screen flickering
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    canvas.defaultCursor = activeTool === "wire" ? "crosshair" : "default";

    const nodeGroupsMap = new Map();

    const renderAll = async () => {
      // 1. Pre-fetch and cache SVG drawings
      for (const tmpl of templates) {
        if (!svgCache.has(tmpl.id)) {
          try {
            const svgStr = await fetchTemplateDrawing(tmpl.id);
            svgCache.set(tmpl.id, svgStr);
          } catch (err) {
            console.error(`Failed to prefetch SVG for ${tmpl.id}`, err);
          }
        }
      }

      // 2. Clear canvas and rebuild groups synchronously with cached SVGs
      canvas.clear();
      canvas.backgroundColor = "#090d16";

      for (const node of nodes) {
        const tmpl = templates.find((t) => t.id === node.templateId);
        const svgStr = tmpl ? svgCache.get(tmpl.id) || "" : "";

        const nodeGroup = await createExactSVGDeviceGroup(node, tmpl, svgStr, wires, activeTool);
        nodeGroup.on("moving", () => {
          node.x = nodeGroup.left;
          node.y = nodeGroup.top;
          updateWirePositions(canvas, nodes, wires, nodeGroupsMap);
        });

        canvas.add(nodeGroup);
        nodeGroupsMap.set(node.id, nodeGroup);
      }

      // 3. Render Wires
      updateWirePositions(canvas, nodes, wires, nodeGroupsMap, onDeleteWire);

      canvas.requestRenderAll();
    };

    renderAll();
  }, [nodes, wires, templates, onDeleteWire, activeTool]);

  return (
    <div className="canvas-wrapper" ref={containerRef}>
      <canvas ref={canvasRef} id="netlab-canvas" />
    </div>
  );
}

// Proximity helper to find port near mouse click
function findClosestPortInNode(nodeGroup, absClickX, absClickY, threshold = 20) {
  const nodeData = nodeGroup.nodeData;
  if (!nodeData?.ports) return null;

  for (const port of nodeData.ports) {
    const portPos = nodeGroup.getPortAbsPosition(port.id);
    const dx = absClickX - portPos.x;
    const dy = absClickY - portPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= threshold) {
      return { portId: port.id, absPos: portPos };
    }
  }
  return null;
}

// Update Wire Lines on Canvas between exact SVG port anchor positions
function updateWirePositions(canvas, _nodes, wires, nodeGroupsMap, onDeleteWire) {
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

// Builds Fabric Group with SVG cache and strict tool mode rules
async function createExactSVGDeviceGroup(node, tmpl, svgStr, wires, activeTool) {
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

  const processElement = (obj) => {
    const elemId = obj.id || "";

    if (elemId === "status-name" || elemId === "device-name" || elemId.includes("name")) {
      if (typeof obj.set === "function") {
        obj.set({ text: node.name });
      }
    }

    if (elemId === "status-power" || elemId === "device-power" || elemId.includes("power")) {
      const isPoweredOn = node.isPoweredOn || false;
      const powerColor = isPoweredOn ? "#00ff00" : "#ff0000";
      if (typeof obj.set === "function") {
        obj.set({ fill: powerColor });
      }
    }

    const nodePorts = node.ports || tmpl?.ports || [];
    nodePorts.forEach((port) => {
      const isMatch =
        elemId === port.id ||
        elemId === `port-${port.name}` ||
        elemId === `device-port-${port.id}` ||
        elemId.endsWith(port.id);

      if (isMatch) {
        obj.portId = port.id;
        obj.hoverCursor = activeTool === "wire" ? "crosshair" : "default";

        const isConnected = wires.some(
          (w) =>
            (w.srcNodeId === node.id && w.srcPortId === port.id) ||
            (w.dstNodeId === node.id && w.dstPortId === port.id),
        );

        let portColor = "#4d4d4d";
        if (isConnected) {
          portColor = "#00ff00";
        } else if (port.netdevType === "user") {
          portColor = "#0000ff";
        } else if (port.netdevType === "qemu") {
          portColor = "#8800ff";
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
    selectable: activeTool === "select", // ONLY selectable/movable in Select tool mode
    hasControls: false,
    subTargetCheck: true,
  });

  nodeGroup.isNodeGroup = true;
  nodeGroup.nodeData = node;

  nodeGroup.getPortAbsPosition = (portId) => {
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
      const center = targetPortObj.getCenterPoint();
      return {
        x: nodeGroup.left + (center.x + nodeGroup.width / 2),
        y: nodeGroup.top + (center.y + nodeGroup.height / 2),
      };
    }

    return {
      x: nodeGroup.left + nodeGroup.width / 2,
      y: nodeGroup.top + nodeGroup.height / 2,
    };
  };

  return nodeGroup;
}
