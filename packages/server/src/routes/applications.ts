import { Hono } from 'hono';
import { ulid } from 'ulidx';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { applicationSchema, applicationUpdateSchema } from '@prompt-widget/shared';
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

applicationRoutes.post('/scaffold', async (c) => {
  const body = await c.req.json();
  const { name, parentDir, projectName } = body;

  if (!name || !parentDir || !projectName) {
    return c.json({ error: 'name, parentDir, and projectName are required' }, 400);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(projectName)) {
    return c.json({ error: 'projectName must be alphanumeric (with _ or -)' }, 400);
  }
  if (!existsSync(parentDir)) {
    return c.json({ error: `parentDir does not exist: ${parentDir}` }, 400);
  }

  const projectDir = join(parentDir, projectName);
  if (existsSync(projectDir)) {
    return c.json({ error: `Directory already exists: ${projectDir}` }, 400);
  }

  const now = new Date().toISOString();
  const id = ulid();
  const apiKey = generateApiKey();

  const host = c.req.header('host') || 'localhost:3001';
  const proto = c.req.header('x-forwarded-proto') || 'http';
  const serverUrl = `${proto}://${host}`;

  mkdirSync(projectDir, { recursive: true });

  writeFileSync(join(projectDir, 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <h1>${name}</h1>
  <p>Your app is ready. The feedback widget is loaded below.</p>
  <script src="${serverUrl}/widget.js" data-server="${serverUrl}" data-api-key="${apiKey}"></script>
</body>
</html>
`);

  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
    name: projectName,
    version: '0.0.1',
    scripts: { start: 'npx serve .' },
  }, null, 2) + '\n');

  await db.insert(schema.applications).values({
    id,
    name,
    apiKey,
    projectDir,
    serverUrl,
    hooks: '{}',
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ id, apiKey, projectDir }, 201);
});

applicationRoutes.post('/clone', async (c) => {
  const body = await c.req.json();
  const { name, gitUrl, parentDir, dirName } = body;

  if (!name || !gitUrl || !parentDir) {
    return c.json({ error: 'name, gitUrl, and parentDir are required' }, 400);
  }
  if (!existsSync(parentDir)) {
    return c.json({ error: `parentDir does not exist: ${parentDir}` }, 400);
  }

  const repoName = dirName || basename(gitUrl).replace(/\.git$/, '');
  const projectDir = join(parentDir, repoName);
  if (existsSync(projectDir)) {
    return c.json({ error: `Directory already exists: ${projectDir}` }, 400);
  }

  try {
    execSync(`git clone ${JSON.stringify(gitUrl)} ${JSON.stringify(projectDir)}`, {
      timeout: 120_000,
      stdio: 'pipe',
    });
  } catch (err: any) {
    return c.json({ error: `git clone failed: ${err.stderr?.toString() || err.message}` }, 500);
  }

  const now = new Date().toISOString();
  const id = ulid();
  const apiKey = generateApiKey();

  await db.insert(schema.applications).values({
    id,
    name,
    apiKey,
    projectDir,
    hooks: '{}',
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ id, apiKey, projectDir }, 201);
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
  const parsed = applicationUpdateSchema.safeParse(body);
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
  const updates: Record<string, unknown> = { updatedAt: now };
  const d = parsed.data;

  if (d.name !== undefined) updates.name = d.name;
  if (d.projectDir !== undefined) updates.projectDir = d.projectDir;
  if ('serverUrl' in d) updates.serverUrl = d.serverUrl || null;
  if (d.hooks !== undefined) updates.hooks = JSON.stringify(d.hooks);
  if (d.description !== undefined) updates.description = d.description;
  if ('tmuxConfigId' in d) updates.tmuxConfigId = d.tmuxConfigId || null;
  if (d.defaultPermissionProfile !== undefined) updates.defaultPermissionProfile = d.defaultPermissionProfile;
  if ('defaultAllowedTools' in d) updates.defaultAllowedTools = d.defaultAllowedTools || null;
  if ('agentPath' in d) updates.agentPath = d.agentPath || null;
  if (d.screenshotIncludeWidget !== undefined) updates.screenshotIncludeWidget = d.screenshotIncludeWidget;
  if (d.autoDispatch !== undefined) updates.autoDispatch = d.autoDispatch;

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
