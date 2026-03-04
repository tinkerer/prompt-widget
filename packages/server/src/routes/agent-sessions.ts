import { Hono } from 'hono';
import { eq, desc, ne, and } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { db, schema } from '../db/index.js';
import { killSession } from '../agent-sessions.js';
import { resumeAgentSession, dispatchTerminalSession, transferSession, getTransfer } from '../dispatch.js';
import { getSessionLiveStates } from '../session-service-client.js';
import { getLauncher } from '../launcher-registry.js';
import {
  computeJsonlPath as computeJsonlPathFull,
  findContinuationJsonlsCached,
  readJsonlWithSubagents,
  filterJsonlLines,
  extractArtifactPaths,
  exportSessionFiles,
  listJsonlFiles,
} from '../jsonl-utils.js';

function computeJsonlPath(projectDir: string | null, claudeSessionId: string | null): string | null {
  if (!projectDir || !claudeSessionId) return null;
  return computeJsonlPathFull(projectDir, claudeSessionId);
}

export const agentSessionRoutes = new Hono();

// Transfer status route — must be before /:id to avoid being caught by the param
agentSessionRoutes.get('/transfers/:transferId', async (c) => {
  const transferId = c.req.param('transferId');
  const transfer = getTransfer(transferId);

  if (!transfer) {
    return c.json({ error: 'Transfer not found' }, 404);
  }

  return c.json({
    transferId: transfer.id,
    status: transfer.status,
    sessionId: transfer.sessionId,
    parentSessionId: transfer.parentSessionId,
    error: transfer.error,
  });
});

agentSessionRoutes.get('/', async (c) => {
  const feedbackId = c.req.query('feedbackId');
  const includeDeleted = c.req.query('includeDeleted') === 'true';

  const selectFields = {
    session: schema.agentSessions,
    feedbackTitle: schema.feedbackItems.title,
    feedbackAppId: schema.feedbackItems.appId,
    agentName: schema.agentEndpoints.name,
    agentAppId: schema.agentEndpoints.appId,
    appProjectDir: schema.applications.projectDir,
  };

  const baseQuery = () => db
    .select(selectFields)
    .from(schema.agentSessions)
    .leftJoin(schema.feedbackItems, eq(schema.agentSessions.feedbackId, schema.feedbackItems.id))
    .leftJoin(schema.agentEndpoints, eq(schema.agentSessions.agentEndpointId, schema.agentEndpoints.id))
    .leftJoin(schema.applications, eq(schema.feedbackItems.appId, schema.applications.id));

  let rows;
  if (feedbackId) {
    const where = includeDeleted
      ? eq(schema.agentSessions.feedbackId, feedbackId)
      : and(eq(schema.agentSessions.feedbackId, feedbackId), ne(schema.agentSessions.status, 'deleted'));
    rows = baseQuery()
      .where(where)
      .orderBy(desc(schema.agentSessions.createdAt))
      .all();
  } else {
    const where = includeDeleted ? undefined : ne(schema.agentSessions.status, 'deleted');
    rows = baseQuery()
      .where(where)
      .orderBy(desc(schema.agentSessions.createdAt))
      .all();
  }

  const liveStates = await getSessionLiveStates();

  const sessions = rows.map((r) => {
    const live = liveStates[r.session.id];

    // Enrich with launcher/machine/harness metadata
    let launcherName: string | null = null;
    let launcherHostname: string | null = null;
    let machineName: string | null = null;
    let harnessName: string | null = null;
    let isRemote = false;
    let isHarness = false;

    if (r.session.launcherId) {
      const launcher = getLauncher(r.session.launcherId);
      if (launcher) {
        launcherName = launcher.name;
        launcherHostname = launcher.hostname;
        isRemote = !launcher.isLocal;
        isHarness = !!launcher.harness;
        if (launcher.machineId) {
          const machine = db.select().from(schema.machines)
            .where(eq(schema.machines.id, launcher.machineId)).get();
          if (machine) machineName = machine.name;
        }
        if (launcher.harnessConfigId) {
          const harness = db.select().from(schema.harnessConfigs)
            .where(eq(schema.harnessConfigs.id, launcher.harnessConfigId)).get();
          if (harness) harnessName = harness.name;
        }
      } else {
        // Launcher disconnected — try to resolve from DB
        if (r.session.machineId) {
          const machine = db.select().from(schema.machines)
            .where(eq(schema.machines.id, r.session.machineId)).get();
          if (machine) { machineName = machine.name; isRemote = machine.type !== 'local'; }
        }
      }
    }

    return {
      ...r.session,
      feedbackTitle: r.feedbackTitle || null,
      agentName: r.agentName || null,
      appId: r.feedbackAppId || r.agentAppId || null,
      inputState: live?.inputState || (r.session.status === 'running' ? 'active' : null),
      paneTitle: live?.paneTitle || null,
      paneCommand: live?.paneCommand || null,
      panePath: live?.panePath || null,
      jsonlPath: computeJsonlPath(r.appProjectDir || null, r.session.claudeSessionId),
      launcherName,
      launcherHostname,
      machineName,
      harnessName,
      isRemote,
      isHarness,
    };
  });

  return c.json(sessions);
});

agentSessionRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const session = db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, id))
    .get();

  if (!session) {
    return c.json({ error: 'Not found' }, 404);
  }

  return c.json(session);
});

agentSessionRoutes.post('/:id/kill', async (c) => {
  const id = c.req.param('id');
  const killed = await killSession(id);

  if (!killed) {
    return c.json({ error: 'Session not running or not found' }, 404);
  }

  return c.json({ id, killed: true });
});

agentSessionRoutes.post('/:id/resume', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const targetLauncherId = body.launcherId || undefined;
  try {
    const { sessionId } = await resumeAgentSession(id, targetLauncherId);
    return c.json({ sessionId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Resume failed';
    return c.json({ error: msg }, 400);
  }
});

agentSessionRoutes.post('/:id/archive', async (c) => {
  const id = c.req.param('id');
  const session = db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, id))
    .get();

  if (!session) {
    return c.json({ error: 'Not found' }, 404);
  }

  if (session.status === 'running' || session.status === 'pending') {
    await killSession(id);
  }

  db.update(schema.agentSessions)
    .set({ status: 'deleted', completedAt: session.completedAt || new Date().toISOString() })
    .where(eq(schema.agentSessions.id, id))
    .run();

  return c.json({ id, archived: true });
});

agentSessionRoutes.post('/:id/open-terminal', async (c) => {
  const id = c.req.param('id');
  const tmuxName = `pw-${id}`;
  const { execFileSync } = await import('node:child_process');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { writeFileSync, chmodSync, mkdtempSync } = await import('node:fs');

  // Check if session is remote
  const session = db.select().from(schema.agentSessions).where(eq(schema.agentSessions.id, id)).get();
  let isRemote = false;
  let hostname: string | null = null;
  if (session?.launcherId) {
    const launcher = getLauncher(session.launcherId);
    if (launcher && !launcher.isLocal) {
      isRemote = true;
      hostname = launcher.hostname;
    }
  }

  if (isRemote && hostname) {
    // Remote session — generate .command file with SSH
    try {
      const tmpDir = mkdtempSync('/tmp/pw-open-');
      const tmpFile = resolve(tmpDir, 'open.command');
      const cmd = `ssh ${hostname} 'TMUX= tmux -L prompt-widget attach-session -t ${tmuxName}'\nrm -rf "${tmpDir}"\n`;
      writeFileSync(tmpFile, cmd);
      chmodSync(tmpFile, 0o755);
      execFileSync('open', ['-a', 'Terminal', '-e', tmpFile], { stdio: 'pipe' });
      return c.json({ ok: true, tmuxName, remote: true, hostname });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  // Local session — check tmux and use existing script
  try {
    execFileSync('tmux', ['-L', 'prompt-widget', 'has-session', '-t', tmuxName], { stdio: 'pipe' });
  } catch {
    return c.json({ error: 'Tmux session not found' }, 404);
  }
  try {
    const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'open-in-terminal.sh');
    execFileSync(scriptPath, [tmuxName], { stdio: 'pipe' });
    return c.json({ ok: true, tmuxName });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

agentSessionRoutes.get('/:id/jsonl-files', async (c) => {
  const id = c.req.param('id');
  const row = db
    .select({
      claudeSessionId: schema.agentSessions.claudeSessionId,
      appProjectDir: schema.applications.projectDir,
    })
    .from(schema.agentSessions)
    .leftJoin(schema.feedbackItems, eq(schema.agentSessions.feedbackId, schema.feedbackItems.id))
    .leftJoin(schema.applications, eq(schema.feedbackItems.appId, schema.applications.id))
    .where(eq(schema.agentSessions.id, id))
    .get();

  if (!row) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const jsonlPath = computeJsonlPath(row.appProjectDir || null, row.claudeSessionId);
  if (!jsonlPath) {
    return c.json({ error: 'No JSONL path available' }, 400);
  }

  const files = existsSync(jsonlPath) ? listJsonlFiles(jsonlPath) : [];
  return c.json({
    claudeSessionId: row.claudeSessionId,
    files: files.map(f => ({
      id: f.id,
      claudeSessionId: f.claudeSessionId,
      type: f.type,
      label: f.label,
      parentSessionId: f.parentSessionId || null,
      agentId: f.agentId || null,
      order: f.order,
    })),
  });
});

agentSessionRoutes.get('/:id/jsonl', async (c) => {
  const id = c.req.param('id');
  const fileFilter = c.req.query('file'); // optional: specific file id like "main:uuid", "cont:uuid", "sub:uuid:agentId"
  const row = db
    .select({
      claudeSessionId: schema.agentSessions.claudeSessionId,
      appProjectDir: schema.applications.projectDir,
    })
    .from(schema.agentSessions)
    .leftJoin(schema.feedbackItems, eq(schema.agentSessions.feedbackId, schema.feedbackItems.id))
    .leftJoin(schema.applications, eq(schema.feedbackItems.appId, schema.applications.id))
    .where(eq(schema.agentSessions.id, id))
    .get();

  if (!row) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const jsonlPath = computeJsonlPath(row.appProjectDir || null, row.claudeSessionId);
  if (!jsonlPath) {
    return c.json({ error: 'No JSONL path available' }, 400);
  }
  if (!existsSync(jsonlPath)) {
    return c.json({ error: `JSONL file not found: ${jsonlPath}` }, 404);
  }

  // If a specific file is requested, load just that one
  if (fileFilter) {
    const allFiles = listJsonlFiles(jsonlPath);
    const target = allFiles.find(f => f.id === fileFilter);
    if (!target) {
      return c.json({ error: `File not found: ${fileFilter}` }, 404);
    }
    if (!existsSync(target.filePath)) {
      return c.json({ error: `File missing on disk: ${target.filePath}` }, 404);
    }
    const raw = readFileSync(target.filePath, 'utf-8');
    const lines = filterJsonlLines(raw);
    return c.text(lines.join('\n'));
  }

  // Default: merged view (all files)
  const allLines: string[] = [];
  const continuations = findContinuationJsonlsCached(jsonlPath);
  console.log(`[jsonl] ${id}: main=${jsonlPath}, continuations=${continuations.length}`, continuations);
  const jsonlFiles = [jsonlPath, ...continuations];
  for (const filePath of jsonlFiles) {
    readJsonlWithSubagents(filePath, allLines);
  }
  console.log(`[jsonl] ${id}: total lines=${allLines.length}`);

  return c.text(allLines.join('\n'));
});

agentSessionRoutes.post('/:id/tail-jsonl', async (c) => {
  const id = c.req.param('id');
  const row = db
    .select({
      claudeSessionId: schema.agentSessions.claudeSessionId,
      appProjectDir: schema.applications.projectDir,
    })
    .from(schema.agentSessions)
    .leftJoin(schema.feedbackItems, eq(schema.agentSessions.feedbackId, schema.feedbackItems.id))
    .leftJoin(schema.applications, eq(schema.feedbackItems.appId, schema.applications.id))
    .where(eq(schema.agentSessions.id, id))
    .get();

  if (!row) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const jsonlPath = computeJsonlPath(row.appProjectDir || null, row.claudeSessionId);
  if (!jsonlPath) {
    return c.json({ error: 'No JSONL path available (missing projectDir or claudeSessionId)' }, 400);
  }
  if (!existsSync(jsonlPath)) {
    return c.json({ error: `JSONL file not found: ${jsonlPath}` }, 404);
  }

  const { sessionId } = await dispatchTerminalSession({ cwd: '/tmp' });

  const tmuxName = `pw-${sessionId}`;
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('tmux', ['-L', 'prompt-widget', 'send-keys', '-t', tmuxName, `tail -f ${jsonlPath}`, 'Enter'], { stdio: 'pipe' });
  } catch (err: any) {
    console.error('Failed to send tail command:', err.message);
  }

  return c.json({ sessionId, jsonlPath });
});

agentSessionRoutes.post('/:id/transfer', async (c) => {
  const id = c.req.param('id');
  const session = db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, id))
    .get();

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  if (session.status === 'running' || session.status === 'pending') {
    return c.json({ error: 'Cannot transfer an active session' }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const targetLauncherId = body.targetLauncherId || null;
  const targetCwd = body.targetCwd || undefined;

  try {
    const transferId = await transferSession(id, targetLauncherId, targetCwd);
    return c.json({ transferId, status: 'pending' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Transfer failed';
    return c.json({ error: msg }, 400);
  }
});

agentSessionRoutes.get('/:id/export-context', async (c) => {
  const id = c.req.param('id');
  const row = db
    .select({
      session: schema.agentSessions,
      appProjectDir: schema.applications.projectDir,
    })
    .from(schema.agentSessions)
    .leftJoin(schema.feedbackItems, eq(schema.agentSessions.feedbackId, schema.feedbackItems.id))
    .leftJoin(schema.applications, eq(schema.feedbackItems.appId, schema.applications.id))
    .where(eq(schema.agentSessions.id, id))
    .get();

  if (!row) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const projectDir = row.appProjectDir || null;
  const claudeSessionId = row.session.claudeSessionId;
  if (!projectDir || !claudeSessionId) {
    return c.json({ error: 'Missing projectDir or claudeSessionId' }, 400);
  }

  const jsonlPath = computeJsonlPath(projectDir, claudeSessionId);
  if (!jsonlPath || !existsSync(jsonlPath)) {
    return c.json({ error: 'JSONL file not found' }, 404);
  }

  const pkg = exportSessionFiles(projectDir, claudeSessionId);
  const sanitized = projectDir.replaceAll('/', '-').replaceAll('.', '-');

  return c.json({
    claudeSessionId,
    projectDir,
    sanitizedProjectDir: sanitized,
    jsonlFiles: pkg.jsonlFiles,
    artifactFiles: pkg.artifactFiles,
    sessionMetadata: {
      id: row.session.id,
      status: row.session.status,
      feedbackId: row.session.feedbackId,
      agentEndpointId: row.session.agentEndpointId,
      parentSessionId: row.session.parentSessionId,
      launcherId: row.session.launcherId,
      permissionProfile: row.session.permissionProfile,
    },
  });
});

agentSessionRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const session = db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, id))
    .get();

  if (!session) {
    return c.json({ error: 'Not found' }, 404);
  }

  if (session.status === 'running' || session.status === 'pending') {
    await killSession(id);
  }

  await db.delete(schema.agentSessions).where(eq(schema.agentSessions.id, id));
  return c.json({ id, deleted: true });
});
