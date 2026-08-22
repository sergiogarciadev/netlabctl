import { Canvas as FabricCanvas, Group, Line, loadSVGFromString, Rect, util } from "fabric";
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
  onDebugUpdate,
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
    if (wiringStateRef.current.tempLine && canvas && !canvas.isDisposed) {
      canvas.remove(wiringStateRef.current.tempLine);
    }
    console.log("[NETLAB-WIRE-DEBUG] Wiring canceled/reset.");
    wiringStateRef.current = { active: false, srcNodeId: null, srcPortId: null, tempLine: null };
    if (canvas && !canvas.isDisposed) canvas.requestRenderAll();
  }, []);

  // Initialize Fabric Canvas
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    console.log("[NETLAB-WIRE-DEBUG] Initializing Fabric Canvas:", { width, height, activeTool });

    const canvas = new FabricCanvas(canvasRef.current, {
      width,
      height,
      backgroundColor: "#090d16",
      selection: true,
      subTargetCheck: true,
    });

    fabricCanvasRef.current = canvas;

    const handleResize = () => {
      if (containerRef.current && fabricCanvasRef.current && !fabricCanvasRef.current.isDisposed) {
        fabricCanvasRef.current.setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener("resize", handleResize);

    const handleKeyDown = (e) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        const activeObj = canvas.getActiveObject();
        if (activeObj?.isNodeGroup && onDeleteNode) {
          console.log("[NETLAB-WIRE-DEBUG] Delete key pressed for node:", activeObj.nodeData.id);
          onDeleteNode(activeObj.nodeData.id);
        } else if (activeObj?.isWireLine && onDeleteWire) {
          console.log("[NETLAB-WIRE-DEBUG] Delete key pressed for wire:", activeObj.wireData.id);
          onDeleteWire(activeObj.wireData.id);
        }
      } else if (e.key === "Escape") {
        cancelWiring();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    // Mouse move handler for live HUD & wire rubberband
    canvas.on("mouse:move", (opt) => {
      const pointer = canvas.getScenePoint(opt.e);
      const target = opt.target;
      const subTarget = opt.subTarget;

      let nearestPort = null;
      let nodeId = null;
      let subTargetTag = null;

      if (target?.isNodeGroup) {
        nodeId = target.nodeData.id;
        subTargetTag = subTarget?.id || subTarget?.portId || subTarget?.type;
        const clickedPortId = extractPortIdFromSubTarget(subTarget, target.nodeData);
        if (clickedPortId) {
          const absPos = target.getPortAbsPosition(clickedPortId);
          if (absPos) {
            const dx = pointer.x - absPos.x;
            const dy = pointer.y - absPos.y;
            nearestPort = { portId: clickedPortId, absPos, dist: Math.sqrt(dx * dx + dy * dy) };
          }
        }
        if (!nearestPort) {
          nearestPort = findClosestPortInNode(target, pointer.x, pointer.y, 60);
        }
      }

      if (onDebugUpdate) {
        onDebugUpdate({
          activeTool,
          pointer,
          nodeId,
          subTargetTag,
          nearestPort,
          isWiring: wiringStateRef.current.active,
          srcPortId: wiringStateRef.current.srcPortId,
        });
      }

      if (wiringStateRef.current.active && wiringStateRef.current.tempLine) {
        wiringStateRef.current.tempLine.set({ x2: pointer.x, y2: pointer.y });
        canvas.requestRenderAll();
      }
    });

    // Mouse down handler for device selection & port wiring
    canvas.on("mouse:down", (opt) => {
      const target = opt.target;
      const subTarget = opt.subTarget;
      const pointer = canvas.getScenePoint(opt.e);

      console.log("[NETLAB-WIRE-DEBUG] mouse:down event", {
        activeTool,
        targetType: target?.type,
        isNodeGroup: target?.isNodeGroup,
        nodeId: target?.nodeData?.id,
        subTargetId: subTarget?.id,
        subTargetPortId: subTarget?.portId,
        pointer,
      });

      if (target?.isNodeGroup) {
        let clickedPortId = extractPortIdFromSubTarget(subTarget, target.nodeData);
        let portAbsPos = null;

        if (clickedPortId) {
          portAbsPos = target.getPortAbsPosition(clickedPortId);
        }

        // If subTarget didn't resolve portId, test proximity to port anchors
        if (!clickedPortId || !portAbsPos) {
          const nearPort = findClosestPortInNode(target, pointer.x, pointer.y, 60);
          if (nearPort) {
            clickedPortId = nearPort.portId;
            portAbsPos = nearPort.absPos;
            console.log("[NETLAB-WIRE-DEBUG] Found port by proximity:", nearPort);
          }
        }

        console.log("[NETLAB-WIRE-DEBUG] Port detection result:", {
          clickedPortId,
          portAbsPos,
          isWiringActive: wiringStateRef.current.active,
        });

        // Trigger wiring if in "wire" tool mode OR if a port was clicked directly
        if (
          clickedPortId &&
          portAbsPos &&
          (activeTool === "wire" || subTarget?.portId || wiringStateRef.current.active)
        ) {
          opt.e.stopPropagation();
          const node = target.nodeData;

          if (!wiringStateRef.current.active) {
            console.log("[NETLAB-WIRE-DEBUG] STARTING WIRE from:", {
              nodeId: node.id,
              portId: clickedPortId,
              startPos: portAbsPos,
            });

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
            const { srcNodeId, srcPortId } = wiringStateRef.current;
            console.log("[NETLAB-WIRE-DEBUG] COMPLETING WIRE:", {
              srcNodeId,
              srcPortId,
              dstNodeId: node.id,
              dstPortId: clickedPortId,
            });

            if (srcNodeId !== node.id || srcPortId !== clickedPortId) {
              onAddWire(srcNodeId, srcPortId, node.id, clickedPortId);
            } else {
              console.warn("[NETLAB-WIRE-DEBUG] Connection rejected: Same port clicked twice.");
            }
            cancelWiring();
          }
          return;
        }
      }

      // SELECT TOOL MODE ONLY
      if (activeTool === "select") {
        if (wiringStateRef.current.active) {
          cancelWiring();
        }

        if (target?.isNodeGroup) {
          console.log("[NETLAB-WIRE-DEBUG] Selected Node:", target.nodeData.id);
          onSelectNode(target.nodeData);
        } else if (!target) {
          console.log("[NETLAB-WIRE-DEBUG] Clicked canvas background, clearing selection.");
          onSelectNode(null);
        }
      } else if (activeTool === "wire" && wiringStateRef.current.active) {
        console.log(
          "[NETLAB-WIRE-DEBUG] Clicked background during wire mode, canceling temp wire.",
        );
        cancelWiring();
      }
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
      if (fabricCanvasRef.current && !fabricCanvasRef.current.isDisposed) {
        fabricCanvasRef.current.dispose();
      }
    };
  }, [
    cancelWiring,
    onSelectNode,
    onAddWire,
    onDeleteWire,
    onDeleteNode,
    activeTool,
    onDebugUpdate,
  ]);

  // Sync Nodes and Wires on Canvas with disposed canvas guard
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || canvas.isDisposed) return;

    let isCancelled = false;
    canvas.defaultCursor = activeTool === "wire" ? "crosshair" : "default";
    const nodeGroupsMap = new Map();

    const renderAll = async () => {
      console.log("[NETLAB-WIRE-DEBUG] Syncing canvas objects...", {
        nodesCount: nodes.length,
        wiresCount: wires.length,
        activeTool,
      });

      for (const tmpl of templates) {
        if (!svgCache.has(tmpl.id)) {
          try {
            const svgStr = await fetchTemplateDrawing(tmpl.id);
            svgCache.set(tmpl.id, svgStr);
          } catch (err) {
            console.error(`[NETLAB-WIRE-DEBUG] Failed to prefetch SVG for ${tmpl.id}`, err);
          }
        }
      }

      if (isCancelled || canvas.isDisposed || !canvas.getContext()) return;

      canvas.clear();
      canvas.backgroundColor = "#090d16";

      for (const node of nodes) {
        const tmpl = templates.find((t) => t.id === node.templateId);
        const svgStr = tmpl ? svgCache.get(tmpl.id) || "" : "";

        const nodeGroup = await createExactSVGDeviceGroup(node, tmpl, svgStr, wires, activeTool);
        if (isCancelled || canvas.isDisposed) return;

        nodeGroup.on("moving", () => {
          node.x = nodeGroup.left;
          node.y = nodeGroup.top;
          updateWirePositions(canvas, nodes, wires, nodeGroupsMap);
        });

        canvas.add(nodeGroup);
        nodeGroupsMap.set(node.id, nodeGroup);
      }

      updateWirePositions(canvas, nodes, wires, nodeGroupsMap, onDeleteWire);
      if (!isCancelled && !canvas.isDisposed) {
        canvas.requestRenderAll();
      }
    };

    renderAll();

    return () => {
      isCancelled = true;
    };
  }, [nodes, wires, templates, onDeleteWire, activeTool]);

  return (
    <div className="canvas-wrapper" ref={containerRef}>
      <canvas ref={canvasRef} id="netlab-canvas" />
    </div>
  );
}

// Extract portId by searching subTarget and its parent element hierarchy
function extractPortIdFromSubTarget(subTarget, nodeData) {
  if (!subTarget) return null;

  let current = subTarget;
  while (current && current.type !== "group") {
    if (current.portId) return current.portId;
    if (current.id && nodeData?.ports) {
      const match = nodeData.ports.find(
        (p) =>
          current.id === p.id ||
          current.id === `device-port-${p.id}` ||
          current.id === `port-${p.name}` ||
          current.id.endsWith(p.id),
      );
      if (match) return match.id;
    }
    current = current.group;
  }
  return null;
}

// Calculates absolute scene center point for an object nested inside arbitrarily deep groups
function getAbsoluteObjectCenter(obj) {
  if (!obj) return null;
  let matrix = obj.calcTransformMatrix();
  let parent = obj.group;
  while (parent) {
    const parentMatrix = parent.calcTransformMatrix();
    matrix = util.multiplyTransformMatrices(parentMatrix, matrix);
    parent = parent.group;
  }

  // Get local center point relative to obj
  const localCenter = obj.getCenterPoint();

  // In Fabric.js v6, obj.getCenterPoint() on a child inside a group already returns point transformed by obj's own matrix.
  // Transforming by parent matrices gives absolute canvas scene point:
  let finalPoint = localCenter;
  let curr = obj.group;
  while (curr) {
    const pMatrix = curr.calcTransformMatrix();
    finalPoint = util.transformPoint(finalPoint, pMatrix);
    curr = curr.group;
  }
  return finalPoint;
}

// Proximity helper using exact multi-level matrix transformed port coordinates
function findClosestPortInNode(nodeGroup, absClickX, absClickY, threshold = 60) {
  const nodeData = nodeGroup.nodeData;
  if (!nodeData?.ports) return null;

  let closest = null;
  let minDist = threshold;

  for (const port of nodeData.ports) {
    const portPos = nodeGroup.getPortAbsPosition(port.id);
    if (!portPos) continue;
    const dx = absClickX - portPos.x;
    const dy = absClickY - portPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= minDist) {
      minDist = dist;
      closest = { portId: port.id, absPos: portPos, dist };
    }
  }
  return closest;
}

function updateWirePositions(canvas, _nodes, wires, nodeGroupsMap, onDeleteWire) {
  if (!canvas || canvas.isDisposed) return;

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

      if (p1 && p2) {
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
            console.log("[NETLAB-WIRE-DEBUG] Double-clicked wire to delete:", wire.id);
            onDeleteWire(wire.id);
          });
        }

        canvas.add(wireLine);
        canvas.sendObjectToBack(wireLine);
      }
    }
  }
}

async function createExactSVGDeviceGroup(node, tmpl, svgStr, wires, activeTool) {
  let svgObjects = [];

  if (svgStr) {
    try {
      const parsed = await loadSVGFromString(svgStr);
      if (parsed.objects && parsed.objects.length > 0) {
        svgObjects = parsed.objects.filter((o) => o !== null);
      }
    } catch (e) {
      console.warn("[NETLAB-WIRE-DEBUG] Failed to parse device SVG:", e);
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

  const nodePorts = node.ports || tmpl?.ports || [];

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

    nodePorts.forEach((port) => {
      const isMatch =
        elemId === port.id ||
        elemId === `port-${port.name}` ||
        elemId === `device-port-${port.id}` ||
        elemId === `device-port-${port.name}` ||
        elemId.endsWith(port.id);

      if (isMatch) {
        const tagChildren = (targetObj) => {
          targetObj.portId = port.id;
          targetObj.hoverCursor = activeTool === "wire" ? "crosshair" : "pointer";
          if (targetObj._objects && Array.isArray(targetObj._objects)) {
            targetObj._objects.forEach(tagChildren);
          }
        };
        tagChildren(obj);

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
    selectable: activeTool === "select",
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
      return getAbsoluteObjectCenter(targetPortObj);
    }

    return {
      x: nodeGroup.left + nodeGroup.width / 2,
      y: nodeGroup.top + nodeGroup.height / 2,
    };
  };

  return nodeGroup;
}
