import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulidx';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { db, schema } from '../db/index.js';
import {
  startWiggumRun,
  pauseWiggumRun,
  resumeWiggumRun,
  stopWiggumRun,
  getActiveRunIds,
} from '../wiggum-controller.js';
import { getLauncher, listLaunchers, sendAndWait } from '../launcher-registry.js';
import type { ExecInHarness, ExecInHarnessResult } from '@prompt-widget/shared';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const DEFAULT_PROMPT_DIR = '/data/altiumingest/viewer';

const app = new Hono();

function serializeRun(row: typeof schema.wiggumRuns.$inferSelect) {
  return {
    ...row,
    iterations: JSON.parse(row.iterations || '[]'),
  };
}

function findLauncherForHarness(config: typeof schema.harnessConfigs.$inferSelect) {
  let launcher = config.launcherId ? getLauncher(config.launcherId) : undefined;
  if (!launcher && config.machineId) {
    const all = listLaunchers();
    launcher = all.find(l => l.machineId === config.machineId && l.ws?.readyState === 1);
  }
  return launcher;
}

async function execInHarness(
  launcherId: string,
  harnessConfigId: string,
  command: string,
  composeDir?: string,
  timeoutMs = 60_000,
): Promise<{ ok: boolean; output?: string; exitCode?: number }> {
  const msg: ExecInHarness = {
    type: 'exec_in_harness',
    sessionId: ulid(),
    harnessConfigId,
    command,
    composeDir,
    timeout: timeoutMs,
  };
  const result = await sendAndWait(launcherId, msg, 'exec_in_harness_result', timeoutMs + 10_000) as ExecInHarnessResult;
  return { ok: result.ok, output: result.output, exitCode: result.exitCode };
}

function deriveLabel(filename: string): string {
  if (filename === 'PROMPT.md') return 'General';
  return filename.replace(/^PROMPT_/, '').replace(/\.md$/, '');
}

// Discover prompt files from harness container
app.get('/prompts', async (c) => {
  const harnessConfigId = c.req.query('harnessConfigId');
  if (!harnessConfigId) return c.json({ error: 'harnessConfigId is required' }, 400);

  const config = db.select().from(schema.harnessConfigs).where(eq(schema.harnessConfigs.id, harnessConfigId)).get();
  if (!config) return c.json({ error: 'Harness config not found' }, 404);
  if (config.status !== 'running') return c.json({ error: 'Harness is not running' }, 400);

  const launcher = findLauncherForHarness(config);
  if (!launcher || launcher.ws.readyState !== 1) return c.json({ error: 'No connected launcher' }, 400);

  const promptDir = c.req.query('promptDir') || DEFAULT_PROMPT_DIR;
  const cmd = `for f in ${promptDir}/PROMPT*.md; do [ -f "$f" ] && echo "---FILE:$(basename "$f")---" && head -2 "$f"; done`;

  try {
    const result = await execInHarness(launcher.id, harnessConfigId, cmd, config.composeDir || undefined, 30_000);
    if (!result.ok || !result.output) return c.json([]);

    const files: { filename: string; label: string; excerpt: string }[] = [];
    const parts = result.output.split(/---FILE:([^-]+)---/).filter(Boolean);

    for (let i = 0; i < parts.length - 1; i += 2) {
      const filename = parts[i].trim();
      const excerpt = parts[i + 1].trim();
      if (filename.match(/^PROMPT[A-Z0-9_]*\.md$/)) {
        files.push({ filename, label: deriveLabel(filename), excerpt });
      }
    }

    // Cross-reference with existing runs
    const allRuns = db.select().from(schema.wiggumRuns)
      .where(eq(schema.wiggumRuns.harnessConfigId, harnessConfigId)).all();
    const activeIds = getActiveRunIds();

    const enriched = files.map(f => {
      const matchingRuns = allRuns.filter(r => r.promptFile === f.filename);
      const activeRun = matchingRuns.find(r => activeIds.includes(r.id) || r.status === 'running' || r.status === 'paused');
      const lastRun = matchingRuns.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return {
        ...f,
        activeRunId: activeRun?.id || null,
        activeRunStatus: activeRun?.status || null,
        lastRunId: lastRun?.id || null,
        lastRunStatus: lastRun?.status || null,
        totalRuns: matchingRuns.length,
      };
    });

    return c.json(enriched);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Read a single prompt file from harness container
app.get('/prompt-file', async (c) => {
  const harnessConfigId = c.req.query('harnessConfigId');
  const filename = c.req.query('filename');
  if (!harnessConfigId || !filename) return c.json({ error: 'harnessConfigId and filename required' }, 400);
  if (!/^PROMPT[A-Z0-9_]*\.md$/.test(filename)) return c.json({ error: 'Invalid filename pattern' }, 400);

  const config = db.select().from(schema.harnessConfigs).where(eq(schema.harnessConfigs.id, harnessConfigId)).get();
  if (!config) return c.json({ error: 'Harness config not found' }, 404);
  if (config.status !== 'running') return c.json({ error: 'Harness is not running' }, 400);

  const launcher = findLauncherForHarness(config);
  if (!launcher || launcher.ws.readyState !== 1) return c.json({ error: 'No connected launcher' }, 400);

  const promptDir = c.req.query('promptDir') || DEFAULT_PROMPT_DIR;
  try {
    const result = await execInHarness(launcher.id, harnessConfigId, `cat ${promptDir}/${filename}`, config.composeDir || undefined, 30_000);
    if (!result.ok) return c.json({ error: 'Failed to read file', output: result.output }, 500);
    return c.json({ filename, content: result.output || '' });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Update a prompt file in harness container
app.put('/prompt-file', async (c) => {
  const body = await c.req.json();
  const { harnessConfigId, filename, content } = body;
  if (!harnessConfigId || !filename || content == null) return c.json({ error: 'harnessConfigId, filename, content required' }, 400);
  if (!/^PROMPT[A-Z0-9_]*\.md$/.test(filename)) return c.json({ error: 'Invalid filename pattern' }, 400);

  const config = db.select().from(schema.harnessConfigs).where(eq(schema.harnessConfigs.id, harnessConfigId)).get();
  if (!config) return c.json({ error: 'Harness config not found' }, 404);
  if (config.status !== 'running') return c.json({ error: 'Harness is not running' }, 400);

  const launcher = findLauncherForHarness(config);
  if (!launcher || launcher.ws.readyState !== 1) return c.json({ error: 'No connected launcher' }, 400);

  const promptDir = body.promptDir || DEFAULT_PROMPT_DIR;
  const b64 = Buffer.from(content, 'utf-8').toString('base64');
  const cmd = `echo '${b64}' | base64 -d > ${promptDir}/${filename}`;

  try {
    const result = await execInHarness(launcher.id, harnessConfigId, cmd, config.composeDir || undefined, 30_000);
    if (!result.ok) return c.json({ error: 'Failed to write file', output: result.output }, 500);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Batch create and start runs from prompt files
app.post('/batch', async (c) => {
  const body = await c.req.json();
  const { harnessConfigId, promptFiles } = body;
  if (!harnessConfigId || !Array.isArray(promptFiles) || promptFiles.length === 0) {
    return c.json({ error: 'harnessConfigId and promptFiles[] required' }, 400);
  }

  const config = db.select().from(schema.harnessConfigs).where(eq(schema.harnessConfigs.id, harnessConfigId)).get();
  if (!config) return c.json({ error: 'Harness config not found' }, 404);
  if (config.status !== 'running') return c.json({ error: 'Harness is not running' }, 400);

  const launcher = findLauncherForHarness(config);
  if (!launcher || launcher.ws.readyState !== 1) return c.json({ error: 'No connected launcher' }, 400);

  const promptDir = body.promptDir || DEFAULT_PROMPT_DIR;
  const maxIterations = body.maxIterations ?? 10;
  const deployCommand = body.deployCommand || null;
  const widgetSessionId = body.widgetSessionId || null;
  const screenshotDelayMs = body.screenshotDelayMs ?? 3000;
  const now = new Date().toISOString();

  const created: any[] = [];
  for (const filename of promptFiles) {
    if (!/^PROMPT[A-Z0-9_]*\.md$/.test(filename)) continue;

    try {
      const fileResult = await execInHarness(launcher.id, harnessConfigId, `cat ${promptDir}/${filename}`, config.composeDir || undefined, 30_000);
      if (!fileResult.ok || !fileResult.output) continue;

      const label = deriveLabel(filename);
      const logFile = `/tmp/wiggum-${label.toLowerCase()}-log.txt`;
      const id = ulid();

      db.insert(schema.wiggumRuns).values({
        id,
        harnessConfigId,
        prompt: fileResult.output,
        promptFile: filename,
        logFile,
        agentLabel: label,
        deployCommand,
        maxIterations,
        widgetSessionId,
        screenshotDelayMs,
        status: 'pending',
        currentIteration: 0,
        iterations: '[]',
        createdAt: now,
        updatedAt: now,
      }).run();

      startWiggumRun(id).catch((err) => {
        console.error(`[wiggum] Failed to start batch run ${id}:`, err.message);
      });

      const row = db.select().from(schema.wiggumRuns).where(eq(schema.wiggumRuns.id, id)).get();
      created.push(serializeRun(row!));
    } catch (err: any) {
      console.error(`[wiggum] Batch: failed to process ${filename}:`, err.message);
    }
  }

  return c.json(created, 201);
});

// Batch action on multiple runs
app.post('/batch-action', async (c) => {
  const body = await c.req.json();
  const { action, runIds } = body;
  if (!action || !Array.isArray(runIds) || runIds.length === 0) {
    return c.json({ error: 'action and runIds[] required' }, 400);
  }
  if (!['stop', 'pause', 'resume'].includes(action)) {
    return c.json({ error: 'action must be stop, pause, or resume' }, 400);
  }

  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of runIds) {
    try {
      if (action === 'stop') stopWiggumRun(id);
      else if (action === 'pause') pauseWiggumRun(id);
      else if (action === 'resume') resumeWiggumRun(id);
      results.push({ id, ok: true });
    } catch (err: any) {
      results.push({ id, ok: false, error: err.message });
    }
  }
  return c.json({ results });
});

// Tail log file from harness container
app.get('/log', async (c) => {
  const harnessConfigId = c.req.query('harnessConfigId');
  const logFile = c.req.query('logFile');
  if (!harnessConfigId || !logFile) return c.json({ error: 'harnessConfigId and logFile required' }, 400);

  const config = db.select().from(schema.harnessConfigs).where(eq(schema.harnessConfigs.id, harnessConfigId)).get();
  if (!config) return c.json({ error: 'Harness config not found' }, 404);

  const launcher = findLauncherForHarness(config);
  if (!launcher || launcher.ws.readyState !== 1) return c.json({ error: 'No connected launcher' }, 400);

  try {
    const result = await execInHarness(launcher.id, harnessConfigId, `tail -100 ${logFile} 2>/dev/null || echo "(no log file yet)"`, config.composeDir || undefined, 15_000);
    return c.json({ logFile, content: result.output || '' });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// List wiggum runs (optionally filtered by parentSessionId)
app.get('/', (c) => {
  const parentSessionId = c.req.query('parentSessionId');
  const query = parentSessionId
    ? db.select().from(schema.wiggumRuns).where(eq(schema.wiggumRuns.parentSessionId, parentSessionId))
    : db.select().from(schema.wiggumRuns);
  const rows = query.all();
  const activeIds = getActiveRunIds();
  return c.json(rows.map((r) => ({
    ...serializeRun(r),
    isActive: activeIds.includes(r.id),
  })));
});

// Create and start a new run
app.post('/', async (c) => {
  const body = await c.req.json();
  const now = new Date().toISOString();
  const id = ulid();

  if (!body.harnessConfigId) {
    return c.json({ error: 'harnessConfigId is required' }, 400);
  }
  if (!body.prompt) {
    return c.json({ error: 'prompt is required' }, 400);
  }

  db.insert(schema.wiggumRuns).values({
    id,
    agentEndpointId: body.agentEndpointId || null,
    harnessConfigId: body.harnessConfigId,
    feedbackId: body.feedbackId || null,
    appId: body.appId || null,
    prompt: body.prompt,
    deployCommand: body.deployCommand || null,
    maxIterations: body.maxIterations ?? 10,
    widgetSessionId: body.widgetSessionId || null,
    screenshotDelayMs: body.screenshotDelayMs ?? 3000,
    parentSessionId: body.parentSessionId || null,
    promptFile: body.promptFile || null,
    logFile: body.logFile || null,
    agentLabel: body.agentLabel || null,
    status: 'pending',
    currentIteration: 0,
    iterations: '[]',
    createdAt: now,
    updatedAt: now,
  }).run();

  // Start the run in the background
  startWiggumRun(id).catch((err) => {
    console.error(`[wiggum] Failed to start run ${id}:`, err.message);
  });

  const row = db.select().from(schema.wiggumRuns).where(eq(schema.wiggumRuns.id, id)).get();
  return c.json(serializeRun(row!), 201);
});

// Get run details
app.get('/:id', (c) => {
  const row = db.select().from(schema.wiggumRuns).where(eq(schema.wiggumRuns.id, c.req.param('id'))).get();
  if (!row) return c.json({ error: 'Not found' }, 404);

  const screenshots = db.select().from(schema.wiggumScreenshots)
    .where(eq(schema.wiggumScreenshots.runId, row.id)).all();

  return c.json({
    ...serializeRun(row),
    isActive: getActiveRunIds().includes(row.id),
    screenshots,
  });
});

// Pause a running run
app.post('/:id/pause', (c) => {
  const id = c.req.param('id');
  const run = db.select().from(schema.wiggumRuns).where(eq(schema.wiggumRuns.id, id)).get();
  if (!run) return c.json({ error: 'Not found' }, 404);
  if (run.status !== 'running') return c.json({ error: `Cannot pause run in status: ${run.status}` }, 400);

  pauseWiggumRun(id);
  const updated = db.select().from(schema.wiggumRuns).where(eq(schema.wiggumRuns.id, id)).get();
  return c.json(serializeRun(updated!));
});

// Resume a paused run
app.post('/:id/resume', (c) => {
  const id = c.req.param('id');
  const run = db.select().from(schema.wiggumRuns).where(eq(schema.wiggumRuns.id, id)).get();
  if (!run) return c.json({ error: 'Not found' }, 404);
  if (run.status !== 'paused') return c.json({ error: `Cannot resume run in status: ${run.status}` }, 400);

  resumeWiggumRun(id);
  const updated = db.select().from(schema.wiggumRuns).where(eq(schema.wiggumRuns.id, id)).get();
  return c.json(serializeRun(updated!));
});

// Stop a run
app.post('/:id/stop', (c) => {
  const id = c.req.param('id');
  const run = db.select().from(schema.wiggumRuns).where(eq(schema.wiggumRuns.id, id)).get();
  if (!run) return c.json({ error: 'Not found' }, 404);
  if (run.status !== 'running' && run.status !== 'paused') {
    return c.json({ error: `Cannot stop run in status: ${run.status}` }, 400);
  }

  stopWiggumRun(id);
  const updated = db.select().from(schema.wiggumRuns).where(eq(schema.wiggumRuns.id, id)).get();
  return c.json(serializeRun(updated!));
});

// Delete a run
app.delete('/:id', (c) => {
  const id = c.req.param('id');
  const run = db.select().from(schema.wiggumRuns).where(eq(schema.wiggumRuns.id, id)).get();
  if (!run) return c.json({ error: 'Not found' }, 404);

  // Stop if active
  if (run.status === 'running' || run.status === 'paused') {
    stopWiggumRun(id);
  }

  // Cascade will delete screenshots rows; files remain on disk
  db.delete(schema.wiggumRuns).where(eq(schema.wiggumRuns.id, id)).run();
  return c.json({ ok: true });
});

// Serve a screenshot image
app.get('/:id/screenshots/:sid', async (c) => {
  const screenshot = db.select().from(schema.wiggumScreenshots)
    .where(eq(schema.wiggumScreenshots.id, c.req.param('sid'))).get();
  if (!screenshot || screenshot.runId !== c.req.param('id')) {
    return c.json({ error: 'Not found' }, 404);
  }

  const filePath = `${UPLOAD_DIR}/${screenshot.filename}`;
  try {
    const info = await stat(filePath);
    c.header('Content-Type', screenshot.mimeType);
    c.header('Content-Length', String(info.size));
    c.header('Cache-Control', 'public, max-age=86400');
    const stream = createReadStream(filePath);
    return new Response(stream as any, { headers: { 'Content-Type': screenshot.mimeType } });
  } catch {
    return c.json({ error: 'File not found' }, 404);
  }
});

export default app;
