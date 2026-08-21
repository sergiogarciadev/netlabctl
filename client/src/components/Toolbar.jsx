import React from 'react';
import { Play, Square, Plus, Network, Terminal as TerminalIcon } from 'lucide-react';

export function Toolbar({
  projectName,
  isRunning,
  onStart,
  onStop,
  onAddDevice,
  selectedNode,
  onOpenTerminal,
}) {
  return (
    <div className="toolbar">
      <div className="toolbar-brand">
        <Network size={22} className="text-blue-500" />
        <span>netlabctl</span>
        <span style={{ fontSize: '0.8rem', opacity: 0.6, marginLeft: '6px' }}>
          / {projectName || 'Untitled Lab'}
        </span>
      </div>

      <div className="toolbar-controls">
        {!isRunning ? (
          <button className="btn btn-success" onClick={onStart}>
            <Play size={16} /> Start Lab
          </button>
        ) : (
          <button className="btn btn-danger" onClick={onStop}>
            <Square size={16} /> Stop Lab
          </button>
        )}

        <button className="btn btn-primary" onClick={onAddDevice}>
          <Plus size={16} /> Add Device
        </button>

        {selectedNode && (
          <button className="btn" onClick={() => onOpenTerminal(selectedNode)}>
            <TerminalIcon size={16} /> Serial Console ({selectedNode.name})
          </button>
        )}
      </div>
    </div>
  );
}
