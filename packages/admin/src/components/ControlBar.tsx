import { signal } from '@preact/signals';
import { api } from '../lib/api.js';
import { openSession, loadAllSessions, allSessions } from '../lib/sessions.js';
import { selectedAppId, applications } from '../lib/state.js';

interface ActionRun {
  sessionId: string;
}

const actionRuns = signal<Record<string, ActionRun>>({});

export function ControlBar() {
  const appId = selectedAppId.value;
  if (!appId || appId === '__unlinked__') return null;

  const app = applications.value.find((a: any) => a.id === appId);
  if (!app?.controlActions?.length) return null;

  const sessions = allSessions.value;
  const runs = actionRuns.value;

  return (
    <div class="control-bar">
      <span class="control-bar-label">Controls</span>
      {app.controlActions.map((action: any) => {
        const run = runs[action.id];
        const session = run ? sessions.find((s: any) => s.id === run.sessionId) : null;
        const isRunning = session && (session.status === 'running' || session.status === 'pending');
        const isDone = session?.status === 'completed';
        const isFailed = session && (session.status === 'failed' || session.status === 'killed');

        return (
          <button
            key={action.id}
            class={`control-action-btn${isRunning ? ' running' : ''}${isDone ? ' success' : ''}${isFailed ? ' error' : ''}`}
            onClick={() => runAction(appId, action.id)}
            disabled={!!isRunning}
            title={action.command}
          >
            {action.icon && <span class="control-action-icon">{action.icon}</span>}
            <span>{action.label}</span>
            {isRunning && <span class="control-action-spinner" />}
          </button>
        );
      })}
    </div>
  );
}

async function runAction(appId: string, actionId: string) {
  try {
    const { sessionId } = await api.runControlAction(appId, actionId);
    actionRuns.value = { ...actionRuns.value, [actionId]: { sessionId } };
    openSession(sessionId);
    loadAllSessions();
  } catch (err: any) {
    console.error('Control action failed:', err.message);
  }
}
