import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Maximize2, Minimize2, Move, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

export function TerminalWindow({ projectId, node, onClose }) {
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const [height, setHeight] = useState(320);
  const isResizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(320);

  const handleMouseDown = (e) => {
    isResizingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = height;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = useCallback((e) => {
    if (!isResizingRef.current) return;
    const deltaY = startYRef.current - e.clientY;
    const newHeight = Math.max(
      140,
      Math.min(window.innerHeight * 0.85, startHeightRef.current + deltaY),
    );
    setHeight(newHeight);
    if (fitAddonRef.current) {
      fitAddonRef.current.fit();
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isResizingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    if (fitAddonRef.current) {
      fitAddonRef.current.fit();
    }
  }, [handleMouseMove]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: "#090d16",
        foreground: "#f8fafc",
        cursor: "#3b82f6",
      },
      fontFamily: "JetBrains Mono, monospace",
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

    console.log("[NETLAB-TERMINAL-DEBUG] Opening terminal WebSocket connection:", wsUrl);
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      term.writeln(`\x1b[1;32mConnected to serial console for ${node.name}...\x1b[0m\r\n`);
    };

    socket.onmessage = (event) => {
      term.write(event.data);
    };

    socket.onerror = (err) => {
      console.error("[NETLAB-TERMINAL-DEBUG] Terminal WebSocket error:", err);
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
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      socket.close();
      term.dispose();
    };
  }, [projectId, node, handleMouseMove, handleMouseUp]);

  return (
    <div className="terminal-modal" style={{ height: `${height}px` }}>
      {/* Top Drag Resize Handle */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-valuenow={height}
        tabIndex={0}
        className="terminal-resize-handle"
        onMouseDown={handleMouseDown}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") setHeight((h) => Math.min(window.innerHeight * 0.85, h + 30));
          if (e.key === "ArrowDown") setHeight((h) => Math.max(140, h - 30));
        }}
        title="Drag up or down to resize terminal height"
      />

      <div className="terminal-header">
        <div
          role="button"
          tabIndex={0}
          onMouseDown={handleMouseDown}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setHeight((h) => (h > 450 ? 250 : 520));
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            cursor: "ns-resize",
            userSelect: "none",
            flex: 1,
          }}
        >
          <Move size={14} style={{ opacity: 0.6 }} />
          <span style={{ fontSize: "0.85rem", fontWeight: 600, fontFamily: "var(--font-mono)" }}>
            Serial Terminal — {node.name}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            type="button"
            className="btn"
            style={{ padding: "2px 6px" }}
            onClick={() => setHeight(height > 450 ? 250 : 520)}
            title="Toggle Expanded Height"
          >
            {height > 450 ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button type="button" className="btn" style={{ padding: "2px 6px" }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="terminal-body" ref={terminalRef} />
    </div>
  );
}
