import { useState } from 'preact/hooks';
import { AgentTerminal } from './AgentTerminal.js';
import { StructuredView } from './StructuredView.js';

type ViewMode = 'terminal' | 'structured' | 'split';

interface Props {
  sessionId: string;
  isActive?: boolean;
  onExit?: (exitCode: number) => void;
}

export function SessionViewToggle({ sessionId, isActive, onExit }: Props) {
  const [mode, setMode] = useState<ViewMode>('terminal');

  return (
    <div class="session-view-toggle" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div class="view-mode-bar">
        <button
          class={`view-mode-btn ${mode === 'terminal' ? 'active' : ''}`}
          onClick={() => setMode('terminal')}
          title="Terminal view"
        >
          Term
        </button>
        <button
          class={`view-mode-btn ${mode === 'structured' ? 'active' : ''}`}
          onClick={() => setMode('structured')}
          title="Structured view"
        >
          Struct
        </button>
        <button
          class={`view-mode-btn ${mode === 'split' ? 'active' : ''}`}
          onClick={() => setMode('split')}
          title="Split view"
        >
          Split
        </button>
      </div>
      <div class="view-content" style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {mode === 'terminal' && (
          <div style={{ width: '100%', height: '100%' }}>
            <AgentTerminal sessionId={sessionId} isActive={isActive} onExit={onExit} />
          </div>
        )}
        {mode === 'structured' && (
          <div style={{ width: '100%', height: '100%' }}>
            <StructuredView sessionId={sessionId} isActive={isActive} />
          </div>
        )}
        {mode === 'split' && (
          <>
            <div style={{ width: '55%', height: '100%', borderRight: '1px solid #334155', overflow: 'hidden' }}>
              <StructuredView sessionId={sessionId} isActive={isActive} />
            </div>
            <div style={{ width: '45%', height: '100%', overflow: 'hidden' }}>
              <AgentTerminal sessionId={sessionId} isActive={isActive} onExit={onExit} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
