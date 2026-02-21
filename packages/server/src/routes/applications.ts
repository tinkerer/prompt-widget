import { Hono } from 'hono';
import { ulid } from 'ulidx';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { applicationSchema } from '@prompt-widget/shared';
import { db, schema } from '../db/index.js';

export const applicationRoutes = new Hono();

function generateApiKey(): string {
  return 'pw_' + randomBytes(32).toString('base64url').slice(0, 43);
}

applicationRoutes.get('/', async (c) => {
  const apps = db.select().from(schema.applications).all();
  return c.json(
    apps.map((app) => ({
      ...app,
      hooks: JSON.parse(app.hooks),
    }))
  );
});

applicationRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const app = await db.query.applications.findFirst({
    where: eq(schema.applications.id, id),
  });
  if (!app) {
    return c.json({ error: 'Not found' }, 404);
  }
  return c.json({ ...app, hooks: JSON.parse(app.hooks) });
});

applicationRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = applicationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const now = new Date().toISOString();
  const id = ulid();
  const apiKey = generateApiKey();

  await db.insert(schema.applications).values({
    id,
    name: parsed.data.name,
    apiKey,
    projectDir: parsed.data.projectDir,
    serverUrl: parsed.data.serverUrl || null,
    hooks: JSON.stringify(parsed.data.hooks),
    description: parsed.data.description,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ id, apiKey }, 201);
});

applicationRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = applicationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const existing = await db.query.applications.findFirst({
    where: eq(schema.applications.id, id),
  });
  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    name: parsed.data.name,
    projectDir: parsed.data.projectDir,
    serverUrl: parsed.data.serverUrl || null,
    hooks: JSON.stringify(parsed.data.hooks),
    description: parsed.data.description,
    updatedAt: now,
  };

  if ('tmuxConfigId' in body) updates.tmuxConfigId = body.tmuxConfigId || null;
  if ('defaultPermissionProfile' in body) updates.defaultPermissionProfile = body.defaultPermissionProfile || 'interactive';
  if ('defaultAllowedTools' in body) updates.defaultAllowedTools = body.defaultAllowedTools || null;
  if ('agentPath' in body) updates.agentPath = body.agentPath || null;
  if ('screenshotIncludeWidget' in body) updates.screenshotIncludeWidget = !!body.screenshotIncludeWidget;
  if ('autoDispatch' in body) updates.autoDispatch = !!body.autoDispatch;

  await db.update(schema.applications).set(updates).where(eq(schema.applications.id, id));

  return c.json({ id, updated: true });
});

applicationRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await db.query.applications.findFirst({
    where: eq(schema.applications.id, id),
  });
  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }

  await db.delete(schema.applications).where(eq(schema.applications.id, id));
  return c.json({ id, deleted: true });
});

applicationRoutes.post('/:id/regenerate-key', async (c) => {
  const id = c.req.param('id');
  const existing = await db.query.applications.findFirst({
    where: eq(schema.applications.id, id),
  });
  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }

  const apiKey = generateApiKey();
  const now = new Date().toISOString();
  await db.update(schema.applications).set({
    apiKey,
    updatedAt: now,
  }).where(eq(schema.applications.id, id));

  return c.json({ id, apiKey });
});
