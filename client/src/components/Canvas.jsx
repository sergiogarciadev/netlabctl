import { useEffect, useRef } from "react";

export function Canvas({ _nodes, _wires, _onSelectNode }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    // Placeholder Fabric.js Canvas mount for Phase 1
  }, []);

  return (
    <div className="canvas-wrapper">
      <canvas ref={canvasRef} id="netlab-canvas" />
    </div>
  );
}
