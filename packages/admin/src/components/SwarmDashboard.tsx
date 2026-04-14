import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import { marked } from 'marked';
import { api } from '../lib/api.js';
import { launchFAFOAssistant } from '../lib/agent-constants.js';
import { selectedAppId } from '../lib/state.js';
import { openSession } from '../lib/sessions.js';
import { toggleCompanion } from '../lib/companion-state.js';

interface SwarmSummary {
  id: string;
  name: string;
  mode: string;
  promptFile: string | null;
  fitnessCommand: string | null;
  targetArtifact: string | null;
  artifactType: string;
  fitnessMetric: string;
  fanOut: number;
  generationCount: number;
  status: string;
  appId: string | null;
  harnessConfigId: string | null;
  knowledgeContent: string;
  isolation: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SwarmPath {
  id: string;
  swarmId: string;
  name: string;
  prompt: string;
  files: string | null;
  focusLines: string | null;
  cropRegion: string | null;
  fitnessMetric: string | null;
  fitnessCommand: string | null;
  worktreePort: number | null;
  worktreeBranch: string | null;
  worktreePath: string | null;
  status: string;
  order: number;
}

interface SwarmRun {
  id: string;
  status: string;
  generation: number | null;
  pathId: string | null;
  fitnessScore: number | null;
  fitnessDetail: string | null;
  survived: boolean | null;
  parentRunId: string | null;
  knobs: string | null;
  currentIteration: number;
  maxIterations: number;
  iterations: any[];
  screenshots: any[];
  isActive: boolean;
  agentLabel: string | null;
  finalArtifactPath: string | null;
  sessionId: string | null;
  createdAt: string;
}

interface SwarmDetail extends SwarmSummary {
  generations: Record<string, SwarmRun[]>;
  paths: SwarmPath[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#888',
  running: '#4CAF50',
  paused: '#FF9800',
  completed: '#2196F3',
  failed: '#f44336',
  stopped: '#9E9E9E',
};

const ARTIFACT_TYPES = ['screenshot', 'svg', 'script', 'diff'] as const;
const FITNESS_PRESETS = [
  { label: 'Image diff', value: 'imgdiff' },
  { label: 'Test pass rate', value: 'test-pass' },
  { label: 'Custom shell', value: '' },
];

export function SwarmDashboard() {
  const [swarms, setSwarms] = useState<SwarmSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SwarmDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledge, setKnowledge] = useState('');
  const [loading, setLoading] = useState(false);

  const loadSwarms = useCallback(async () => {
    try {
      const list = await api.getSwarms(selectedAppId.value || undefined);
      setSwarms(list);
    } catch { /* ignore */ }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setLoading(true);
      const d = await api.getSwarm(id);
      setDetail(d);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    loadSwarms();
  }, [selectedAppId.value]);

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
      const timer = setInterval(() => loadDetail(selectedId), 5000);
      return () => clearInterval(timer);
    }
  }, [selectedId]);

  useEffect(() => {
    if (knowledgeOpen && selectedId) {
      api.getSwarmKnowledge(selectedId).then(r => setKnowledge(r.knowledge)).catch(() => {});
    }
  }, [knowledgeOpen, selectedId]);

  if (selectedId && detail) {
    return <SwarmDetailView
      detail={detail}
      knowledgeOpen={knowledgeOpen}
      knowledge={knowledge}
      onBack={() => { setSelectedId(null); setDetail(null); }}
      onToggleKnowledge={() => setKnowledgeOpen(!knowledgeOpen)}
      onRefresh={() => loadDetail(selectedId)}
      onNextGen={async (data) => {
        await api.triggerNextGeneration(selectedId, data);
        loadDetail(selectedId);
      }}
    />;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>FAFO Swarms</h3>
        <button class="btn btn-sm" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancel' : '+ New Swarm'}
        </button>
      </div>

      {showCreate && <CreateSwarmForm onCreated={(s) => {
        setSwarms([s, ...swarms]);
        setShowCreate(false);
        setSelectedId(s.id);
      }} />}

      {swarms.length === 0 && !showCreate && (
        <div style={{ color: '#888', fontSize: 13, textAlign: 'center', padding: 32 }}>
          No swarms yet. Create one to start a FAFO evolutionary search.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {swarms.map(s => (
          <div
            key={s.id}
            class="session-card"
            style={{ cursor: 'pointer' }}
            onClick={() => setSelectedId(s.id)}
          >
            <div class="session-card-main">
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: STATUS_COLORS[s.status] || '#888',
                flexShrink: 0,
              }} />
              <span class="session-card-label" style={{ fontWeight: 600 }}>
                {s.name}
              </span>
              {s.mode === 'multi-path' && (
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                  background: '#7c3aed', color: '#fff', letterSpacing: '0.5px',
                }}>
                  MULTI-PATH
                </span>
              )}
              <span style={{ fontSize: 11, color: '#888' }}>
                {s.artifactType}
              </span>
              <span style={{ fontSize: 11, color: '#888' }}>
                {s.generationCount} gen{s.generationCount !== 1 ? 's' : ''}
              </span>
              <span class={`session-card-status ${s.status}`}>{s.status}</span>
              <button
                class="btn btn-sm"
                style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', background: '#7c3aed', color: '#fff', flexShrink: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  const ctx = `The user wants help with swarm "${s.name}" (ID: ${s.id}).
Mode: ${s.mode} | Artifact: ${s.artifactType} | Fitness: ${s.fitnessCommand || 'none'} | Metric: ${s.fitnessMetric}
Target: ${s.targetArtifact || 'none'} | Generations: ${s.generationCount} | Status: ${s.status}
Fan-out: ${s.fanOut} | Harness: ${s.harnessConfigId || 'none'}

Start by fetching the full swarm detail: curl -s $AUTH 'http://localhost:3001/api/v1/admin/wiggum/swarms/${s.id}'
Then ask the user what they need help with.`;
                  launchFAFOAssistant({ appId: selectedAppId.value, context: ctx }).catch(() => {});
                }}
                title="Launch assistant for this swarm"
              >
                Assist
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Create Swarm Form ────────────────────────────────

function CreateSwarmForm({ onCreated }: { onCreated: (s: SwarmSummary) => void }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'single' | 'multi-path'>('single');
  const [artifactType, setArtifactType] = useState('screenshot');
  const [fitnessCommand, setFitnessCommand] = useState('');
  const [fitnessPreset, setFitnessPreset] = useState('imgdiff');
  const [fitnessMetric, setFitnessMetric] = useState('pixel-diff');
  const [targetArtifact, setTargetArtifact] = useState('');
  const [fanOut, setFanOut] = useState(6);
  const [isolationMethod, setIsolationMethod] = useState('worktree');
  const [basePort, setBasePort] = useState(5200);
  const [saving, setSaving] = useState(false);

  return (
    <div style={{
      background: 'var(--pw-bg-surface)',
      borderRadius: 8,
      padding: 16,
      marginBottom: 12,
      border: '1px solid var(--pw-border)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          type="text"
          placeholder="Swarm name (e.g. harness-combiner-svg)"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid var(--pw-border)', background: 'var(--pw-bg-raised)', color: 'var(--pw-text)' }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={mode}
            onChange={(e) => setMode((e.target as HTMLSelectElement).value as any)}
            style={{ width: 120, padding: '6px 10px', borderRadius: 4, border: '1px solid var(--pw-border)', background: 'var(--pw-bg-raised)', color: 'var(--pw-text)' }}
          >
            <option value="single">Single</option>
            <option value="multi-path">Multi-path</option>
          </select>
          <select
            value={artifactType}
            onChange={(e) => setArtifactType((e.target as HTMLSelectElement).value)}
            style={{ flex: 1, padding: '6px 10px', borderRadius: 4, border: '1px solid var(--pw-border)', background: 'var(--pw-bg-raised)', color: 'var(--pw-text)' }}
          >
            {ARTIFACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={fitnessPreset}
            onChange={(e) => {
              setFitnessPreset((e.target as HTMLSelectElement).value);
              if ((e.target as HTMLSelectElement).value) setFitnessCommand((e.target as HTMLSelectElement).value);
            }}
            style={{ flex: 1, padding: '6px 10px', borderRadius: 4, border: '1px solid var(--pw-border)', background: 'var(--pw-bg-raised)', color: 'var(--pw-text)' }}
          >
            {FITNESS_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <input
            type="number"
            value={fanOut}
            min={1}
            max={20}
            onInput={(e) => setFanOut(parseInt((e.target as HTMLInputElement).value) || 6)}
            style={{ width: 60, padding: '6px 10px', borderRadius: 4, border: '1px solid var(--pw-border)', background: 'var(--pw-bg-raised)', color: 'var(--pw-text)', textAlign: 'center' }}
            title="Fan-out (parallel runs per generation)"
          />
        </div>
        {mode === 'multi-path' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={isolationMethod}
              onChange={(e) => setIsolationMethod((e.target as HTMLSelectElement).value)}
              style={{ flex: 1, padding: '6px 10px', borderRadius: 4, border: '1px solid var(--pw-border)', background: 'var(--pw-bg-raised)', color: 'var(--pw-text)' }}
            >
              <option value="worktree">Worktree isolation</option>
              <option value="none">No isolation</option>
            </select>
            <select
              value={fitnessMetric}
              onChange={(e) => setFitnessMetric((e.target as HTMLSelectElement).value)}
              style={{ flex: 1, padding: '6px 10px', borderRadius: 4, border: '1px solid var(--pw-border)', background: 'var(--pw-bg-raised)', color: 'var(--pw-text)' }}
            >
              <option value="pixel-diff">Pixel diff</option>
              <option value="ssim">SSIM</option>
              <option value="edge-diff">Edge diff</option>
              <option value="custom">Custom</option>
            </select>
            <input
              type="number"
              value={basePort}
              onInput={(e) => setBasePort(parseInt((e.target as HTMLInputElement).value) || 5200)}
              style={{ width: 80, padding: '6px 10px', borderRadius: 4, border: '1px solid var(--pw-border)', background: 'var(--pw-bg-raised)', color: 'var(--pw-text)', textAlign: 'center' }}
              title="Base port for worktree vite servers"
            />
          </div>
        )}
        <input
          type="text"
          placeholder="Target artifact path (e.g. /tmp/target.png)"
          value={targetArtifact}
          onInput={(e) => setTargetArtifact((e.target as HTMLInputElement).value)}
          style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid var(--pw-border)', background: 'var(--pw-bg-raised)', color: 'var(--pw-text)' }}
        />
        {fitnessPreset === '' && (
          <input
            type="text"
            placeholder="Custom fitness command (stdin=artifact, stdout=float)"
            value={fitnessCommand}
            onInput={(e) => setFitnessCommand((e.target as HTMLInputElement).value)}
            style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid var(--pw-border)', background: 'var(--pw-bg-raised)', color: 'var(--pw-text)' }}
          />
        )}
        <button
          class="btn btn-sm"
          disabled={!name || saving}
          onClick={async () => {
            setSaving(true);
            try {
              const s = await api.createSwarm({
                name,
                mode,
                artifactType,
                fitnessCommand: fitnessPreset || fitnessCommand,
                fitnessMetric,
                targetArtifact: targetArtifact || null,
                fanOut,
                appId: selectedAppId.value || null,
                ...(mode === 'multi-path' ? {
                  isolation: { method: isolationMethod, basePort },
                } : {}),
              });
              onCreated(s);
            } catch { /* ignore */ }
            finally { setSaving(false); }
          }}
        >
          {saving ? 'Creating...' : 'Create Swarm'}
        </button>
      </div>
    </div>
  );
}

// ─── Swarm Detail View (Generation Strip Layout) ──────

function SwarmDetailView({
  detail,
  knowledgeOpen,
  knowledge,
  onBack,
  onToggleKnowledge,
  onRefresh,
  onNextGen,
}: {
  detail: SwarmDetail;
  knowledgeOpen: boolean;
  knowledge: string;
  onBack: () => void;
  onToggleKnowledge: () => void;
  onRefresh: () => void;
  onNextGen: (data: Record<string, unknown>) => Promise<void>;
}) {
  const genKeys = Object.keys(detail.generations)
    .map(Number)
    .sort((a, b) => a - b);

  // Compute per-generation stats
  const genStats = genKeys.map(gen => {
    const runs = detail.generations[gen] || [];
    const scores = runs.map(r => r.fitnessScore).filter((s): s is number => s != null);
    return {
      gen,
      runs,
      best: scores.length ? Math.min(...scores) : null,
      median: scores.length ? scores.sort((a, b) => a - b)[Math.floor(scores.length / 2)] : null,
      count: runs.length,
    };
  });

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button class="btn btn-sm" onClick={onBack}>&larr; Back</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>FAFO: {detail.name}</div>
            <div style={{ fontSize: 12, color: '#888' }}>
              fitness: {detail.fitnessCommand || 'none'}
              {detail.targetArtifact && ` | target: ${detail.targetArtifact}`}
            </div>
          </div>
          <button
            class="btn btn-sm"
            style={{ background: '#7c3aed', color: '#fff' }}
            onClick={() => {
              const genKeys = Object.keys(detail.generations);
              const totalRuns = genKeys.reduce((sum, k) => sum + detail.generations[k].length, 0);
              const scores = genKeys.flatMap(k => detail.generations[k].map(r => r.fitnessScore).filter((s): s is number => s != null));
              const ctx = `The user is viewing swarm "${detail.name}" (ID: ${detail.id}).
Mode: ${detail.mode} | Artifact: ${detail.artifactType} | Fitness: ${detail.fitnessCommand || 'none'} | Metric: ${detail.fitnessMetric}
Target: ${detail.targetArtifact || 'none'} | Generations: ${detail.generationCount} | Fan-out: ${detail.fanOut} | Status: ${detail.status}
Total runs: ${totalRuns} | Scores: ${scores.length > 0 ? `best=${Math.min(...scores).toFixed(3)}, worst=${Math.max(...scores).toFixed(3)}` : 'none yet'}
${detail.paths?.length ? `Paths: ${detail.paths.map(p => p.name).join(', ')}` : ''}
${detail.knowledgeContent ? `Knowledge file has ${detail.knowledgeContent.length} chars accumulated.` : 'Knowledge file is empty.'}

Fetch full detail: curl -s $AUTH 'http://localhost:3001/api/v1/admin/wiggum/swarms/${detail.id}'
Help the user with: monitoring progress, analyzing scores, triggering next generation, adjusting config, or troubleshooting.`;
              launchFAFOAssistant({ appId: selectedAppId.value, context: ctx }).catch(() => {});
            }}
          >
            Assist
          </button>
          <button class="btn btn-sm" onClick={onToggleKnowledge}>
            {knowledgeOpen ? 'Hide' : 'Show'} Knowledge
          </button>
          <button class="btn btn-sm" onClick={onRefresh}>Refresh</button>
        </div>

        {/* Paths panel (multi-path mode) */}
        {detail.mode === 'multi-path' && detail.paths && detail.paths.length > 0 && (
          <div style={{
            display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12,
            padding: 10, background: 'var(--pw-bg-surface)', borderRadius: 8,
            border: '1px solid var(--pw-border)',
          }}>
            <div style={{ width: '100%', fontSize: 11, fontWeight: 600, color: 'var(--pw-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Paths ({detail.paths.length})
            </div>
            {detail.paths.sort((a, b) => a.order - b.order).map(path => {
              const pathRuns = Object.values(detail.generations).flat().filter((r: SwarmRun) => r.pathId === path.id);
              const activeCount = pathRuns.filter(r => r.status === 'running').length;
              const doneCount = pathRuns.filter(r => r.status === 'completed').length;
              return (
                <div key={path.id} style={{
                  background: 'var(--pw-bg-raised)', borderRadius: 6, padding: '6px 10px',
                  border: `1px solid ${path.status === 'completed' ? 'rgba(76,175,80,0.4)' : 'var(--pw-border)'}`,
                  minWidth: 140,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[path.status] || '#888' }} />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{path.name}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--pw-text-faint)' }}>
                    {path.worktreePort && <span>:{path.worktreePort} </span>}
                    {path.focusLines && <span>L{path.focusLines} </span>}
                    {activeCount > 0 && <span style={{ color: '#4CAF50' }}>{activeCount} running </span>}
                    {doneCount > 0 && <span>{doneCount} done</span>}
                  </div>
                  {path.prompt && (
                    <div style={{ fontSize: 9, color: 'var(--pw-text-faint)', marginTop: 4, maxHeight: 40, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {path.prompt.slice(0, 100)}{path.prompt.length > 100 ? '...' : ''}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Generation strips */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {genStats.length === 0 && (
            <div style={{ color: '#888', fontSize: 13, textAlign: 'center', padding: 32 }}>
              No generations yet. Create runs or trigger the first generation.
            </div>
          )}

          {genStats.map(({ gen, runs, best, median }) => {
            // Find path name for each run
            const pathMap = new Map(detail.paths.map(p => [p.id, p.name]));
            return (
            <div key={gen} style={{
              background: 'var(--pw-bg-surface)',
              borderRadius: 8,
              border: '1px solid var(--pw-border)',
              padding: '10px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13, minWidth: 50 }}>Gen {gen}</span>
                <span style={{ fontSize: 11, color: '#888' }}>
                  {runs.length} runs
                </span>
                {best != null && (
                  <span style={{ fontSize: 11, color: '#4CAF50' }}>
                    best: {best.toFixed(3)}
                  </span>
                )}
                {median != null && (
                  <span style={{ fontSize: 11, color: '#888' }}>
                    median: {median.toFixed(3)}
                  </span>
                )}
                {/* Show path name for each run in multi-path mode */}
                {detail.mode === 'multi-path' && runs.length > 0 && (
                  <span style={{ fontSize: 10, color: 'var(--pw-text-faint)' }}>
                    [{runs.map(r => pathMap.get(r.pathId || '') || '?').join(', ')}]
                  </span>
                )}
              </div>

              {/* Run cells */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {runs.map(run => (
                  <RunCell key={run.id} run={run} detail={detail} />
                ))}
              </div>
            </div>
            );
          })}

          {/* Next generation button */}
          <div style={{ display: 'flex', gap: 8, padding: '8px 0' }}>
            <button
              class="btn btn-sm"
              onClick={() => onNextGen({})}
            >
              Trigger Next Generation
            </button>
          </div>
        </div>
      </div>

      {/* Knowledge panel */}
      {knowledgeOpen && (
        <div style={{
          width: 350,
          flexShrink: 0,
          background: 'var(--pw-bg-surface)',
          borderRadius: 8,
          border: '1px solid var(--pw-border)',
          padding: 12,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
            Knowledge File
          </div>
          {knowledge ? (
            <div
              class="sm-result-markdown"
              style={{ flex: 1, fontSize: 12, overflowY: 'auto' }}
              dangerouslySetInnerHTML={{ __html: marked.parse(knowledge) as string }}
            />
          ) : (
            <div style={{ flex: 1, fontSize: 11, color: 'var(--pw-text-muted)' }}>
              (empty — populated after first generation completes)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Run Cell (single child in generation strip) ──────

function RunCell({ run, detail }: { run: SwarmRun; detail: SwarmDetail }) {
  const [expanded, setExpanded] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const isDimmed = run.survived === false;
  const isSurvivor = run.survived === true;

  const submitFeedback = async (rating: number) => {
    try {
      await api.submitSwarmFeedback(detail.id, {
        runId: run.id,
        generation: run.generation ?? undefined,
        rating,
        annotation: feedbackText || undefined,
      });
      setFeedbackRating(rating);
      setShowFeedback(false);
      setFeedbackText('');
    } catch { /* ignore */ }
  };

  return (
    <div
      style={{
        width: expanded ? '100%' : 80,
        minHeight: 60,
        background: isDimmed ? 'rgba(100,100,100,0.15)' : isSurvivor ? 'rgba(76,175,80,0.1)' : 'var(--pw-bg-raised)',
        borderRadius: 6,
        border: `1px solid ${isSurvivor ? 'rgba(76,175,80,0.4)' : isDimmed ? 'rgba(100,100,100,0.3)' : 'var(--pw-border)'}`,
        padding: 6,
        cursor: 'pointer',
        opacity: isDimmed ? 0.5 : 1,
        transition: 'all 0.2s',
      }}
      onClick={() => setExpanded(!expanded)}
      title={`${run.id.slice(-8)} | ${run.status} | score: ${run.fitnessScore ?? '?'}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: STATUS_COLORS[run.status] || '#888',
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--pw-text-faint)' }}>
          {run.id.slice(-6)}
        </span>
        {isSurvivor && <span style={{ fontSize: 8, color: '#4CAF50' }}>&#x2713;</span>}
      </div>

      {run.fitnessScore != null && (
        <div
          style={{ fontSize: 14, fontWeight: 700, textAlign: 'center', color: 'var(--pw-text)' }}
          title={(() => {
            try {
              const d = run.fitnessDetail ? JSON.parse(run.fitnessDetail) : null;
              if (d) return `SSIM: ${d.ssim?.toFixed(3)} | Edge: ${d.edge_iou?.toFixed(3)} | Hist: ${d.hist_corr?.toFixed(3)} | Pixel: ${d.pixel_mean?.toFixed(1)}`;
            } catch { /* ignore */ }
            return `composite: ${run.fitnessScore.toFixed(3)}`;
          })()}
        >
          {run.fitnessScore.toFixed(3)}
        </div>
      )}

      <div style={{ fontSize: 9, color: 'var(--pw-text-faint)', textAlign: 'center' }}>
        {run.currentIteration}/{run.maxIterations}
      </div>

      {/* Expanded: show filmstrip + session links */}
      {expanded && (
        <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {/* Session links */}
          {(() => {
            // Collect all session IDs: direct sessionId + iteration sessionIds
            const sids: string[] = [];
            if (run.sessionId) sids.push(run.sessionId);
            for (const iter of run.iterations) {
              if (iter.sessionId && !sids.includes(iter.sessionId)) sids.push(iter.sessionId);
            }
            if (sids.length === 0) return null;
            return (
              <div style={{ width: '100%', display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                {sids.map((sid, i) => (
                  <div key={sid} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <a
                      href={`#/sessions/${sid}`}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); openSession(sid); }}
                      style={{ fontSize: 10, color: '#64B5F6', textDecoration: 'none', fontFamily: 'monospace' }}
                      title="Open session terminal"
                    >
                      {sids.length > 1 ? `#${i}` : ''} {sid.slice(-8)}
                    </a>
                    <button
                      onClick={(e) => { e.stopPropagation(); openSession(sid); toggleCompanion(sid, 'jsonl'); }}
                      style={{
                        fontSize: 9, padding: '1px 4px', background: 'rgba(100,181,246,0.15)',
                        border: '1px solid rgba(100,181,246,0.3)', borderRadius: 3,
                        color: '#64B5F6', cursor: 'pointer',
                      }}
                      title="Open JSONL structured view"
                    >
                      JSONL
                    </button>
                  </div>
                ))}
              </div>
            );
          })()}
          {run.screenshots.map((ss: any) => (
            <img
              key={ss.id}
              src={ss.url || `/api/v1/admin/wiggum/${run.id}/screenshots/${ss.id}`}
              style={{
                width: 120,
                height: 80,
                objectFit: 'cover',
                borderRadius: 4,
                border: '1px solid var(--pw-border)',
              }}
              loading="lazy"
              title={ss.filename || ss.id}
            />
          ))}
          {run.screenshots.length === 0 && (
            <span style={{ fontSize: 10, color: '#888' }}>No screenshots</span>
          )}
          {run.knobs && (
            <div style={{ fontSize: 9, color: '#888', width: '100%' }}>
              knobs: {run.knobs}
            </div>
          )}

          {/* Feedback controls */}
          <div style={{ width: '100%', display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, borderTop: '1px solid var(--pw-border)', paddingTop: 6 }}>
            <button
              onClick={(e) => { e.stopPropagation(); submitFeedback(1); }}
              style={{
                fontSize: 14, cursor: 'pointer', padding: '2px 8px', borderRadius: 4,
                background: feedbackRating === 1 ? 'rgba(76,175,80,0.3)' : 'transparent',
                border: '1px solid rgba(76,175,80,0.4)', color: '#4CAF50',
              }}
              title="Good result"
            >
              +
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); submitFeedback(-1); }}
              style={{
                fontSize: 14, cursor: 'pointer', padding: '2px 8px', borderRadius: 4,
                background: feedbackRating === -1 ? 'rgba(244,67,54,0.3)' : 'transparent',
                border: '1px solid rgba(244,67,54,0.4)', color: '#f44336',
              }}
              title="Bad result"
            >
              -
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setShowFeedback(!showFeedback); }}
              style={{
                fontSize: 10, cursor: 'pointer', padding: '2px 8px', borderRadius: 4,
                background: 'transparent', border: '1px solid var(--pw-border)', color: 'var(--pw-text-muted)',
              }}
            >
              Annotate
            </button>
            {feedbackRating != null && (
              <span style={{ fontSize: 10, color: feedbackRating === 1 ? '#4CAF50' : '#f44336' }}>
                {feedbackRating === 1 ? 'Marked good' : 'Marked bad'}
              </span>
            )}

            {/* Live preview link */}
            {(() => {
              try {
                const knobs = run.knobs ? JSON.parse(run.knobs) : null;
                if (knobs?.port) {
                  return (
                    <a
                      href={`http://localhost:${knobs.port}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{ fontSize: 10, color: '#64B5F6', marginLeft: 'auto' }}
                    >
                      Live Preview :{knobs.port}
                    </a>
                  );
                }
              } catch { /* ignore */ }
              return null;
            })()}
          </div>

          {showFeedback && (
            <div style={{ width: '100%', marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
              <textarea
                value={feedbackText}
                onInput={(e) => setFeedbackText((e.target as HTMLTextAreaElement).value)}
                placeholder="What's wrong or right about this result? (e.g., 'horn curves too wide', 'port color is correct')"
                style={{
                  width: '100%', minHeight: 50, padding: 6, fontSize: 11, borderRadius: 4,
                  border: '1px solid var(--pw-border)', background: 'var(--pw-bg-raised)', color: 'var(--pw-text)',
                  resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button
                  class="btn btn-sm"
                  style={{ fontSize: 10, background: '#4CAF50', color: '#fff' }}
                  onClick={() => submitFeedback(1)}
                >
                  Submit as Good
                </button>
                <button
                  class="btn btn-sm"
                  style={{ fontSize: 10, background: '#f44336', color: '#fff' }}
                  onClick={() => submitFeedback(-1)}
                >
                  Submit as Bad
                </button>
                <button
                  class="btn btn-sm"
                  style={{ fontSize: 10 }}
                  onClick={() => submitFeedback(0)}
                >
                  Submit Neutral
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
