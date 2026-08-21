import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

export function TerminalWindow({ node, onClose, wsClient }) {
  const terminalRef = useRef(null);
  const xtermInstance = useRef(null);

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

    term.open(terminalRef.current);
    fitAddon.fit();

    term.writeln(`\x1b[1;34mConnected to serial console for ${node.name}...\x1b[0m\r\n`);

    term.onData((data) => {
      if (wsClient) {
        wsClient.sendTerminalInput("default", node.id, data);
      }
    });

    xtermInstance.current = term;

    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
    };
  }, [node, wsClient]);

  return (
    <div className="terminal-modal">
      <div className="terminal-header">
        <span style={{ fontSize: "0.85rem", fontWeight: 600, fontFamily: "var(--font-mono)" }}>
          Serial Terminal — {node.name}
        </span>
        <button type="button" className="btn" style={{ padding: "2px 6px" }} onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="terminal-body" ref={terminalRef} />
    </div>
  );
}
