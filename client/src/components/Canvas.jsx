import {
  Circle,
  Canvas as FabricCanvas,
  Text as FabricText,
  Group,
  loadSVGFromString,
  Polygon,
  Polyline,
  Rect,
  Shadow,
} from "fabric";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  onOpenTerminal,
  onAddWire,
  onDeleteWire,
  onDeleteNode,
  onUpdateNode,
  onViewportChange,
  jumpToNodeTarget = null,
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
  const onOpenTerminalRef = useRef(onOpenTerminal);
  useEffect(() => {
    onOpenTerminalRef.current = onOpenTerminal;
  }, [onOpenTerminal]);
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

  const onViewportChangeRef = useRef(onViewportChange);
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  const notifyViewportChange = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || canvas.isDisposed || !onViewportChangeRef.current) return;
    const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    const zoom = vpt[0] || 1;
    const vptX = vpt[4] || 0;
    const vptY = vpt[5] || 0;
    const cWidth = containerRef.current?.clientWidth || canvas.width || 1200;
    const cHeight = containerRef.current?.clientHeight || canvas.height || 800;

    const viewLeft = -vptX / zoom;
    const viewTop = -vptY / zoom;
    const viewWidth = cWidth / zoom;
    const viewHeight = cHeight / zoom;

    onViewportChangeRef.current({
      viewLeft,
      viewTop,
      viewWidth,
      viewHeight,
      zoom,
    });
  }, []);
  // Smoothly center the canvas viewport on jumpToNodeTarget
  useEffect(() => {
    if (!jumpToNodeTarget?.id) return;
    const targetNode = (nodes || []).find((n) => n.id === jumpToNodeTarget.id);
    if (!targetNode) return;

    const canvas = fabricCanvasRef.current;
    if (!canvas || canvas.isDisposed) return;

    const allObjects = canvas.getObjects();
    const targetGroup = allObjects.find(
      (obj) => obj.isNodeGroup && obj.nodeData?.id === targetNode.id,
    );

    let nodeX = targetNode.x || 0;
    let nodeY = targetNode.y || 0;
    let nodeWidth = 140;
    let nodeHeight = 50;

    if (targetGroup) {
      nodeX = targetGroup.left;
      nodeY = targetGroup.top;
      nodeWidth =
        typeof targetGroup.getScaledWidth === "function"
          ? targetGroup.getScaledWidth()
          : (targetGroup.width || 140) * (targetGroup.scaleX || 1);
      nodeHeight =
        typeof targetGroup.getScaledHeight === "function"
          ? targetGroup.getScaledHeight()
          : (targetGroup.height || 50) * (targetGroup.scaleY || 1);
    }

    const nodeCenterX = nodeX + nodeWidth / 2;
    const nodeCenterY = nodeY + nodeHeight / 2;

    const cWidth = containerRef.current?.clientWidth || canvas.width || 1200;
    const cHeight = containerRef.current?.clientHeight || canvas.height || 800;

    const zoom = canvas.getZoom() || 1;

    const panX = cWidth / 2 - nodeCenterX * zoom;
    const panY = cHeight / 2 - nodeCenterY * zoom;

    const newVpt = [zoom, 0, 0, zoom, panX, panY];
    canvas.setViewportTransform(newVpt);
    viewportTransformRef.current = [...newVpt];
    canvas.requestRenderAll();
    notifyViewportChange();

    if (targetGroup) {
      canvas.setActiveObject(targetGroup);
    }
    if (onSelectNodeRef.current) {
      onSelectNodeRef.current(targetNode);
    }
  }, [jumpToNodeTarget, nodes, notifyViewportChange]);

  // Isolated local debug info state
  const [debugInfo, setDebugInfo] = useState(null);
  const lastDebugStateRef = useRef(null);
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
    notifyViewportChange();
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
    notifyViewportChange();
  };

  const handleResetZoom = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || canvas.isDisposed) return;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    viewportTransformRef.current = [1, 0, 0, 1, 0, 0];
    setZoomLevel(100);
    notifyViewportChange();
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
      notifyViewportChange();

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
        notifyViewportChange();
        return;
      }

      const target = opt.target;
      const subTarget = opt.subTarget;

      let nearestPort = null;
      let nodeId = null;
      let subTargetTag = null;

      if (target?.isNodeGroup && target.nodeData) {
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
          if (obj.isNodeGroup && obj.nodeData) {
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
        const last = lastDebugStateRef.current;
        const isWiring = wiringStateRef.current.active;
        const nearestPortId = nearestPort?.portId;
        const hoveredWireId = hoveredWire?.id;

        if (
          !last ||
          last.nodeId !== nodeId ||
          last.subTargetTag !== subTargetTag ||
          last.nearestPortId !== nearestPortId ||
          last.hoveredWireId !== hoveredWireId ||
          last.isWiring !== isWiring
        ) {
          lastDebugStateRef.current = {
            nodeId,
            subTargetTag,
            nearestPortId,
            hoveredWireId,
            isWiring,
          };

          let allDevicePorts = null;
          let targetNodeGroup = null;
          if (nodeId) {
            targetNodeGroup = canvas
              .getObjects()
              .find((obj) => obj.isNodeGroup && obj.nodeData?.id === nodeId);
          }
          if (targetNodeGroup && targetNodeGroup.nodeData) {
            allDevicePorts = (targetNodeGroup.nodeData.ports || []).map((p) => {
              const pos = targetNodeGroup.getPortAbsPosition(p.id);
              return {
                id: p.id,
                name: p.name || p.id,
                type: p.type || p.netdevType || "managed",
                x: Math.round(pos?.x || 0),
                y: Math.round(pos?.y || 0),
              };
            });
          }

          setDebugInfo({
            activeTool: activeToolRef.current,
            pointer: { x: Math.round(pointer.x), y: Math.round(pointer.y) },
            nodeId,
            nodeName: targetNodeGroup?.nodeData?.name,
            subTargetTag,
            nearestPort,
            hoveredWire,
            allDevicePorts,
            onTestPulseWire: handleTestPulseWire,
            isWiring,
            srcPortId: wiringStateRef.current.srcPortId,
          });
        }
      }

      if (activeToolRef.current === "wire" && nearestPort && target?.isNodeGroup) {
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

      if (activeToolRef.current === "wire" && nearPort && targetNodeGroup) {
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

    canvas.on("object:modified", (opt) => {
      const target = opt.target;
      if (target?.isNodeGroup && target.nodeData) {
        const finalLeft = Math.round(target.left);
        const finalTop = Math.round(target.top);
        if (target.nodeData.x !== finalLeft || target.nodeData.y !== finalTop) {
          target.nodeData.x = finalLeft;
          target.nodeData.y = finalTop;
          if (onUpdateNodeRef.current) {
            onUpdateNodeRef.current({ ...target.nodeData, x: finalLeft, y: finalTop });
          }
        }
      }
    });

    canvas.on("mouse:up", (opt) => {
      const target = opt.target || canvas.getActiveObject();
      if (target?.isNodeGroup && target.nodeData) {
        const finalLeft = Math.round(target.left);
        const finalTop = Math.round(target.top);
        if (target.nodeData.x !== finalLeft || target.nodeData.y !== finalTop) {
          target.nodeData.x = finalLeft;
          target.nodeData.y = finalTop;
          if (onUpdateNodeRef.current) {
            onUpdateNodeRef.current({ ...target.nodeData, x: finalLeft, y: finalTop });
          }
        }
      }
    });

    canvas.on("mouse:dblclick", (opt) => {
      const target = opt.target;
      if (target?.isNodeGroup && target.nodeData) {
        if (onOpenTerminalRef.current) {
          onOpenTerminalRef.current(target.nodeData);
        }
      }
    });

    canvas.on("mouse:up", () => {
      lockViewportTransform();
      if (panStateRef.current.isPanning) {
        panStateRef.current.isPanning = false;
        canvas.selection = activeToolRef.current === "select";
      }
      notifyViewportChange();
    });

    notifyViewportChange();

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

  const nodesKey = useMemo(
    () =>
      JSON.stringify(
        (nodes || []).map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          name: n.name,
          power: n.power,
          status: n.status,
          ports: n.ports?.map((p) => ({ id: p.id, type: p.type, MAC: p.MAC })),
        })),
      ),
    [nodes],
  );

  const wiresKey = useMemo(
    () =>
      JSON.stringify(
        (wires || []).map((w) => ({
          id: w.id,
          srcNodeId: w.srcNodeId,
          srcPortId: w.srcPortId,
          dstNodeId: w.dstNodeId,
          dstPortId: w.dstPortId,
          tzspTarget: w.tzspTarget,
        })),
      ),
    [wires],
  );

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
  }, [nodesKey, wiresKey, templates]);

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

// Check if targetGroup collides with any other device group on the canvas
function checkDeviceCollision(targetGroup, allGroups) {
  const targetWidth =
    typeof targetGroup.getScaledWidth === "function"
      ? targetGroup.getScaledWidth()
      : (targetGroup.width || 120) * (targetGroup.scaleX || 1);
  const targetHeight =
    typeof targetGroup.getScaledHeight === "function"
      ? targetGroup.getScaledHeight()
      : (targetGroup.height || 50) * (targetGroup.scaleY || 1);

  const gap = 10; // Minimum 10px spacing between devices

  // In Fabric.js v7, group.left & group.top represent group center
  const tLeft = targetGroup.left - targetWidth / 2;
  const tRight = tLeft + targetWidth;
  const tTop = targetGroup.top - targetHeight / 2;
  const tBottom = tTop + targetHeight;

  for (const other of allGroups) {
    if (other === targetGroup || !other.isNodeGroup) continue;

    const otherWidth =
      typeof other.getScaledWidth === "function"
        ? other.getScaledWidth()
        : (other.width || 120) * (other.scaleX || 1);
    const otherHeight =
      typeof other.getScaledHeight === "function"
        ? other.getScaledHeight()
        : (other.height || 50) * (other.scaleY || 1);

    const oLeft = other.left - otherWidth / 2;
    const oRight = oLeft + otherWidth;
    const oTop = other.top - otherHeight / 2;
    const oBottom = oTop + otherHeight;

    // Check direct bounding box overlap with 10px gap
    const isOverlap =
      tRight + gap > oLeft && tLeft - gap < oRight && tBottom + gap > oTop && tTop - gap < oBottom;

    if (isOverlap) {
      return true;
    }
  }

  return false;
}

// Extract exact padded bounding box of a device node group on the canvas
function getNodeBoundingBox(group) {
  if (!group) return null;
  const padding = 8;
  const rawWidth =
    typeof group.getScaledWidth === "function"
      ? group.getScaledWidth()
      : (group.width || 120) * (group.scaleX || 1);
  const rawHeight =
    typeof group.getScaledHeight === "function"
      ? group.getScaledHeight()
      : (group.height || 50) * (group.scaleY || 1);

  const left = group.left - rawWidth / 2 - padding;
  const top = group.top - rawHeight / 2 - padding;
  const width = rawWidth + padding * 2;
  const height = rawHeight + padding * 2;

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
  const span = Math.abs(p1Num - p2Num);

  // Track spacing: Smart span-based channel offset to avoid ladder drop effect
  const isSameDevice = srcNodeGroup && dstNodeGroup && srcNodeGroup === dstNodeGroup;
  const trackOffset = isSameDevice
    ? Math.min(24, Math.floor(span / 2) * 6)
    : Math.min(24, ((p1Num - 1) % 4) * 6);
  const trackOffsetDst = isSameDevice ? trackOffset : Math.min(24, ((p2Num - 1) % 4) * 6);

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
  const getNodeGroup = (nodeId) => {
    if (nodeGroupsMap && nodeGroupsMap.has(nodeId)) {
      return nodeGroupsMap.get(nodeId);
    }
    return allNodeGroups.find((g) => g.nodeData?.id === nodeId);
  };

  for (const wire of wires) {
    const srcGroup = getNodeGroup(wire.srcNodeId);
    const dstGroup = getNodeGroup(wire.dstNodeId);

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

function preprocessSVGString(svgStr) {
  if (!svgStr || typeof DOMParser === "undefined") return svgStr;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgStr, "image/svg+xml");
    const svgElem = doc.querySelector("svg");
    if (!svgElem) return svgStr;

    // Resolve and expand <use> elements directly in DOM tree
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

    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  } catch (err) {
    console.warn("[NETLAB-SVG-PREPROCESS] Error preprocessing SVG DOM:", err);
    return svgStr;
  }
}

const parsedSvgCache = new Map();
const svgPortFractionsCache = new Map();

function getSvgPortMap(svgString) {
  if (!svgString || typeof DOMParser === "undefined") return new Map();
  if (svgPortFractionsCache.has(svgString)) {
    return svgPortFractionsCache.get(svgString);
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, "image/svg+xml");
    const svgElem = doc.querySelector("svg");
    if (!svgElem) return new Map();

    let viewBoxWidth = 120;
    let viewBoxHeight = 50;

    const viewBox = svgElem.getAttribute("viewBox");
    if (viewBox) {
      const parts = viewBox
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        viewBoxWidth = parts[2];
        viewBoxHeight = parts[3];
      }
    } else {
      viewBoxWidth = Number.parseFloat(svgElem.getAttribute("width")) || 120;
      viewBoxHeight = Number.parseFloat(svgElem.getAttribute("height")) || 50;
    }

    const getCumulativeTransform = (elem) => {
      let tx = 0;
      let ty = 0;
      let curr = elem;
      while (curr && curr !== svgElem) {
        const transform = curr.getAttribute("transform");
        if (transform) {
          const match = /translate\s*\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/.exec(transform);
          if (match) {
            tx += Number.parseFloat(match[1]) || 0;
            ty += Number.parseFloat(match[2] || "0") || 0;
          }
        }
        curr = curr.parentElement;
      }
      return { tx, ty };
    };

    const portMap = new Map();
    const allElems = doc.querySelectorAll("[id]");
    for (const elem of allElems) {
      const id = elem.getAttribute("id");
      if (
        !id ||
        id === "device-ports" ||
        id === "ports" ||
        id === "device-power" ||
        id === "device-name"
      ) {
        continue;
      }

      const x = Number.parseFloat(elem.getAttribute("x") || "0");
      const y = Number.parseFloat(elem.getAttribute("y") || "0");
      const width = Number.parseFloat(elem.getAttribute("width") || "0");
      const height = Number.parseFloat(elem.getAttribute("height") || "0");

      const { tx, ty } = getCumulativeTransform(elem);
      const centerX = tx + x + width / 2;
      const centerY = ty + y + height / 2;

      const fracX = Math.max(0.01, Math.min(0.99, centerX / viewBoxWidth));
      const fracY = Math.max(0.01, Math.min(0.99, centerY / viewBoxHeight));

      portMap.set(id, { fracX, fracY });
    }

    svgPortFractionsCache.set(svgString, portMap);
    return portMap;
  } catch (err) {
    console.warn("[NETLAB-SVG-PORTMAP] Error building port map from SVG XML:", err);
    return new Map();
  }
}

async function createExactSVGDeviceGroup(node, tmpl, svgStr, wires, activeTool) {
  const svgPortMap = getSvgPortMap(svgStr);
  let masterObjects = tmpl?.id ? parsedSvgCache.get(tmpl.id) : null;

  if (!masterObjects && svgStr) {
    try {
      const processedStr = preprocessSVGString(svgStr);
      const parsed = await loadSVGFromString(processedStr, (docElem, fabricObj) => {
        if (docElem && typeof docElem.getAttribute === "function" && fabricObj) {
          const id = docElem.getAttribute("id");
          const className = docElem.getAttribute("class");
          if (id) {
            fabricObj.id = id;
            fabricObj.name = id;
          }
          if (className) {
            fabricObj.className = className;
            fabricObj.class = className;
          }
        }
      });
      if (parsed.objects && parsed.objects.length > 0) {
        masterObjects = parsed.objects.filter((o) => o !== null);
        if (tmpl?.id) {
          parsedSvgCache.set(tmpl.id, masterObjects);
        }
      }
    } catch (e) {
      console.warn("[NETLAB-WIRE-DEBUG] Failed to parse device SVG:", e);
    }
  }

  let svgObjects = [];
  if (masterObjects && masterObjects.length > 0) {
    svgObjects = await Promise.all(
      masterObjects.map((obj) => obj.clone(["id", "name", "className", "class"])),
    );
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

  const isImageMissing = !tmpl?.image || tmpl?.imageExists === false;
  if (isImageMissing) {
    const warningBadge = new FabricText("⚠️", {
      left: 4,
      top: 4,
      fontSize: 14,
      fontFamily: "sans-serif",
      id: "warning-image-missing",
    });
    warningBadge.isWarningBadge = true;
    svgObjects.push(warningBadge);
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
    if (
      cleanElemId === "device-ports" ||
      cleanElemId === "ports" ||
      cleanElemId === "device-power" ||
      cleanElemId === "device-name" ||
      cleanElemId === "status-power" ||
      cleanElemId === "status-name"
    ) {
      return false;
    }
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
      cleanElemId === `ether${idx + 1}`
    );
  };

  const getElemId = (targetObj) => {
    if (!targetObj) return "";
    if (targetObj.id) return String(targetObj.id);
    if (targetObj.name) return String(targetObj.name);
    if (targetObj.element && typeof targetObj.element.getAttribute === "function") {
      const attrId = targetObj.element.getAttribute("id");
      if (attrId) return String(attrId);
    }
    return "";
  };

  const processElement = (obj) => {
    const elemId = getElemId(obj);

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

        const isConnected = wires.some(
          (w) =>
            (w.srcNodeId === node.id &&
              (w.srcPortId === port.id ||
                w.srcPortId === port.name ||
                w.srcPortId === `device-port-${port.id}` ||
                w.srcPortId === `device-port-${idx + 1}`)) ||
            (w.dstNodeId === node.id &&
              (w.dstPortId === port.id ||
                w.dstPortId === port.name ||
                w.dstPortId === `device-port-${port.id}` ||
                w.dstPortId === `device-port-${idx + 1}`)),
        );

        let basePortColor = "#4d4d4d";
        if (isConnected) {
          basePortColor = "#10b981"; // Connected Green
        } else if (pType === "unmanaged") {
          basePortColor = "#38bdf8"; // Unmanaged Sky Blue
        } else if (pType === "user" || pType === "slirp") {
          basePortColor = "#3b82f6"; // User / SLIRP Blue
        } else if (pType === "bridge") {
          basePortColor = "#a855f7"; // Bridge Purple
        } else if (pType === "tap") {
          basePortColor = "#f59e0b"; // TAP Amber
        } else {
          basePortColor = "#4d4d4d"; // Disconnected Dark Grey
        }

        const tagChildren = (targetObj) => {
          targetObj.portId = port.id;
          targetObj.portData = port;
          targetObj.isManagedPort = isManaged;
          targetObj.basePortColor = basePortColor;
          targetObj.hoverCursor = !isManaged
            ? "not-allowed"
            : activeTool === "wire"
              ? "crosshair"
              : "pointer";
          if (typeof targetObj.set === "function" && targetObj.type !== "text") {
            targetObj.set({ fill: basePortColor });
          }
          if (targetObj._objects && Array.isArray(targetObj._objects)) {
            targetObj._objects.forEach(tagChildren);
          }
        };
        tagChildren(obj);
        portElementsMap.set(port.id, obj);
        if (port.name) {
          portElementsMap.set(port.name, obj);
        }
        portElementsMap.set(`device-port-${port.id}`, obj);
        portElementsMap.set(`device-port-${idx + 1}`, obj);
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

  if (isImageMissing) {
    // Dim device drawing SVG elements to make the machine look visually disabled
    for (const o of nodeGroup._objects || []) {
      if (!o.isWarningBadge && typeof o.set === "function") {
        o.set({ opacity: 0.4 });
      }
    }

    const wObj = (nodeGroup._objects || []).find((o) => o.isWarningBadge);
    if (wObj) {
      const gWidth = nodeGroup.width || 120;
      const gHeight = nodeGroup.height || 50;
      wObj.set({
        left: -gWidth / 2 + 4,
        top: -gHeight / 2 + 4,
        opacity: 1.0,
      });
      nodeGroup.bringObjectToFront(wObj);
    }
  }

  nodeGroup.isNodeGroup = true;
  nodeGroup.nodeData = node;
  nodeGroup.getPortElement = (portId) => {
    if (!portId) return null;
    let elem = portElementsMap.get(portId);
    if (!elem) {
      elem =
        portElementsMap.get(String(portId)) ||
        portElementsMap.get(`device-port-${portId}`) ||
        portElementsMap.get(`port-${portId}`);
    }
    return elem || null;
  };

  nodeGroup.portRelativePositions = new Map();
  nodePorts.forEach((port, idx) => {
    if (portElementsMap.has(port.id)) {
      const portObj = portElementsMap.get(port.id);
      const localX = portObj.left !== undefined ? portObj.left : 0;
      const localY = portObj.top !== undefined ? portObj.top : 0;
      nodeGroup.portRelativePositions.set(port.id, { x: localX, y: localY });
      if (port.name) {
        nodeGroup.portRelativePositions.set(port.name, { x: localX, y: localY });
      }
    } else {
      const count = nodePorts.length;
      const width = nodeGroup.width || 120;
      const height = nodeGroup.height || 50;
      const step = width / (count + 1);
      const relXFromLeft = step * (idx + 1);
      const relYFromTop = height - 8;
      const localX = relXFromLeft - width / 2;
      const localY = relYFromTop - height / 2;
      nodeGroup.portRelativePositions.set(port.id, { x: localX, y: localY });
      if (port.name) {
        nodeGroup.portRelativePositions.set(port.name, { x: localX, y: localY });
      }
    }
  });

  nodeGroup.svgPortMap = svgPortMap;

  nodeGroup.getPortAbsPosition = (portId) => {
    const scaleX = nodeGroup.scaleX || 1;
    const scaleY = nodeGroup.scaleY || 1;
    const groupWidth =
      typeof nodeGroup.getScaledWidth === "function"
        ? nodeGroup.getScaledWidth()
        : (nodeGroup.width || 120) * scaleX;
    const groupHeight =
      typeof nodeGroup.getScaledHeight === "function"
        ? nodeGroup.getScaledHeight()
        : (nodeGroup.height || 50) * scaleY;

    // In Fabric.js v7, nodeGroup.left and nodeGroup.top represent the CENTER of the group.
    // Top-left origin of the device on the canvas:
    const topLeftX = nodeGroup.left - groupWidth / 2;
    const topLeftY = nodeGroup.top - groupHeight / 2;

    const activePortMap = nodeGroup.svgPortMap || svgPortMap;
    let portFrac = activePortMap ? activePortMap.get(portId) : null;

    if (!portFrac && activePortMap && portId) {
      const cleanId = String(portId).toLowerCase();
      portFrac =
        activePortMap.get(cleanId) ||
        activePortMap.get(`device-port-${cleanId}`) ||
        activePortMap.get(`port-${cleanId}`);
    }

    if (!portFrac && activePortMap && nodePorts) {
      const idx = nodePorts.findIndex((p, i) => {
        if (!p) return false;
        const pId = String(p.id || "").toLowerCase();
        const pName = String(p.name || "").toLowerCase();
        const targetId = String(portId || "").toLowerCase();
        return (
          pId === targetId ||
          pName === targetId ||
          `device-port-${pId}` === targetId ||
          `device-port-${i + 1}` === targetId ||
          `port-${pId}` === targetId ||
          `port-${i + 1}` === targetId ||
          String(i + 1) === targetId ||
          `eth${i}` === targetId ||
          `ether${i + 1}` === targetId
        );
      });

      if (idx >= 0) {
        const targetPort = nodePorts[idx];
        portFrac =
          activePortMap.get(targetPort.id) ||
          activePortMap.get(targetPort.name) ||
          activePortMap.get(`device-port-${targetPort.id}`) ||
          activePortMap.get(`device-port-${idx + 1}`) ||
          activePortMap.get(`port-${targetPort.id}`) ||
          activePortMap.get(`port-${idx + 1}`);
      }
    }

    // Helper to check if device SVG has 2 rows of ports
    const hasTwoPortRows = (pmap) => {
      if (!pmap || pmap.size < 2) return false;
      const ySet = new Set();
      for (const pos of pmap.values()) {
        if (pos && typeof pos.fracY === "number") {
          ySet.add(Math.round(pos.fracY * 50));
        }
      }
      return ySet.size >= 2;
    };

    if (portFrac) {
      let xOffset = 0;
      if (hasTwoPortRows(activePortMap)) {
        const pNum = parsePortNum(portId);
        // Odd rows/ports (1, 3, 5...) -> -10px (left), Even rows/ports (2, 4, 6...) -> +10px (right)
        xOffset = pNum % 2 === 0 ? 10 : -10;
      }
      return {
        x: topLeftX + groupWidth * portFrac.fracX + xOffset,
        y: topLeftY + groupHeight * portFrac.fracY,
      };
    }

    const idx = nodePorts.findIndex((p) => p.id === portId || p.name === portId);
    const portIndex = idx >= 0 ? idx : 0;
    const count = nodePorts.length || 1;
    const fracX = (portIndex + 1) / (count + 1);
    const fracY = 0.76;

    let fallbackXOffset = 0;
    if (hasTwoPortRows(activePortMap)) {
      const pNum = parsePortNum(portId);
      fallbackXOffset = pNum % 2 === 0 ? 10 : -10;
    }

    return {
      x: topLeftX + groupWidth * fracX + fallbackXOffset,
      y: topLeftY + groupHeight * fracY,
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
