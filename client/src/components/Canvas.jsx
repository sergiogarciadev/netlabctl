import {
  Circle,
  Canvas as FabricCanvas,
  Group,
  loadSVGFromString,
  Polyline,
  Rect,
  Shadow,
} from "fabric";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTemplateDrawing } from "../services/api";
import { DebugPanel } from "./DebugPanel";

const svgCache = new Map();

export function Canvas({
  nodes,
  wires,
  wireStats = [],
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

  const panStateRef = useRef({
    isPanning: false,
    lastPosX: 0,
    lastPosY: 0,
  });

  const viewportTransformRef = useRef([1, 0, 0, 1, 0, 0]);
  const wirePolylineMapRef = useRef(new Map());
  const wirePointsCacheRef = useRef(new Map());
  const wireStatsRef = useRef([]);

  // Isolated local debug info state
  const [debugInfo, setDebugInfo] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(100);

  useEffect(() => {
    wireStatsRef.current = wireStats;
  }, [wireStats]);

  // Synchronously calculate and cache wire path points from topology state
  useEffect(() => {
    const nodeMap = new Map((nodes || []).map((n) => [n.id, n]));
    const cache = new Map();

    for (const wire of wires || []) {
      const srcNode = nodeMap.get(wire.srcNodeId);
      const dstNode = nodeMap.get(wire.dstNodeId);
      if (!srcNode || !dstNode) continue;

      const p1 = getPortAbsPositionFromNodeData(srcNode, wire.srcPortId, templates);
      const p2 = getPortAbsPositionFromNodeData(dstNode, wire.dstPortId, templates);

      const orthoPoints = calculateShortestOrthogonalPath(
        p1,
        p2,
        null,
        null,
        [],
        wire.srcPortId,
        wire.dstPortId,
      );
      cache.set(wire.id, orthoPoints);
    }
    wirePointsCacheRef.current = cache;
  }, [nodes, wires, templates]);

  // Helper function to animate packet circle along polyline points array
  const triggerCircleAnimation = useCallback((canvas, points, count, isReverse) => {
    if (!canvas || canvas.isDisposed || !points || points.length < 2 || count <= 0) return;

    const wireStrokeWidth = 3;
    // Formula: starts at double wire size (2x), increases by 1x wire size for each log10 step
    const logFactor = Math.floor(Math.log10(Math.max(1, count)));
    const sizeMultiplier = 2 + logFactor;
    const radius = (sizeMultiplier * wireStrokeWidth) / 2; // e.g. 3px (2x), 4.5px (3x), 6px (4x)

    const pathPoints = isReverse ? [...points].reverse() : points;
    const startPt = pathPoints[0];

    const packetCircle = new Circle({
      left: startPt.x,
      top: startPt.y,
      radius: radius,
      fill: isReverse ? "#ff007f" : "#00f3ff",
      stroke: "#ffffff",
      strokeWidth: 1.5,
      shadow: new Shadow({
        color: isReverse ? "#ff007f" : "#00f3ff",
        blur: 10,
      }),
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
      opacity: 1,
    });

    canvas.add(packetCircle);
    canvas.bringObjectToFront(packetCircle);

    const segments = [];
    let totalDistance = 0;
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const pA = pathPoints[i];
      const pB = pathPoints[i + 1];
      const dx = pB.x - pA.x;
      const dy = pB.y - pA.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      segments.push({ pA, pB, dx, dy, len });
      totalDistance += len;
    }

    if (totalDistance === 0) {
      canvas.remove(packetCircle);
      return;
    }

    const duration = 380; // 380ms fast & responsive animation speed
    const startTime = performance.now();

    const step = (now) => {
      if (canvas.isDisposed) return;
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);

      const currentDist = progress * totalDistance;
      let accumulated = 0;
      let curX = startPt.x;
      let curY = startPt.y;

      for (const seg of segments) {
        if (currentDist <= accumulated + seg.len) {
          const segProgress = (currentDist - accumulated) / (seg.len || 1);
          curX = seg.pA.x + segProgress * seg.dx;
          curY = seg.pA.y + segProgress * seg.dy;
          break;
        }
        accumulated += seg.len;
      }

      packetCircle.set({
        left: curX,
        top: curY,
        opacity: progress > 0.85 ? (1 - progress) / 0.15 : 1,
      });
      canvas.requestRenderAll();

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        canvas.remove(packetCircle);
        canvas.requestRenderAll();
      }
    };

    requestAnimationFrame(step);
  }, []);

  const handleTestPulseWire = useCallback(
    (wireId) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || canvas.isDisposed) return;
      const wireInfo = wirePolylineMapRef.current.get(wireId);
      if (!wireInfo?.points || wireInfo.points.length < 2) return;

      triggerCircleAnimation(canvas, wireInfo.points, 1, false);
      setTimeout(() => {
        triggerCircleAnimation(canvas, wireInfo.points, 10, true);
      }, 350);
    },
    [triggerCircleAnimation],
  );

  // Packet Flow Animation Ticker based on Managed Network packet events
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || canvas.isDisposed || !wireStats || wireStats.length === 0) return;

    wireStats.forEach((stat) => {
      // 3-Level Fallback for wire points lookup (Canvas object -> Polyline map -> Synchronous Topology cache)
      const wireLineObj = canvas
        .getObjects()
        .find((obj) => obj.isWireLine && obj.wireData?.id === stat.wireId);

      const points =
        wireLineObj?.points ||
        wirePolylineMapRef.current.get(stat.wireId)?.points ||
        wirePointsCacheRef.current.get(stat.wireId);
      if (!points || points.length < 2) {
        console.warn("[NETLAB-ANIM-DEBUG] Wire line points not found for wireId:", stat.wireId);
        return;
      }

      const fwdCount = stat.srcToDst100ms || (stat.count > 0 ? stat.count : 0);
      if (fwdCount > 0) {
        setTimeout(() => {
          triggerCircleAnimation(fabricCanvasRef.current, points, fwdCount, false);
        }, 0);
      }

      const revCount = stat.dstToSrc100ms || 0;
      if (revCount > 0) {
        setTimeout(() => {
          triggerCircleAnimation(fabricCanvasRef.current, points, revCount, true);
        }, 0);
      }
    });
  }, [wireStats, triggerCircleAnimation]);

  const cancelWiring = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (wiringStateRef.current.tempLine && canvas && !canvas.isDisposed) {
      canvas.remove(wiringStateRef.current.tempLine);
    }
    console.log("[NETLAB-WIRE-DEBUG] Wiring canceled/reset.");
    wiringStateRef.current = { active: false, srcNodeId: null, srcPortId: null, tempLine: null };
    if (canvas && !canvas.isDisposed) canvas.requestRenderAll();
  }, []);

  const handleZoomIn = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || canvas.isDisposed) return;
    let zoom = canvas.getZoom() * 1.2;
    if (zoom > 4) zoom = 4;
    canvas.zoomToPoint({ x: canvas.width / 2, y: canvas.height / 2 }, zoom);
    if (canvas.viewportTransform) {
      viewportTransformRef.current = [...canvas.viewportTransform];
    }
    setZoomLevel(Math.round(zoom * 100));
  };

  const handleZoomOut = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || canvas.isDisposed) return;
    let zoom = canvas.getZoom() / 1.2;
    if (zoom < 0.25) zoom = 0.25;
    canvas.zoomToPoint({ x: canvas.width / 2, y: canvas.height / 2 }, zoom);
    if (canvas.viewportTransform) {
      viewportTransformRef.current = [...canvas.viewportTransform];
    }
    setZoomLevel(Math.round(zoom * 100));
  };

  const handleResetZoom = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || canvas.isDisposed) return;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    viewportTransformRef.current = [1, 0, 0, 1, 0, 0];
    setZoomLevel(100);
  };

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
      preserveObjectStacking: true,
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

    // Mouse wheel zoom handler
    canvas.on("mouse:wheel", (opt) => {
      const delta = opt.e.deltaY;
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** delta;
      if (zoom > 4) zoom = 4;
      if (zoom < 0.25) zoom = 0.25;

      canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      if (canvas.viewportTransform) {
        viewportTransformRef.current = [...canvas.viewportTransform];
      }
      setZoomLevel(Math.round(zoom * 100));

      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    // Mouse move handler (handles pan & shortest-path parallel non-crossing wire rubberband & HUD)
    canvas.on("mouse:move", (opt) => {
      const pointer = canvas.getScenePoint(opt.e);
      const evt = opt.e;

      if (panStateRef.current.isPanning) {
        const vpt = canvas.viewportTransform;
        vpt[4] += evt.clientX - panStateRef.current.lastPosX;
        vpt[5] += evt.clientY - panStateRef.current.lastPosY;
        panStateRef.current.lastPosX = evt.clientX;
        panStateRef.current.lastPosY = evt.clientY;
        viewportTransformRef.current = [...vpt];
        canvas.requestRenderAll();
        return;
      }

      const target = opt.target;
      const subTarget = opt.subTarget;

      let nearestPort = null;
      let nodeId = null;
      let subTargetTag = null;

      if (target?.isNodeGroup) {
        nodeId = target.nodeData.id;
        subTargetTag = subTarget?.id || subTarget?.portId || subTarget?.type;
        nearestPort = findClosestPortInNode(target, pointer.x, pointer.y, 45);
      } else {
        for (const obj of canvas.getObjects()) {
          if (obj.isNodeGroup) {
            const near = findClosestPortInNode(obj, pointer.x, pointer.y, 35);
            if (near && (!nearestPort || near.dist < nearestPort.dist)) {
              nearestPort = near;
              nodeId = obj.nodeData.id;
            }
          }
        }
      }

      let hoveredWire = null;
      if (target?.isWireLine && target.wireData) {
        const wire = target.wireData;
        const stat = (wireStatsRef.current || []).find((s) => s.wireId === wire.id);
        hoveredWire = {
          id: wire.id,
          srcNodeId: wire.srcNodeId,
          srcPortId: wire.srcPortId,
          dstNodeId: wire.dstNodeId,
          dstPortId: wire.dstPortId,
          packets100ms: stat?.count || 0,
          srcToDst100ms: stat?.srcToDst100ms || 0,
          dstToSrc100ms: stat?.dstToSrc100ms || 0,
          totalPackets: stat?.totalPackets || 0,
          totalBytes: stat?.bytes || 0,
          delayMs: wire.conditions?.delayMs || 0,
          jitterMs: wire.conditions?.jitterMs || 0,
          lossPercent: wire.conditions?.lossPercent || 0,
          tzspTarget: wire.tzspTarget || "",
        };
      } else {
        for (const obj of canvas.getObjects()) {
          if (obj.isWireLine && obj.wireData) {
            const wire = obj.wireData;
            const wireInfo = wirePolylineMapRef.current.get(wire.id);
            const points = wireInfo?.points || obj.points || [];
            let isNear = false;
            for (let i = 0; i < points.length - 1; i++) {
              const d = pointToSegmentDistance(
                pointer.x,
                pointer.y,
                points[i].x,
                points[i].y,
                points[i + 1].x,
                points[i + 1].y,
              );
              if (d < 15) {
                isNear = true;
                break;
              }
            }
            if (isNear) {
              const stat = (wireStatsRef.current || []).find((s) => s.wireId === wire.id);
              hoveredWire = {
                id: wire.id,
                srcNodeId: wire.srcNodeId,
                srcPortId: wire.srcPortId,
                dstNodeId: wire.dstNodeId,
                dstPortId: wire.dstPortId,
                packets100ms: stat?.count || 0,
                srcToDst100ms: stat?.srcToDst100ms || 0,
                dstToSrc100ms: stat?.dstToSrc100ms || 0,
                totalPackets: stat?.totalPackets || 0,
                totalBytes: stat?.bytes || 0,
                delayMs: wire.conditions?.delayMs || 0,
                jitterMs: wire.conditions?.jitterMs || 0,
                lossPercent: wire.conditions?.lossPercent || 0,
                tzspTarget: wire.tzspTarget || "",
              };
              break;
            }
          }
        }
      }

      setDebugInfo({
        activeTool,
        pointer,
        nodeId,
        subTargetTag,
        nearestPort,
        hoveredWire,
        onTestPulseWire: handleTestPulseWire,
        isWiring: wiringStateRef.current.active,
        srcPortId: wiringStateRef.current.srcPortId,
      });

      if (wiringStateRef.current.active && wiringStateRef.current.tempLine) {
        const startPos = wiringStateRef.current.startPos;
        const srcNodeGroup = wiringStateRef.current.srcNodeGroup;
        const srcPortId = wiringStateRef.current.srcPortId;
        const allNodeGroups = canvas.getObjects().filter((obj) => obj.isNodeGroup);

        const orthoPoints = calculateShortestOrthogonalPath(
          startPos,
          pointer,
          srcNodeGroup,
          target?.isNodeGroup ? target : null,
          allNodeGroups,
          srcPortId,
          "",
        );
        wiringStateRef.current.tempLine.set({ points: orthoPoints });
        canvas.requestRenderAll();
      }
    });

    const lockViewportTransform = () => {
      if (canvas && !canvas.isDisposed && viewportTransformRef.current) {
        canvas.setViewportTransform(viewportTransformRef.current);
      }
    };

    canvas.on("selection:created", lockViewportTransform);
    canvas.on("selection:updated", lockViewportTransform);
    canvas.on("selection:cleared", lockViewportTransform);

    // Mouse down handler (handles canvas panning & selection & port wiring)
    canvas.on("mouse:down", (opt) => {
      lockViewportTransform();
      const evt = opt.e;

      if (evt.button === 1 || evt.altKey) {
        panStateRef.current = {
          isPanning: true,
          lastPosX: evt.clientX,
          lastPosY: evt.clientY,
        };
        canvas.selection = false;
        return;
      }

      const target = opt.target;
      const subTarget = opt.subTarget;
      const pointer = canvas.getScenePoint(opt.e);

      let targetNodeGroup = target?.isNodeGroup ? target : null;
      let nearPort = null;

      if (targetNodeGroup) {
        nearPort = findClosestPortInNode(targetNodeGroup, pointer.x, pointer.y, 45);
      } else {
        for (const obj of canvas.getObjects()) {
          if (obj.isNodeGroup) {
            const hit = findClosestPortInNode(obj, pointer.x, pointer.y, 35);
            if (hit && (!nearPort || hit.dist < nearPort.dist)) {
              nearPort = hit;
              targetNodeGroup = obj;
            }
          }
        }
      }

      if (nearPort && targetNodeGroup) {
        const clickedPortId = nearPort.portId;
        const portAbsPos = nearPort.absPos;
        const node = targetNodeGroup.nodeData;

        if (activeTool === "wire" || subTarget?.portId || wiringStateRef.current.active) {
          opt.e.stopPropagation();

          if (!wiringStateRef.current.active) {
            const allNodeGroups = canvas.getObjects().filter((obj) => obj.isNodeGroup);
            const orthoPoints = calculateShortestOrthogonalPath(
              portAbsPos,
              pointer,
              targetNodeGroup,
              null,
              allNodeGroups,
              clickedPortId,
              "",
            );

            wiringStateRef.current = {
              active: true,
              srcNodeId: node.id,
              srcNodeGroup: targetNodeGroup,
              srcPortId: clickedPortId,
              startPos: portAbsPos,
              tempLine: new Polyline(orthoPoints, {
                stroke: "#3b82f6",
                strokeWidth: 3,
                fill: "transparent",
                strokeDashArray: [6, 4],
                strokeLineJoin: "round",
                strokeLineCap: "round",
                selectable: false,
                evented: false,
              }),
            };
            canvas.add(wiringStateRef.current.tempLine);
          } else {
            const { srcNodeId, srcPortId } = wiringStateRef.current;
            if (srcNodeId !== node.id || srcPortId !== clickedPortId) {
              onAddWire(srcNodeId, srcPortId, node.id, clickedPortId);
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
          onSelectNode(target.nodeData);
        } else if (!target) {
          onSelectNode(null);
        }
      } else if (activeTool === "wire" && wiringStateRef.current.active) {
        cancelWiring();
      }
    });

    canvas.on("mouse:up", () => {
      lockViewportTransform();
      if (panStateRef.current.isPanning) {
        panStateRef.current.isPanning = false;
        canvas.selection = activeTool === "select";
      }
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
      if (fabricCanvasRef.current && !fabricCanvasRef.current.isDisposed) {
        fabricCanvasRef.current.dispose();
      }
    };
  }, [cancelWiring, onSelectNode, onAddWire, onDeleteWire, onDeleteNode, activeTool]);

  // Sync Nodes and Wires on Canvas - Preserves existing Zoom & Pan ViewportTransform!
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || canvas.isDisposed) return;

    let isCancelled = false;
    canvas.defaultCursor = activeTool === "wire" ? "crosshair" : "default";
    const nodeGroupsMap = new Map();

    const renderAll = async () => {
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

      if (viewportTransformRef.current) {
        canvas.setViewportTransform(viewportTransformRef.current);
      }

      for (const node of nodes) {
        const tmpl = templates.find((t) => t.id === node.templateId);
        const svgStr = tmpl ? svgCache.get(tmpl.id) || "" : "";

        const nodeGroup = await createExactSVGDeviceGroup(node, tmpl, svgStr, wires, activeTool);
        if (isCancelled || canvas.isDisposed) return;

        nodeGroup.lastValidLeft = node.x;
        nodeGroup.lastValidTop = node.y;

        nodeGroup.on("moving", () => {
          if (checkDeviceCollision(nodeGroup, canvas.getObjects())) {
            // Stop at last valid position boundary without jumping!
            nodeGroup.left = nodeGroup.lastValidLeft ?? node.x;
            nodeGroup.top = nodeGroup.lastValidTop ?? node.y;
          } else {
            // Update last valid position
            nodeGroup.lastValidLeft = nodeGroup.left;
            nodeGroup.lastValidTop = nodeGroup.top;
            node.x = nodeGroup.left;
            node.y = nodeGroup.top;
          }
          updateWirePositions(
            canvas,
            nodes,
            wires,
            nodeGroupsMap,
            onDeleteWire,
            wirePolylineMapRef,
          );
        });

        canvas.add(nodeGroup);
        nodeGroupsMap.set(node.id, nodeGroup);
      }

      updateWirePositions(canvas, nodes, wires, nodeGroupsMap, onDeleteWire, wirePolylineMapRef);
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

      {/* Floating Zoom HUD Controls */}
      <div
        style={{
          position: "absolute",
          bottom: "16px",
          right: "16px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: "rgba(15, 23, 42, 0.9)",
          backdropFilter: "blur(10px)",
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          padding: "6px 10px",
          zIndex: 80,
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}
      >
        <button
          type="button"
          className="btn"
          style={{ padding: "4px 8px" }}
          onClick={handleZoomOut}
          title="Zoom Out"
        >
          <ZoomOut size={16} />
        </button>
        <span
          style={{
            fontSize: "0.8rem",
            fontWeight: 600,
            fontFamily: "var(--font-mono)",
            color: "var(--text-main)",
            minWidth: "45px",
            textAlign: "center",
          }}
        >
          {zoomLevel}%
        </span>
        <button
          type="button"
          className="btn"
          style={{ padding: "4px 8px" }}
          onClick={handleZoomIn}
          title="Zoom In"
        >
          <ZoomIn size={16} />
        </button>
        <button
          type="button"
          className="btn"
          style={{ padding: "4px 8px", marginLeft: "4px" }}
          onClick={handleResetZoom}
          title="Reset Zoom & Pan (100%)"
        >
          <Maximize2 size={16} />
        </button>
      </div>

      <DebugPanel debugInfo={debugInfo} />
    </div>
  );
}

// Check if targetGroup collides with or violates the 100px vertical clearance requirement of any other device
function checkDeviceCollision(targetGroup, allGroups) {
  const targetWidth = targetGroup.width || 120;
  const targetHeight = targetGroup.height || 50;

  const minHorizontalGap = 20;
  const minVerticalGap = 100; // Must have at least 100px vertical clearance between vertically aligned devices

  const tLeft = targetGroup.left;
  const tRight = tLeft + targetWidth;
  const tTop = targetGroup.top;
  const tBottom = tTop + targetHeight;

  for (const other of allGroups) {
    if (other === targetGroup || !other.isNodeGroup) continue;

    const otherWidth = other.width || 120;
    const otherHeight = other.height || 50;

    const oLeft = other.left;
    const oRight = oLeft + otherWidth;
    const oTop = other.top;
    const oBottom = oTop + otherHeight;

    // Check horizontal overlap with 20px gap
    const isHorizOverlap = tRight + minHorizontalGap > oLeft && tLeft - minHorizontalGap < oRight;

    if (isHorizOverlap) {
      // Symmetrical 100px vertical clearance check:
      // If target is above 'other': target bottom must be <= other top - 100px
      // If target is below 'other': target top must be >= other bottom + 100px
      if (tTop < oTop) {
        if (tBottom + minVerticalGap > oTop) {
          return true; // Too close above 'other'!
        }
      } else {
        if (tTop - minVerticalGap < oBottom) {
          return true; // Too close below 'other'!
        }
      }
    }
  }

  return false;
}

// Extract exact padded bounding box of a device node group on the canvas
function getNodeBoundingBox(group) {
  if (!group) return null;
  const padding = 8;
  const left = group.left - padding;
  const top = group.top - padding;
  const width = (group.width || 120) + padding * 2;
  const height = (group.height || 50) + padding * 2;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

// Check if line segment (xa, ya) -> (xb, yb) intersects a padded box
function segmentIntersectsBox(xa, ya, xb, yb, box) {
  const minX = Math.min(xa, xb);
  const maxX = Math.max(xa, xb);
  const minY = Math.min(ya, yb);
  const maxY = Math.max(ya, yb);

  if (maxX <= box.left || minX >= box.right || maxY <= box.top || minY >= box.bottom) {
    return false;
  }

  if (xa === xb) {
    return xa > box.left && xa < box.right && minY < box.bottom && maxY > box.top;
  }

  if (ya === yb) {
    return ya > box.top && ya < box.bottom && minX < box.right && maxX > box.left;
  }

  return true;
}

// Check if any polyline segment in points intersects any node box
function pathIntersectsAnyDevice(points, deviceBoxes) {
  for (let i = 0; i < points.length - 1; i++) {
    const pA = points[i];
    const pB = points[i + 1];

    // Ignore start/end vertical stub segments (leaving/entering port)
    if (i === 0 || i === points.length - 2) continue;

    for (const box of deviceBoxes) {
      if (segmentIntersectsBox(pA.x, pA.y, pB.x, pB.y, box)) {
        return true;
      }
    }
  }
  return false;
}

// Calculate total length of a polyline path
function calculatePathLength(points) {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

// Shortest-Path Manhattan 90-degree orthogonal polyline routing algorithm:
// Evaluates tight local bottom channels, vertical midpoints, and side bypasses
function calculateShortestOrthogonalPath(
  p1,
  p2,
  srcNodeGroup,
  dstNodeGroup,
  allNodeGroups = [],
  srcPortId = "",
  dstPortId = "",
) {
  const x1 = p1.x;
  const y1 = p1.y;
  const x2 = p2.x;
  const y2 = p2.y;

  const parsePortNum = (idStr) => {
    const num = Number.parseInt(String(idStr).replace(/\D/g, ""), 10);
    return Number.isNaN(num) ? 1 : num;
  };

  const p1Num = parsePortNum(srcPortId);
  const p2Num = parsePortNum(dstPortId);

  // Track spacing: 14px parallel separation per port
  const trackOffset = (p1Num - 1) * 14;
  const trackOffsetDst = (p2Num - 1) * 14;

  const srcBox = getNodeBoundingBox(srcNodeGroup);
  const dstBox = getNodeBoundingBox(dstNodeGroup);

  const allDeviceBoxes = allNodeGroups.map(getNodeBoundingBox).filter(Boolean);

  const baseDrop = 16;
  const yA = (srcBox ? srcBox.bottom : y1 + 8) + baseDrop + trackOffset;
  const yB = (dstBox ? dstBox.bottom : y2 + 8) + baseDrop + trackOffsetDst;

  const candidates = [];

  // Candidate 1: Local Tight Bottom Channel (just 16px below the src & dst device bottoms)
  const localBottomY = Math.max(yA, yB);
  candidates.push([
    { x: x1, y: y1 },
    { x: x1, y: localBottomY },
    { x: x2, y: localBottomY },
    { x: x2, y: y2 },
  ]);

  // Candidate 2: Direct Midpoint Corridor (if destination device is vertically below source)
  if (dstBox && dstBox.top > (srcBox ? srcBox.bottom : y1) + 20) {
    const openMidY = (srcBox.bottom + dstBox.top) / 2 + trackOffset;
    candidates.push([
      { x: x1, y: y1 },
      { x: x1, y: yA },
      { x: x1, y: openMidY },
      { x: x2, y: openMidY },
      { x: x2, y: yB },
      { x: x2, y: y2 },
    ]);
  }

  // Candidate 3: Side-Bypass Corridors
  const srcRight = srcBox ? srcBox.right : x1 + 60;
  const dstRight = dstBox ? dstBox.right : x2 + 60;
  const srcLeft = srcBox ? srcBox.left : x1 - 60;
  const dstLeft = dstBox ? dstBox.left : x2 - 60;

  const rightBypassX = Math.max(srcRight, dstRight) + 20 + trackOffset;
  candidates.push([
    { x: x1, y: y1 },
    { x: x1, y: yA },
    { x: rightBypassX, y: yA },
    { x: rightBypassX, y: yB },
    { x: x2, y: yB },
    { x: x2, y: y2 },
  ]);

  const leftBypassX = Math.min(srcLeft, dstLeft) - 20 - trackOffset;
  candidates.push([
    { x: x1, y: y1 },
    { x: x1, y: yA },
    { x: leftBypassX, y: yA },
    { x: leftBypassX, y: yB },
    { x: x2, y: yB },
    { x: x2, y: y2 },
  ]);

  // Filter candidate paths that do NOT intersect any device box
  const validPaths = candidates.filter((path) => !pathIntersectsAnyDevice(path, allDeviceBoxes));

  // Choose the SHORTEST valid non-intersecting path!
  if (validPaths.length > 0) {
    validPaths.sort((a, b) => calculatePathLength(a) - calculatePathLength(b));
    return validPaths[0];
  }

  // Fallback: Tight local bottom channel
  return candidates[0];
}

function findClosestPortInNode(nodeGroup, absClickX, absClickY, threshold = 45) {
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

function updateWirePositions(
  canvas,
  _nodes,
  wires,
  nodeGroupsMap,
  onDeleteWire,
  wirePolylineMapRef,
) {
  if (!canvas || canvas.isDisposed) return;

  if (wirePolylineMapRef?.current) {
    wirePolylineMapRef.current.clear();
  }

  const existingLines = canvas.getObjects().filter((obj) => obj.isWireLine);
  for (const lineObj of existingLines) {
    canvas.remove(lineObj);
  }

  const allNodeGroups = canvas.getObjects().filter((obj) => obj.isNodeGroup);

  for (const wire of wires) {
    const srcGroup = nodeGroupsMap.get(wire.srcNodeId);
    const dstGroup = nodeGroupsMap.get(wire.dstNodeId);

    if (srcGroup && dstGroup) {
      const p1 = srcGroup.getPortAbsPosition(wire.srcPortId);
      const p2 = dstGroup.getPortAbsPosition(wire.dstPortId);

      if (p1 && p2) {
        const orthoPoints = calculateShortestOrthogonalPath(
          p1,
          p2,
          srcGroup,
          dstGroup,
          allNodeGroups,
          wire.srcPortId,
          wire.dstPortId,
        );

        const wirePolyline = new Polyline(orthoPoints, {
          stroke: wire.tzspTarget ? "#f59e0b" : "#10b981",
          strokeWidth: 3,
          fill: "transparent",
          strokeLineJoin: "round",
          strokeLineCap: "round",
          selectable: true,
          hasBorders: false,
          hasControls: false,
          objectCaching: false,
        });
        wirePolyline.isWireLine = true;
        wirePolyline.wireData = wire;

        if (wirePolylineMapRef?.current) {
          wirePolylineMapRef.current.set(wire.id, {
            wire,
            points: orthoPoints,
            polyline: wirePolyline,
          });
        }

        if (onDeleteWire) {
          wirePolyline.on("mousedblclick", () => {
            console.log("[NETLAB-WIRE-DEBUG] Double-clicked orthogonal wire to delete:", wire.id);
            onDeleteWire(wire.id);
          });
        }

        canvas.add(wirePolyline);
        canvas.sendObjectToBack(wirePolyline);
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
    hasBorders: false,
    hasControls: false,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    subTargetCheck: true,
  });

  nodeGroup.isNodeGroup = true;
  nodeGroup.nodeData = node;

  nodeGroup.portRelativePositions = new Map();
  nodePorts.forEach((port, idx) => {
    const relX = 23 + idx * 25;
    const relY = 38;
    nodeGroup.portRelativePositions.set(port.id, { x: relX, y: relY });
  });

  nodeGroup.getPortAbsPosition = (portId) => {
    const relPos = nodeGroup.portRelativePositions.get(portId);
    if (relPos) {
      return {
        x: nodeGroup.left + relPos.x,
        y: nodeGroup.top + relPos.y,
      };
    }

    return {
      x: nodeGroup.left + (nodeGroup.width || 120) / 2,
      y: nodeGroup.top + (nodeGroup.height || 50) / 2,
    };
  };

  return nodeGroup;
}

function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

function getPortAbsPositionFromNodeData(node, portId, templates) {
  const tmpl = templates?.find((t) => t.id === node.templateId);
  const ports = node.ports || tmpl?.ports || [];
  const idx = ports.findIndex((p) => p.id === portId || p.name === portId);

  const relX = 23 + (idx >= 0 ? idx : 0) * 25;
  const relY = 38;

  return {
    x: (node.x || 0) + relX,
    y: (node.y || 0) + relY,
  };
}
