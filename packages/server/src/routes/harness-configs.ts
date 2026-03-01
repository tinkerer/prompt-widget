import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulidx';
import { db, schema } from '../db/index.js';
import { listLaunchers, getLauncher } from '../launcher-registry.js';
import type { StartHarness, StopHarness } from '@prompt-widget/shared';

const app = new Hono();

function serializeHarnessConfig(row: typeof schema.harnessConfigs.$inferSelect) {
  return {
    ...row,
    envVars: row.envVars ? JSON.parse(row.envVars) : null,
  };
}

app.get('/', (c) => {
  const appId = c.req.query('appId');
  let rows;
  if (appId) {
    rows = db.select().from(schema.harnessConfigs).where(eq(schema.harnessConfigs.appId, appId)).all();
  } else {
    rows = db.select().from(schema.harnessConfigs).all();
  }
  return c.json(rows.map(serializeHarnessConfig));
});

app.post('/', async (c) => {
  const body = await c.req.json();
  const now = new Date().toISOString();
  const id = ulid();

  db.insert(schema.harnessConfigs)
    .values({
      id,
      appId: body.appId || null,
      machineId: body.machineId || null,
      name: body.name || 'Unnamed Harness',
      status: 'stopped',
      appImage: body.appImage || null,
      appPort: body.appPort || null,
      appInternalPort: body.appInternalPort || null,
      serverPort: body.serverPort || null,
      browserMcpPort: body.browserMcpPort || null,
      targetAppUrl: body.targetAppUrl || null,
      composeDir: body.composeDir || null,
      envVars: body.envVars ? JSON.stringify(body.envVars) : null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const row = db.select().from(schema.harnessConfigs).where(eq(schema.harnessConfigs.id, id)).get();
  return c.json(serializeHarnessConfig(row!), 201);
});

app.get('/:id', (c) => {
  const row = db.select().from(schema.harnessConfigs).where(eq(schema.harnessConfigs.id, c.req.param('id'))).get();
  if (!row) return c.json({ error: 'Harness config not found' }, 404);
  return c.json(serializeHarnessConfig(row));
});

app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.select().from(schema.harnessConfigs).where(eq(schema.harnessConfigs.id, id)).get();
  if (!existing) return c.json({ error: 'Harness config not found' }, 404);

  const body = await c.req.json();
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updatedAt: now };

  if (body.appId !== undefined) updates.appId = body.appId;
  if (body.machineId !== undefined) updates.machineId = body.machineId;
  if (body.name !== undefined) updates.name = body.name;
  if (body.appImage !== undefined) updates.appImage = body.appImage;
  if (body.appPort !== undefined) updates.appPort = body.appPort;
  if (body.appInternalPort !== undefined) updates.appInternalPort = body.appInternalPort;
  if (body.serverPort !== undefined) updates.serverPort = body.serverPort;
  if (body.browserMcpPort !== undefined) updates.browserMcpPort = body.browserMcpPort;
  if (body.targetAppUrl !== undefined) updates.targetAppUrl = body.targetAppUrl;
  if (body.composeDir !== undefined) updates.composeDir = body.composeDir;
  if (body.envVars !== undefined) updates.envVars = body.envVars ? JSON.stringify(body.envVars) : null;

  db.update(schema.harnessConfigs).set(updates).where(eq(schema.harnessConfigs.id, id)).run();
  const row = db.select().from(schema.harnessConfigs).where(eq(schema.harnessConfigs.id, id)).get();
  return c.json(serializeHarnessConfig(row!));
});

app.delete('/:id', (c) => {
  const id = c.req.param('id');
  const existing = db.select().from(schema.harnessConfigs).where(eq(schema.harnessConfigs.id, id)).get();
  if (!existing) return c.json({ error: 'Harness config not found' }, 404);

  db.delete(schema.harnessConfigs).where(eq(schema.harnessConfigs.id, id)).run();
  return c.json({ ok: true, id });
});

app.post('/:id/start', (c) => {
  const id = c.req.param('id');
  const config = db.select().from(schema.harnessConfigs).where(eq(schema.harnessConfigs.id, id)).get();
  if (!config) return c.json({ error: 'Harness config not found' }, 404);

  if (!config.machineId) {
    return c.json({ error: 'No machine assigned to this harness' }, 400);
  }

  // Find a launcher connected from this machine
  const launchers = listLaunchers();
  const machineLauncher = launchers.find(l => l.machineId === config.machineId && l.ws?.readyState === 1);
  if (!machineLauncher) {
    return c.json({ error: 'Machine is offline — no launcher connected' }, 400);
  }

  const msg: StartHarness = {
    type: 'start_harness',
    harnessConfigId: id,
    appImage: config.appImage || undefined,
    appPort: config.appPort || undefined,
    appInternalPort: config.appInternalPort || undefined,
    serverPort: config.serverPort || undefined,
    browserMcpPort: config.browserMcpPort || undefined,
    targetAppUrl: config.targetAppUrl || undefined,
    composeDir: config.composeDir || undefined,
    envVars: config.envVars ? JSON.parse(config.envVars) : undefined,
  };

  try {
    machineLauncher.ws.send(JSON.stringify(msg));
  } catch (err) {
    return c.json({ error: 'Failed to send start command to launcher' }, 500);
  }

  const now = new Date().toISOString();
  db.update(schema.harnessConfigs)
    .set({ status: 'starting', lastStartedAt: now, errorMessage: null, updatedAt: now })
    .where(eq(schema.harnessConfigs.id, id))
    .run();

  return c.json({ ok: true, status: 'starting' });
});

app.post('/:id/stop', (c) => {
  const id = c.req.param('id');
  const config = db.select().from(schema.harnessConfigs).where(eq(schema.harnessConfigs.id, id)).get();
  if (!config) return c.json({ error: 'Harness config not found' }, 404);

  // Find the launcher that's running this harness
  let targetLauncher;
  if (config.launcherId) {
    targetLauncher = getLauncher(config.launcherId);
  }
  if (!targetLauncher && config.machineId) {
    const launchers = listLaunchers();
    targetLauncher = launchers.find(l => l.machineId === config.machineId && l.ws?.readyState === 1);
  }

  if (targetLauncher && targetLauncher.ws?.readyState === 1) {
    const msg: StopHarness = {
      type: 'stop_harness',
      harnessConfigId: id,
      composeDir: config.composeDir || undefined,
    };
    try {
      targetLauncher.ws.send(JSON.stringify(msg));
    } catch {}
  }

  const now = new Date().toISOString();
  db.update(schema.harnessConfigs)
    .set({ status: 'stopped', launcherId: null, lastStoppedAt: now, updatedAt: now })
    .where(eq(schema.harnessConfigs.id, id))
    .run();

  return c.json({ ok: true, status: 'stopped' });
});

export default app;
