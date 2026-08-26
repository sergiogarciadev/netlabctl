import {
  Circle,
  Canvas as FabricCanvas,
  Group,
  Polygon,
  Polyline,
  Rect,
  Shadow,
  loadSVGFromString,
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
  selectedNode = null,
  onSelectNode,
  onAddWire,
  onDeleteWire,
  onDeleteNode,
  onUpdateNode,
  showDebugHud = true,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const wiringStateRef = useRef({
    active: false,
    srcNodeId: null,
    srcNodeGroup: null,
    srcPortId: null,
    startPos: null,
    tempLine: null,
    tempArrow: null,
  });
  const hoveredPortObjRef = useRef(null);

  const panStateRef = useRef({
    isPanning: false,
    lastPosX: 0,
    lastPosY: 0,
  });

  const viewportTransformRef = useRef([1, 0, 0, 1, 0, 0]);
  const wirePolylineMapRef = useRef(new Map());
  const wirePointsCacheRef = useRef(new Map());
  const wireStatsRef = useRef([]);

  // Stable refs for callback props and activeTool — allows the one-time canvas
  // initialization useEffect to always read the latest values without re-running.
  const activeToolRef = useRef(activeTool);
  const onSelectNodeRef = useRef(onSelectNode);
  const onAddWireRef = useRef(onAddWire);
  const onDeleteWireRef = useRef(onDeleteWire);
  const onDeleteNodeRef = useRef(onDeleteNode);
  const onUpdateNodeRef = useRef(onUpdateNode);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  useEffect(() => {
    onSelectNodeRef.current = onSelectNode;
  }, [onSelectNode]);
  useEffect(() => {
    onAddWireRef.current = onAddWire;
  }, [onAddWire]);
  useEffect(() => {
    onDeleteWireRef.current = onDeleteWire;
  }, [onDeleteWire]);
  useEffect(() => {
    onDeleteNodeRef.current = onDeleteNode;
  }, [onDeleteNode]);
  useEffect(() => {
    onUpdateNodeRef.current = onUpdateNode;
  }, [onUpdateNode]);

  // Isolated local debug info state
  const [debugInfo, setDebugInfo] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(100);

  const showDebugHudRef = useRef(showDebugHud);
  useEffect(() => {
    showDebugHudRef.current = showDebugHud;
  }, [showDebugHud]);

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

    for (const stat of wireStats) {
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
        continue;
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
    }
  }, [wireStats, triggerCircleAnimation]);

  const cancelWiring = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (canvas && !canvas.isDisposed) {
      if (wiringStateRef.current.tempLine) {
        canvas.remove(wiringStateRef.current.tempLine);
      }
      if (wiringStateRef.current.tempArrow) {
        canvas.remove(wiringStateRef.current.tempArrow);
      }
      if (hoveredPortObjRef.current) {
        const oldObj = hoveredPortObjRef.current;
        if (typeof oldObj.set === "function") {
          oldObj.set({ fill: oldObj.basePortColor || "#4d4d4d" });
        }
        hoveredPortObjRef.current = null;
      }
    }
    console.log("[NETLAB-WIRE-DEBUG] Wiring canceled/reset.");
    wiringStateRef.current = {
      active: false,
      srcNodeId: null,
      srcNodeGroup: null,
      srcPortId: null,
      startPos: null,
      tempLine: null,
      tempArrow: null,
    };
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

  // Initialize Fabric Canvas — runs exactly once on mount.
  // All callback props and activeTool are read via refs to avoid re-creating the canvas.
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    console.log("[NETLAB-WIRE-DEBUG] Initializing Fabric Canvas:", { width, height });

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
      const tag = document.activeElement?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable) {
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        const activeObj = canvas.getActiveObject();
        if (activeObj?.isNodeGroup && onDeleteNodeRef.current) {
          console.log("[NETLAB-WIRE-DEBUG] Delete key pressed for node:", activeObj.nodeData.id);
          onDeleteNodeRef.current(activeObj.nodeData.id);
        } else if (activeObj?.isWireLine && onDeleteWireRef.current) {
          console.log("[NETLAB-WIRE-DEBUG] Delete key pressed for wire:", activeObj.wireData.id);
          onDeleteWireRef.current(activeObj.wireData.id);
        }
      } else if (e.key === "Escape") {
        cancelWiring();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    const handleWindowMouseUp = (e) => {
      if (fabricCanvasRef.current && !fabricCanvasRef.current.isDisposed) {
        const c = fabricCanvasRef.current;
        if (c._currentTransform) {
          c._onMouseUp(e);
        }
      }
    };
    window.addEventListener("mouseup", handleWindowMouseUp);

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
        if (subTarget?.portId) {
          const pPos = target.getPortAbsPosition(subTarget.portId);
          const pObj = (target.nodeData?.ports || []).find((p) => p.id === subTarget.portId);
          const pType = pObj?.type || pObj?.netdevType || "managed";
          const isManaged = pType === "managed";
          nearestPort = { portId: subTarget.portId, absPos: pPos, dist: 0, port: pObj, isManaged };
        } else {
          nearestPort = findClosestPortInNode(target, pointer.x, pointer.y, 65);
        }
      } else {
        for (const obj of canvas.getObjects()) {
          if (obj.isNodeGroup) {
            const near = findClosestPortInNode(obj, pointer.x, pointer.y, 45);
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

      if (showDebugHudRef.current) {
        setDebugInfo((prev) => {
          if (
            prev &&
            prev.nodeId === nodeId &&
            prev.subTargetTag === subTargetTag &&
            prev.nearestPort?.portId === nearestPort?.portId &&
            prev.hoveredWire?.id === hoveredWire?.id &&
            prev.isWiring === wiringStateRef.current.active
          ) {
            return prev;
          }
          return {
            activeTool: activeToolRef.current,
            pointer,
            nodeId,
            subTargetTag,
            nearestPort,
            hoveredWire,
            onTestPulseWire: handleTestPulseWire,
            isWiring: wiringStateRef.current.active,
            srcPortId: wiringStateRef.current.srcPortId,
          };
        });
      }

      if (nearestPort && target?.isNodeGroup) {
        const pObj = target.getPortElement ? target.getPortElement(nearestPort.portId) : null;
        const isManaged = nearestPort.isManaged !== false;

        if (pObj) {
          if (hoveredPortObjRef.current && hoveredPortObjRef.current !== pObj) {
            const oldObj = hoveredPortObjRef.current;
            if (typeof oldObj.set === "function") {
              oldObj.set({ fill: oldObj.basePortColor || "#4d4d4d" });
            }
          }

          hoveredPortObjRef.current = pObj;
          const highlightColor = isManaged ? "#00ff00" : "#ef4444";
          pObj.set({ fill: highlightColor });
          canvas.requestRenderAll();
        }

        if (!isManaged) {
          canvas.defaultCursor = "not-allowed";
        } else {
          canvas.defaultCursor = "crosshair";
        }
      } else {
        if (hoveredPortObjRef.current) {
          const oldObj = hoveredPortObjRef.current;
          if (typeof oldObj.set === "function") {
            oldObj.set({ fill: oldObj.basePortColor || "#4d4d4d" });
          }
          hoveredPortObjRef.current = null;
          canvas.requestRenderAll();
        }
        if (!wiringStateRef.current.active) {
          canvas.defaultCursor = activeToolRef.current === "wire" ? "crosshair" : "default";
        }
      }

      if (wiringStateRef.current.active && wiringStateRef.current.tempLine) {
        const startPos = wiringStateRef.current.startPos;
        const srcNodeGroup = wiringStateRef.current.srcNodeGroup;
        const srcPortId = wiringStateRef.current.srcPortId;
        const allNodeGroups = canvas.getObjects().filter((obj) => obj.isNodeGroup);

        const targetPos = nearestPort ? nearestPort.absPos : pointer;

        const orthoPoints = calculateShortestOrthogonalPath(
          startPos,
          targetPos,
          srcNodeGroup,
          target?.isNodeGroup ? target : null,
          allNodeGroups,
          srcPortId,
          "",
        );
        wiringStateRef.current.tempLine.set({ points: orthoPoints });

        if (wiringStateRef.current.tempArrow) {
          const n = orthoPoints.length;
          const pPrev = n > 1 ? orthoPoints[n - 2] : startPos;
          const pEnd = orthoPoints[n - 1] || targetPos;
          const angleDeg = (Math.atan2(pEnd.y - pPrev.y, pEnd.x - pPrev.x) * 180) / Math.PI;

          wiringStateRef.current.tempArrow.set({
            left: pEnd.x,
            top: pEnd.y,
            angle: angleDeg,
            visible: true,
          });
          canvas.bringObjectToFront(wiringStateRef.current.tempLine);
          canvas.bringObjectToFront(wiringStateRef.current.tempArrow);
        }
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
        if (subTarget?.portId) {
          const pPos = targetNodeGroup.getPortAbsPosition(subTarget.portId);
          const pObj = (targetNodeGroup.nodeData?.ports || []).find(
            (p) => p.id === subTarget.portId,
          );
          const pType = pObj?.type || pObj?.netdevType || "managed";
          const isManaged = pType === "managed";
          nearPort = { portId: subTarget.portId, absPos: pPos, dist: 0, port: pObj, isManaged };
        } else {
          nearPort = findClosestPortInNode(targetNodeGroup, pointer.x, pointer.y, 65);
        }
      } else {
        for (const obj of canvas.getObjects()) {
          if (obj.isNodeGroup) {
            const hit = findClosestPortInNode(obj, pointer.x, pointer.y, 45);
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
        const isManaged = nearPort.isManaged !== false;

        opt.e.stopPropagation();

        if (!isManaged) {
          console.warn("[NETLAB-WIRE-DEBUG] Rejected wiring on non-managed port:", clickedPortId);
          return;
        }

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

          const tempLine = new Polyline(orthoPoints, {
            stroke: "#3b82f6",
            strokeWidth: 3,
            fill: "transparent",
            strokeDashArray: [6, 4],
            strokeLineJoin: "round",
            strokeLineCap: "round",
            selectable: false,
            evented: false,
          });

          const tempArrow = new Polygon(
            [
              { x: 0, y: -7 },
              { x: 14, y: 0 },
              { x: 0, y: 7 },
            ],
            {
              fill: "#3b82f6",
              stroke: "#2563eb",
              strokeWidth: 1,
              originX: "left",
              originY: "center",
              selectable: false,
              evented: false,
            },
          );

          wiringStateRef.current = {
            active: true,
            srcNodeId: node.id,
            srcNodeGroup: targetNodeGroup,
            srcPortId: clickedPortId,
            startPos: portAbsPos,
            tempLine,
            tempArrow,
          };
          canvas.add(tempLine);
          canvas.add(tempArrow);
          canvas.bringObjectToFront(tempLine);
          canvas.bringObjectToFront(tempArrow);
          canvas.requestRenderAll();
        } else {
          const { srcNodeId, srcPortId } = wiringStateRef.current;
          if (srcNodeId !== node.id || srcPortId !== clickedPortId) {
            onAddWireRef.current(srcNodeId, srcPortId, node.id, clickedPortId);
          }
          cancelWiring();
        }
        return;
      }

      if (wiringStateRef.current.active) {
        cancelWiring();
        return;
      }

      // SELECT TOOL MODE ONLY
      if (activeToolRef.current === "select") {
        if (target?.isNodeGroup) {
          onSelectNodeRef.current(target.nodeData);
        } else if (!target) {
          onSelectNodeRef.current(null);
        }
      }
    });

    canvas.on("mouse:up", () => {
      lockViewportTransform();
      if (panStateRef.current.isPanning) {
        panStateRef.current.isPanning = false;
        canvas.selection = activeToolRef.current === "select";
      }
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mouseup", handleWindowMouseUp);
      if (fabricCanvasRef.current && !fabricCanvasRef.current.isDisposed) {
        fabricCanvasRef.current.dispose();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelWiring, handleTestPulseWire]);

  // Sync Nodes and Wires on Canvas - Preserves existing Zoom & Pan ViewportTransform!
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || canvas.isDisposed) return;

    let isCancelled = false;
    canvas.defaultCursor = activeToolRef.current === "wire" ? "crosshair" : "default";
    const nodeGroupsMap = new Map();

    const renderAll = async () => {
      await Promise.all(
        templates.map(async (tmpl) => {
          if (!svgCache.has(tmpl.id)) {
            try {
              const svgStr = await fetchTemplateDrawing(tmpl.id);
              svgCache.set(tmpl.id, svgStr);
            } catch (err) {
              console.error(`[NETLAB-WIRE-DEBUG] Failed to prefetch SVG for ${tmpl.id}`, err);
            }
          }
        }),
      );

      if (isCancelled || canvas.isDisposed || !canvas.getContext()) return;

      canvas.clear();
      canvas.backgroundColor = "#090d16";

      if (viewportTransformRef.current) {
        canvas.setViewportTransform(viewportTransformRef.current);
      }

      const createdGroups = await Promise.all(
        nodes.map(async (node) => {
          const tmpl = templates.find((t) => t.id === node.templateId);
          const svgStr = tmpl ? svgCache.get(tmpl.id) || "" : "";

          const nodeGroup = await createExactSVGDeviceGroup(
            node,
            tmpl,
            svgStr,
            wires,
            activeToolRef.current,
          );
          return { node, nodeGroup };
        }),
      );

      if (isCancelled || canvas.isDisposed) return;

      for (const { node, nodeGroup } of createdGroups) {
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
            onDeleteWireRef.current,
            wirePolylineMapRef,
          );
        });

        // Persist final position to React state + backend after drag ends
        nodeGroup.on("modified", () => {
          const finalLeft = nodeGroup.left;
          const finalTop = nodeGroup.top;
          setTimeout(() => {
            if (onUpdateNodeRef.current) {
              onUpdateNodeRef.current({ ...node, x: finalLeft, y: finalTop });
            }
          }, 0);
        });

        canvas.add(nodeGroup);
        nodeGroupsMap.set(node.id, nodeGroup);
      }

      updateWirePositions(
        canvas,
        nodes,
        wires,
        nodeGroupsMap,
        onDeleteWireRef.current,
        wirePolylineMapRef,
      );
      if (!isCancelled && !canvas.isDisposed) {
        canvas.requestRenderAll();
      }
    };

    renderAll();

    return () => {
      isCancelled = true;
    };
  }, [nodes, wires, templates]);

  // Lightweight Tool Switching — Toggles selectable/cursor properties without clearing the canvas!
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || canvas.isDisposed) return;

    canvas.defaultCursor = activeTool === "wire" ? "crosshair" : "default";
    canvas.selection = activeTool === "select";

    const allNodeGroups = canvas.getObjects().filter((obj) => obj.isNodeGroup);
    for (const group of allNodeGroups) {
      group.selectable = activeTool === "select";
    }
    canvas.requestRenderAll();
  }, [activeTool]);

  return (
    <div className="canvas-wrapper" ref={containerRef}>
      <canvas ref={canvasRef} id="netlab-canvas" />

      {/* Floating Zoom HUD Controls — shifts left when sidebar is open */}
      <div
        style={{
          position: "absolute",
          bottom: "16px",
          right: selectedNode ? "446px" : "16px",
          transition: "right 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
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

      {showDebugHud && <DebugPanel debugInfo={debugInfo} />}
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
      const pType = port.type || port.netdevType || "managed";
      const isManaged = pType === "managed";
      closest = { portId: port.id, absPos: portPos, dist, port, isManaged };
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

        const baseColor = wire.tzspTarget ? "#f59e0b" : "#10b981";
        const wirePolyline = new Polyline(orthoPoints, {
          stroke: baseColor,
          strokeWidth: 3,
          fill: "transparent",
          strokeLineJoin: "round",
          strokeLineCap: "round",
          selectable: true,
          lockMovementX: true,
          lockMovementY: true,
          lockRotation: true,
          lockScalingX: true,
          lockScalingY: true,
          hasBorders: false,
          hasControls: false,
          objectCaching: false,
        });
        wirePolyline.isWireLine = true;
        wirePolyline.wireData = wire;

        wirePolyline.on("selected", () => {
          wirePolyline.set({ stroke: "#38bdf8", strokeWidth: 5 });
          canvas.requestRenderAll();
        });

        wirePolyline.on("deselected", () => {
          wirePolyline.set({ stroke: baseColor, strokeWidth: 3 });
          canvas.requestRenderAll();
        });

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

function getStylePropValue(elem, propName) {
  const styleAttr = elem.getAttribute("style");
  if (!styleAttr) return null;
  const match = styleAttr.match(new RegExp(`(?:^|;|\\s)${propName}\\s*:\\s*([^;]+)`, "i"));
  return match ? match[1].trim() : null;
}

function estimateTextWidth(text, fontSize, fontWeight) {
  if (!text) return 0;
  let widthFactor = 0.56;
  if (
    fontWeight === "bold" ||
    fontWeight === "700" ||
    fontWeight === "800" ||
    fontWeight === "900"
  ) {
    widthFactor = 0.62;
  }
  let totalWidth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (
      char === "i" ||
      char === "l" ||
      char === "j" ||
      char === "t" ||
      char === "f" ||
      char === "I" ||
      char === " "
    ) {
      totalWidth += fontSize * widthFactor * 0.5;
    } else if (char === "w" || char === "m" || char === "W" || char === "M") {
      totalWidth += fontSize * widthFactor * 1.4;
    } else if (char === char.toUpperCase() && char !== char.toLowerCase()) {
      totalWidth += fontSize * widthFactor * 1.15;
    } else {
      totalWidth += fontSize * widthFactor;
    }
  }
  return totalWidth;
}

function preprocessSVGString(svgStr) {
  if (!svgStr || typeof DOMParser === "undefined") return svgStr;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgStr, "image/svg+xml");
    const svgElem = doc.querySelector("svg");
    if (!svgElem) return svgStr;

    // 1. Resolve and expand <use> elements directly in DOM tree
    const useElems = Array.from(doc.querySelectorAll("use"));
    for (const use of useElems) {
      const href = use.getAttribute("href") || use.getAttribute("xlink:href");
      if (href) {
        const targetId = href.replace(/^#/, "");
        const targetElem = doc.getElementById(targetId);
        if (targetElem) {
          const clone = targetElem.cloneNode(true);
          clone.removeAttribute("id");

          const useX = use.getAttribute("x") || "0";
          const useY = use.getAttribute("y") || "0";
          const useTransform = use.getAttribute("transform") || "";
          const useClass = use.getAttribute("class") || "";
          const useStyle = use.getAttribute("style") || "";

          let combinedTransform = "";
          if (useX !== "0" || useY !== "0") {
            combinedTransform = `translate(${useX} ${useY})`;
          }
          if (useTransform) {
            combinedTransform = `${combinedTransform} ${useTransform}`.trim();
          }

          if (combinedTransform) {
            const existingTransform = clone.getAttribute("transform") || "";
            clone.setAttribute("transform", `${existingTransform} ${combinedTransform}`.trim());
          }

          if (useClass) {
            const existingClass = clone.getAttribute("class") || "";
            clone.setAttribute("class", `${existingClass} ${useClass}`.trim());
          }

          if (useStyle) {
            const existingStyle = clone.getAttribute("style") || "";
            clone.setAttribute("style", `${existingStyle};${useStyle}`);
          }

          if (use.id) {
            clone.id = use.id;
          }

          use.parentNode.replaceChild(clone, use);
        }
      }
    }

    // 2. Expand <text> elements containing <tspan> children into <g> groups of distinct <text> nodes
    const textElems = Array.from(doc.querySelectorAll("text"));
    for (const textNode of textElems) {
      const getProp = (node, prop) =>
        node ? node.getAttribute(prop) || getStylePropValue(node, prop) : null;

      const topProps = {
        fontFamily: getProp(textNode, "font-family") || "sans-serif",
        fontSize: Number.parseFloat(getProp(textNode, "font-size") || "12"),
        fontWeight: getProp(textNode, "font-weight") || "normal",
        fontStyle: getProp(textNode, "font-style") || "normal",
        fill: getProp(textNode, "fill") || "#000000",
        textAnchor: getProp(textNode, "text-anchor") || "start",
        dominantBaseline:
          getProp(textNode, "dominant-baseline") ||
          getProp(textNode, "alignment-baseline") ||
          "auto",
      };

      const hasTSpan = textNode.querySelector("tspan") !== null;
      if (!hasTSpan) {
        if (topProps.textAnchor) textNode.setAttribute("text-anchor", topProps.textAnchor);
        if (topProps.dominantBaseline)
          textNode.setAttribute("dominant-baseline", topProps.dominantBaseline);
        if (topProps.fontFamily) textNode.setAttribute("font-family", topProps.fontFamily);
        if (topProps.fontSize) textNode.setAttribute("font-size", `${topProps.fontSize}px`);
        if (topProps.fontWeight) textNode.setAttribute("font-weight", topProps.fontWeight);
        if (topProps.fontStyle) textNode.setAttribute("font-style", topProps.fontStyle);
        if (topProps.fill) textNode.setAttribute("fill", topProps.fill);
        continue;
      }

      const extractTextRuns = (node, parentProps) => {
        const currentProps = {
          fontFamily: getProp(node, "font-family") || parentProps.fontFamily,
          fontSize: Number.parseFloat(getProp(node, "font-size") || parentProps.fontSize),
          fontWeight: getProp(node, "font-weight") || parentProps.fontWeight,
          fontStyle: getProp(node, "font-style") || parentProps.fontStyle,
          fill: getProp(node, "fill") || parentProps.fill,
          textAnchor: getProp(node, "text-anchor") || parentProps.textAnchor,
          dominantBaseline:
            getProp(node, "dominant-baseline") ||
            getProp(node, "alignment-baseline") ||
            parentProps.dominantBaseline,
        };

        let runs = [];
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === 3) {
            const txt = child.nodeValue;
            if (txt && txt.trim() !== "") {
              runs.push({ text: txt, props: { ...currentProps } });
            }
          } else if (
            child.nodeType === 1 &&
            child.tagName &&
            child.tagName.toLowerCase() === "tspan"
          ) {
            runs = runs.concat(extractTextRuns(child, currentProps));
          }
        }
        return runs;
      };

      const runs = extractTextRuns(textNode, topProps);
      if (runs.length === 0) continue;

      const groupNode = doc.createElementNS("http://www.w3.org/2000/svg", "g");
      if (textNode.id) groupNode.id = textNode.id;
      if (textNode.getAttribute("class"))
        groupNode.setAttribute("class", textNode.getAttribute("class"));
      if (textNode.getAttribute("transform"))
        groupNode.setAttribute("transform", textNode.getAttribute("transform"));
      if (textNode.getAttribute("style"))
        groupNode.setAttribute("style", textNode.getAttribute("style"));

      let startX = Number.parseFloat(textNode.getAttribute("x") || "0");
      const startY = textNode.getAttribute("y") || "0";

      for (const run of runs) {
        const subText = doc.createElementNS("http://www.w3.org/2000/svg", "text");
        subText.setAttribute("x", startX.toString());
        subText.setAttribute("y", startY);
        subText.setAttribute("font-family", run.props.fontFamily);
        subText.setAttribute("font-size", `${run.props.fontSize}px`);
        subText.setAttribute("font-style", run.props.fontStyle);
        subText.setAttribute("font-weight", run.props.fontWeight);
        subText.setAttribute("fill", run.props.fill);
        if (run.props.textAnchor) subText.setAttribute("text-anchor", run.props.textAnchor);
        if (run.props.dominantBaseline)
          subText.setAttribute("dominant-baseline", run.props.dominantBaseline);

        subText.textContent = run.text;
        groupNode.appendChild(subText);

        startX += estimateTextWidth(run.text, run.props.fontSize, run.props.fontWeight);
      }

      if (textNode.parentNode) {
        textNode.parentNode.replaceChild(groupNode, textNode);
      }
    }

    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  } catch (err) {
    console.warn("[NETLAB-SVG-PREPROCESS] Error preprocessing SVG DOM:", err);
    return svgStr;
  }
}

async function createExactSVGDeviceGroup(node, tmpl, svgStr, wires, activeTool) {
  let svgObjects = [];

  if (svgStr) {
    try {
      const processedStr = preprocessSVGString(svgStr);
      const parsed = await loadSVGFromString(processedStr);
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
  const portElementsMap = new Map();

  const statusItems = tmpl?.status || [
    { id: "status-power", type: "power" },
    { id: "status-name", type: "name" },
  ];
  const powerItem = statusItems.find((s) => s.type === "power" || s.name === "power");
  const nameItem = statusItems.find((s) => s.type === "name" || s.name === "name");

  const matchPortId = (elemId, port, idx) => {
    if (!elemId) return false;
    const cleanElemId = String(elemId).toLowerCase();
    const pId = String(port.id || "").toLowerCase();
    const pName = String(port.name || "").toLowerCase();

    return (
      cleanElemId === pId ||
      cleanElemId === pName ||
      cleanElemId === `port-${pId}` ||
      cleanElemId === `port-${pName}` ||
      cleanElemId === `device-port-${pId}` ||
      cleanElemId === `device-port-${pName}` ||
      cleanElemId === `port${idx + 1}` ||
      cleanElemId === `p${idx + 1}` ||
      cleanElemId === `eth${idx}` ||
      cleanElemId === `ether${idx + 1}` ||
      cleanElemId.endsWith(`-${pId}`) ||
      cleanElemId.endsWith(`-${pName}`)
    );
  };

  const processElement = (obj) => {
    const elemId = obj.id || "";

    const isNameElem =
      (nameItem && elemId === nameItem.id) ||
      elemId === "status-name" ||
      elemId === "device-name" ||
      elemId.includes("name");

    const isPowerElem =
      (powerItem && elemId === powerItem.id) ||
      elemId === "status-power" ||
      elemId === "device-power" ||
      elemId.includes("power");

    // Preserve and apply text alignment and font formatting on Fabric Text objects
    if (obj.type === "text" || obj.type === "i-text" || obj.type === "textbox") {
      const rawElem = obj._element || obj.element;
      const textAnchor = obj.textAnchor || rawElem?.getAttribute?.("text-anchor");
      const dominantBaseline =
        obj.dominantBaseline ||
        rawElem?.getAttribute?.("dominant-baseline") ||
        rawElem?.getAttribute?.("alignment-baseline");

      if (textAnchor === "middle") {
        obj.set({ originX: "center", textAlign: "center" });
      } else if (textAnchor === "end" || textAnchor === "right") {
        obj.set({ originX: "right", textAlign: "right" });
      } else if (textAnchor === "start" || textAnchor === "left") {
        obj.set({ originX: "left", textAlign: "left" });
      }

      if (dominantBaseline === "middle" || dominantBaseline === "central") {
        obj.set({ originY: "center" });
      } else if (dominantBaseline === "hanging" || dominantBaseline === "text-before-edge") {
        obj.set({ originY: "top" });
      }
    }

    if (isNameElem && typeof obj.set === "function") {
      obj.set({ text: node.name });
    }

    if (isPowerElem && typeof obj.set === "function") {
      const isPoweredOn =
        node.power === "on" || node.status === "running" || node.isPoweredOn === true;
      const powerColor = isPoweredOn ? "#22c55e" : "#ef4444";

      obj.set({ fill: powerColor });

      const existingClass = obj.className || obj.class || "";
      if (isPoweredOn) {
        if (!existingClass.includes("on")) {
          const newClass = `${existingClass} on`.trim();
          obj.set({ className: newClass, class: newClass });
        }
      } else {
        const newClass = existingClass
          .split(" ")
          .filter((c) => c !== "on")
          .join(" ");
        obj.set({ className: newClass, class: newClass });
      }
    }

    nodePorts.forEach((port, idx) => {
      if (matchPortId(elemId, port, idx)) {
        const pType = port.type || port.netdevType || "managed";
        const isManaged = pType === "managed";

        const tagChildren = (targetObj) => {
          targetObj.portId = port.id;
          targetObj.portData = port;
          targetObj.isManagedPort = isManaged;
          targetObj.hoverCursor = !isManaged
            ? "not-allowed"
            : activeTool === "wire"
              ? "crosshair"
              : "pointer";
          if (targetObj._objects && Array.isArray(targetObj._objects)) {
            targetObj._objects.forEach(tagChildren);
          }
        };
        tagChildren(obj);
        portElementsMap.set(port.id, obj);

        const isConnected = wires.some(
          (w) =>
            (w.srcNodeId === node.id && w.srcPortId === port.id) ||
            (w.dstNodeId === node.id && w.dstPortId === port.id),
        );

        let basePortColor = "#4d4d4d";
        if (isConnected) {
          basePortColor = "#00ff00";
        } else if (pType === "user" || pType === "slirp") {
          basePortColor = "#3b82f6";
        } else if (pType === "bridge") {
          basePortColor = "#a855f7";
        } else if (pType === "tap") {
          basePortColor = "#f59e0b";
        } else if (pType === "unmanaged") {
          basePortColor = "#64748b";
        }

        if (typeof obj.set === "function") {
          obj.set({ fill: basePortColor });
        }
        obj.basePortColor = basePortColor;
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
  nodeGroup.getPortElement = (portId) => {
    return portElementsMap.get(portId) || null;
  };

  nodeGroup.portRelativePositions = new Map();
  nodePorts.forEach((port, idx) => {
    if (portElementsMap.has(port.id)) {
      const portObj = portElementsMap.get(port.id);
      const center = portObj.getCenterPoint
        ? portObj.getCenterPoint()
        : { x: portObj.left || 0, y: portObj.top || 0 };
      const relX = center.x + (nodeGroup.width || 120) / 2;
      const relY = center.y + (nodeGroup.height || 50) / 2;
      nodeGroup.portRelativePositions.set(port.id, { x: relX, y: relY });
    } else {
      const count = nodePorts.length;
      const step = (nodeGroup.width || 120) / (count + 1);
      const relX = step * (idx + 1);
      const relY = (nodeGroup.height || 50) - 8;
      nodeGroup.portRelativePositions.set(port.id, { x: relX, y: relY });
    }
  });

  nodeGroup.getPortAbsPosition = (portId) => {
    if (portElementsMap.has(portId)) {
      const portObj = portElementsMap.get(portId);
      if (portObj && typeof portObj.getCenterPoint === "function") {
        const pt = portObj.getCenterPoint();
        if (pt && !Number.isNaN(pt.x) && !Number.isNaN(pt.y)) {
          return pt;
        }
      }
    }
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

  const count = ports.length || 1;
  const width = 120;
  const height = 50;
  const step = width / (count + 1);
  const relX = step * ((idx >= 0 ? idx : 0) + 1);
  const relY = height - 8;

  return {
    x: (node.x || 0) + relX,
    y: (node.y || 0) + relY,
  };
}
