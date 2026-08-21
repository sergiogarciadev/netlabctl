import { Circle, Canvas as FabricCanvas, Group, Line, loadSVGFromString, Rect, Text } from "fabric";
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

    // Cancel wiring on Escape or background click
    canvas.on("mouse:down", (opt) => {
      if (!opt.target && wiringStateRef.current.active) {
        cancelWiring();
      } else if (opt.target?.isNodeGroup) {
        onSelectNode(opt.target.nodeData);
      } else if (!opt.target) {
        onSelectNode(null);
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
  }, [cancelWiring, onSelectNode]);

  // Render/Sync Nodes and Wires
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // Clear existing objects
    canvas.clear();
    canvas.backgroundColor = "#090d16";

    const nodePositions = new Map(); // nodeId -> { x, y, ports: Map(portId -> { x, y }) }

    // Async render nodes
    const renderAll = async () => {
      for (const node of nodes) {
        const tmpl = templates.find((t) => t.id === node.templateId);
        let svgStr = "";
        try {
          if (tmpl) {
            svgStr = await fetchTemplateDrawing(tmpl.id);
          }
        } catch (err) {
          console.error("Failed to load SVG drawing:", err);
        }

        const nodeGroup = await createNodeFabricGroup(
          node,
          tmpl,
          svgStr,
          (portId, portAbsX, portAbsY) => {
            // Handle Port Click for Wire Creation
            if (!wiringStateRef.current.active) {
              // Start wiring
              wiringStateRef.current = {
                active: true,
                srcNodeId: node.id,
                srcPortId: portId,
                tempLine: new Line([portAbsX, portAbsY, portAbsX, portAbsY], {
                  stroke: "#3b82f6",
                  strokeWidth: 3,
                  strokeDashArray: [6, 4],
                  selectable: false,
                  evented: false,
                }),
              };
              canvas.add(wiringStateRef.current.tempLine);
            } else {
              // Complete wiring if destination port is different
              const { srcNodeId, srcPortId } = wiringStateRef.current;
              if (srcNodeId !== node.id || srcPortId !== portId) {
                onAddWire(srcNodeId, srcPortId, node.id, portId);
              }
              cancelWiring();
            }
          },
        );

        canvas.add(nodeGroup);

        // Store port positions for wire rendering
        const portMap = new Map();
        node.ports.forEach((p, idx) => {
          const portOffsetY = 55;
          const portOffsetX = 20 + idx * 25;
          portMap.set(p.id, {
            x: node.x + portOffsetX,
            y: node.y + portOffsetY,
          });
        });

        nodePositions.set(node.id, {
          x: node.x,
          y: node.y,
          ports: portMap,
        });
      }

      // Render Wires
      for (const wire of wires) {
        const srcPos = nodePositions.get(wire.srcNodeId);
        const dstPos = nodePositions.get(wire.dstNodeId);

        if (srcPos && dstPos) {
          const p1 = srcPos.ports.get(wire.srcPortId) || { x: srcPos.x + 20, y: srcPos.y + 40 };
          const p2 = dstPos.ports.get(wire.dstPortId) || { x: dstPos.x + 20, y: dstPos.y + 40 };

          const wireLine = new Line([p1.x, p1.y, p2.x, p2.y], {
            stroke: "#10b981",
            strokeWidth: 3,
            selectable: true,
            hasControls: false,
          });
          wireLine.wireData = wire;

          wireLine.on("mousedblclick", () => {
            if (onDeleteWire) onDeleteWire(wire.id);
          });

          canvas.add(wireLine);
        }
      }

      canvas.requestRenderAll();
    };

    renderAll();
  }, [nodes, wires, templates, cancelWiring, onAddWire, onDeleteWire]);

  return (
    <div className="canvas-wrapper" ref={containerRef}>
      <canvas ref={canvasRef} id="netlab-canvas" />
    </div>
  );
}

// Helper to construct Fabric Group for a Node
async function createNodeFabricGroup(node, tmpl, svgStr, onPortClick) {
  const groupObjects = [];

  if (svgStr) {
    try {
      const parsed = await loadSVGFromString(svgStr);
      if (parsed.objects && parsed.objects.length > 0) {
        parsed.objects.forEach((obj) => {
          groupObjects.push(obj);
        });
      }
    } catch (e) {
      console.warn("Error parsing SVG string:", e);
    }
  }

  // Fallback box if SVG parse failed or empty
  if (groupObjects.length === 0) {
    const rect = new Rect({
      width: 120,
      height: 80,
      fill: "#1e293b",
      stroke: "#3b82f6",
      strokeWidth: 2,
      rx: 8,
      ry: 8,
    });
    groupObjects.push(rect);
  }

  // Title Text
  const titleText = new Text(node.name, {
    fontSize: 12,
    fontWeight: "bold",
    fill: "#f8fafc",
    left: 10,
    top: 10,
  });
  groupObjects.push(titleText);

  // Power Status Indicator
  const powerStatus = new Circle({
    radius: 4,
    fill: "#ef4444", // off by default
    left: 100,
    top: 12,
  });
  groupObjects.push(powerStatus);

  // Ports
  const ports = node.ports || tmpl?.ports || [];
  ports.forEach((port, idx) => {
    const portOffsetX = 20 + idx * 25;
    const portOffsetY = 55;

    const portCircle = new Circle({
      radius: 5,
      fill: "#64748b", // disconnected by default
      stroke: "#0f172a",
      strokeWidth: 1.5,
      left: portOffsetX,
      top: portOffsetY,
      hoverCursor: "pointer",
    });

    portCircle.on("mousedown", (e) => {
      e.e.stopPropagation();
      onPortClick(port.id, node.x + portOffsetX, node.y + portOffsetY);
    });

    groupObjects.push(portCircle);
  });

  const nodeGroup = new Group(groupObjects, {
    left: node.x,
    top: node.y,
    selectable: true,
    hasControls: false,
  });

  nodeGroup.isNodeGroup = true;
  nodeGroup.nodeData = node;

  return nodeGroup;
}
