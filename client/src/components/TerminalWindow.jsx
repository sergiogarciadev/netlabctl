import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Anchor, ExternalLink, Maximize2, Minimize2, Move, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

export function TerminalWindow({
  projectId,
  node,
  onClose,
  terminalIndex = 0,
  totalTerminals = 1,
}) {
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);

  // Load layout memory per machine ID from localStorage
  const loadLayout = useCallback(() => {
    try {
      const saved = localStorage.getItem(`netlab_terminal_${node.id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          isDetached: Boolean(parsed.isDetached),
          x: typeof parsed.x === "number" ? parsed.x : 80 + terminalIndex * 35,
          y: typeof parsed.y === "number" ? parsed.y : 80 + terminalIndex * 35,
          width: typeof parsed.width === "number" ? parsed.width : 600,
          height: typeof parsed.height === "number" ? parsed.height : 340,
        };
      }
    } catch (err) {
      console.warn("[NETLAB-TERMINAL] Failed to load saved layout for node:", node.id, err);
    }
    return {
      isDetached: false,
      x: 80 + terminalIndex * 35,
      y: 80 + terminalIndex * 35,
      width: 600,
      height: 340,
    };
  }, [node.id, terminalIndex]);

  const [layout, setLayout] = useState(loadLayout);

  const updateLayout = useCallback(
    (newLayout) => {
      setLayout((prev) => {
        const updated = typeof newLayout === "function" ? newLayout(prev) : newLayout;
        try {
          localStorage.setItem(`netlab_terminal_${node.id}`, JSON.stringify(updated));
        } catch (err) {
          console.warn("[NETLAB-TERMINAL] Failed to save layout:", err);
        }
        return updated;
      });
    },
    [node.id],
  );

  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const windowStartPosRef = useRef({ x: 0, y: 0 });

  const isResizingRef = useRef(false);
  const resizeStartPosRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // Handle Window Dragging (when detached)
  const handleDragMouseDown = (e) => {
    if (!layout.isDetached) return;
    isDraggingRef.current = true;
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    windowStartPosRef.current = { x: layout.x, y: layout.y };
    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
  };

  const handleWindowMouseMove = useCallback((e) => {
    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartPosRef.current.x;
      const dy = e.clientY - dragStartPosRef.current.y;
      const newX = Math.max(0, Math.min(window.innerWidth - 200, windowStartPosRef.current.x + dx));
      const newY = Math.max(
        50,
        Math.min(window.innerHeight - 100, windowStartPosRef.current.y + dy),
      );
      setLayout((prev) => ({ ...prev, x: newX, y: newY }));
    } else if (isResizingRef.current) {
      const dx = e.clientX - resizeStartPosRef.current.x;
      const dy = e.clientY - resizeStartPosRef.current.y;
      const newW = Math.max(
        340,
        Math.min(window.innerWidth - 40, resizeStartPosRef.current.w + dx),
      );
      const newH = Math.max(
        160,
        Math.min(window.innerHeight - 80, resizeStartPosRef.current.h + dy),
      );
      setLayout((prev) => ({ ...prev, width: newW, height: newH }));
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    }
  }, []);

  const handleWindowMouseUp = useCallback(() => {
    if (isDraggingRef.current || isResizingRef.current) {
      isDraggingRef.current = false;
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);

      setLayout((current) => {
        try {
          localStorage.setItem(`netlab_terminal_${node.id}`, JSON.stringify(current));
        } catch (err) {
          // ignore
        }
        return current;
      });

      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    }
  }, [handleWindowMouseMove, node.id]);

  const handleDockResizeMouseDown = (e) => {
    if (layout.isDetached) return;
    isResizingRef.current = true;
    resizeStartPosRef.current = { x: e.clientX, y: e.clientY, w: layout.width, h: layout.height };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
  };

  const handleCornerResizeMouseDown = (e) => {
    e.stopPropagation();
    isResizingRef.current = true;
    resizeStartPosRef.current = { x: e.clientX, y: e.clientY, w: layout.width, h: layout.height };
    document.body.style.cursor = "se-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
  };

  const toggleAttachDetach = () => {
    updateLayout((prev) => {
      const nextDetached = !prev.isDetached;
      return {
        ...prev,
        isDetached: nextDetached,
        x: prev.x || 80 + terminalIndex * 35,
        y: prev.y || 80 + terminalIndex * 35,
      };
    });
    setTimeout(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    }, 50);
  };

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [handleWindowMouseMove, handleWindowMouseUp]);

  useEffect(() => {
    if (!node || !terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: "#090d16",
        foreground: "#f8fafc",
        cursor: "#38bdf8",
      },
      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    term.open(terminalRef.current);
    fitAddon.fit();

    const host =
      window.location.port === "3000" ? `${window.location.hostname}:8080` : window.location.host;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${host}/api/v1/projects/${projectId || "default"}/nodes/${node.id}/terminal`;

    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      term.writeln(`\x1b[1;32mConnected to serial console for ${node.name}...\x1b[0m\r\n`);
    };

    socket.onmessage = (event) => {
      term.write(event.data);
    };

    socket.onerror = (err) => {
      term.writeln("\r\n\x1b[1;31mTerminal connection error.\x1b[0m\r\n");
    };

    term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    });

    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      socket.close();
      term.dispose();
    };
  }, [projectId, node]);

  // Floating Detached Window Style vs Docked Bottom Window Style
  const detachedStyle = {
    position: "fixed",
    left: `${layout.x}px`,
    top: `${layout.y}px`,
    width: `${layout.width}px`,
    height: `${layout.height}px`,
    zIndex: 200 + terminalIndex,
    background: "rgba(15, 23, 42, 0.95)",
    backdropFilter: "blur(16px)",
    borderRadius: "8px",
    border: "1px solid var(--accent-primary)",
    boxShadow: "0 12px 36px rgba(0,0,0,0.8)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };

  const dockedStyle = {
    position: "relative",
    width: totalTerminals > 1 ? `calc(100% / ${totalTerminals} - 4px)` : "100%",
    height: `${layout.height}px`,
    background: "#090d16",
    borderTop: "1px solid var(--border-color)",
    borderRight: totalTerminals > 1 ? "1px solid var(--border-color)" : "none",
    display: "flex",
    flexDirection: "column",
    zIndex: 30,
    boxShadow: "0 -10px 30px rgba(0, 0, 0, 0.7)",
  };

  return (
    <div
      className="terminal-window-instance"
      style={layout.isDetached ? detachedStyle : dockedStyle}
    >
      {/* Top Drag/Resize Handle */}
      {!layout.isDetached && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-valuenow={layout.height}
          tabIndex={0}
          className="terminal-resize-handle"
          onMouseDown={handleDockResizeMouseDown}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              updateLayout((l) => ({
                ...l,
                height: Math.min(window.innerHeight * 0.85, l.height + 30),
              }));
            }
            if (e.key === "ArrowDown") {
              updateLayout((l) => ({ ...l, height: Math.max(140, l.height - 30) }));
            }
          }}
          title="Drag up or down to resize terminal height"
        />
      )}

      <div
        className="terminal-header"
        onMouseDown={layout.isDetached ? handleDragMouseDown : undefined}
        style={{ cursor: layout.isDetached ? "move" : "default" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            userSelect: "none",
            flex: 1,
          }}
        >
          {layout.isDetached ? <Move size={14} style={{ opacity: 0.8, color: "#38bdf8" }} /> : null}
          <span style={{ fontSize: "0.85rem", fontWeight: 600, fontFamily: "var(--font-mono)" }}>
            Serial Terminal — {node.name}
          </span>
          {layout.isDetached && (
            <span
              style={{
                fontSize: "0.7rem",
                padding: "2px 6px",
                background: "rgba(56, 189, 248, 0.2)",
                color: "#38bdf8",
                borderRadius: "4px",
                fontWeight: 600,
              }}
            >
              Detached
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {/* Attach / Detach Button */}
          <button
            type="button"
            className="btn"
            style={{ padding: "2px 6px" }}
            onClick={toggleAttachDetach}
            title={
              layout.isDetached
                ? "Attach Terminal to Bottom Dock"
                : "Detach Terminal to Floating Window"
            }
            aria-label={
              layout.isDetached
                ? "Attach Terminal to Bottom Dock"
                : "Detach Terminal to Floating Window"
            }
          >
            {layout.isDetached ? <Anchor size={14} /> : <ExternalLink size={14} />}
          </button>

          {!layout.isDetached && (
            <button
              type="button"
              className="btn"
              style={{ padding: "2px 6px" }}
              onClick={() => updateLayout((l) => ({ ...l, height: l.height > 450 ? 250 : 520 }))}
              title="Toggle Expanded Height"
              aria-label="Toggle Expanded Height"
            >
              {layout.height > 450 ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}

          <button
            type="button"
            className="btn"
            style={{ padding: "2px 6px" }}
            onClick={onClose}
            title="Close Terminal Window"
            aria-label="Close Terminal Window"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="terminal-body" ref={terminalRef} style={{ flex: 1, position: "relative" }} />

      {/* Floating Corner Resize Handle when Detached */}
      {layout.isDetached && (
        <div
          onMouseDown={handleCornerResizeMouseDown}
          style={{
            position: "absolute",
            bottom: "2px",
            right: "2px",
            width: "12px",
            height: "12px",
            cursor: "se-resize",
            background: "linear-gradient(135deg, transparent 50%, #38bdf8 50%)",
            borderRadius: "0 0 6px 0",
            opacity: 0.7,
          }}
          title="Drag to resize window width and height"
        />
      )}
    </div>
  );
}
