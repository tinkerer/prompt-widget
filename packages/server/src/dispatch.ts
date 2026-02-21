import { ulid } from 'ulidx';
import { eq, and, sql } from 'drizzle-orm';
import type { FeedbackItem, PermissionProfile, LaunchSession } from '@prompt-widget/shared';
import { db, schema } from './db/index.js';
import { spawnAgentSession } from './agent-sessions.js';
import { getLauncher, addSessionToLauncher } from './launcher-registry.js';

export function hydrateFeedback(row: typeof schema.feedbackItems.$inferSelect, tags: string[], screenshots: (typeof schema.feedbackScreenshots.$inferSelect)[]): FeedbackItem {
  return {
    ...row,
    type: row.type as FeedbackItem['type'],
    status: row.status as FeedbackItem['status'],
    data: row.data ? JSON.parse(row.data) : null,
    context: row.context ? JSON.parse(row.context) : null,
    appId: row.appId || null,
    tags,
    screenshots,
  };
}

export const DEFAULT_PROMPT_TEMPLATE = `do feedback item {{feedback.id}}

Title: {{feedback.title}}
{{feedback.description}}
URL: {{feedback.sourceUrl}}

App: {{app.name}}
Project dir: {{app.projectDir}}
App description: {{app.description}}

{{feedback.consoleLogs}}
{{feedback.networkErrors}}
{{feedback.data}}
{{instructions}}

consider screenshot`;

export function renderPromptTemplate(
  template: string,
  fb: FeedbackItem,
  app: { name: string; projectDir: string; description?: string; [key: string]: unknown } | null,
  instructions?: string
): string {
  let consoleLogs = '';
  if (fb.context?.consoleLogs?.length) {
    consoleLogs = 'Console logs:\n' + fb.context.consoleLogs.map(
      (l) => `  [${l.level.toUpperCase()}] ${l.message}`
    ).join('\n');
  }

  let networkErrors = '';
  if (fb.context?.networkErrors?.length) {
    networkErrors = 'Network errors:\n' + fb.context.networkErrors.map(
      (e) => `  ${e.method} ${e.url} → ${e.status} ${e.statusText}`
    ).join('\n');
  }

  let customData = '';
  if (fb.data) {
    customData = `Custom data: ${JSON.stringify(fb.data, null, 2)}`;
  }

  const vars: Record<string, string> = {
    'feedback.id': fb.id,
    'feedback.title': fb.title || '',
    'feedback.description': fb.description || '',
    'feedback.sourceUrl': fb.sourceUrl || '',
    'feedback.tags': fb.tags?.join(', ') || '',
    'feedback.consoleLogs': consoleLogs,
    'feedback.networkErrors': networkErrors,
    'feedback.data': customData,
    'app.name': app?.name || '',
    'app.projectDir': app?.projectDir || '',
    'app.description': app?.description || '',
    'instructions': instructions || '',
  };

  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }

  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

export async function dispatchFeedbackToAgent(params: {
  feedbackId: string;
  agentEndpointId: string;
  instructions?: string;
}): Promise<{ dispatched: boolean; sessionId?: string; status: number; response: string; existing?: boolean }> {
  const { feedbackId, agentEndpointId, instructions } = params;

  const [feedback, agent] = await Promise.all([
    db.query.feedbackItems.findFirst({
      where: eq(schema.feedbackItems.id, feedbackId),
    }),
    db.query.agentEndpoints.findFirst({
      where: eq(schema.agentEndpoints.id, agentEndpointId),
    }),
  ]);
  if (!feedback) throw new Error('Feedback not found');
  if (!agent) throw new Error('Agent endpoint not found');

  const tags = db
    .select()
    .from(schema.feedbackTags)
    .where(eq(schema.feedbackTags.feedbackId, feedbackId))
    .all()
    .map((t) => t.tag);
  const screenshots = db
    .select()
    .from(schema.feedbackScreenshots)
    .where(eq(schema.feedbackScreenshots.feedbackId, feedbackId))
    .all();

  const hydratedFeedback = hydrateFeedback(feedback, tags, screenshots);

  let app = null;
  if (feedback.appId) {
    const appRow = await db.query.applications.findFirst({
      where: eq(schema.applications.id, feedback.appId),
    });
    if (appRow) {
      app = { ...appRow, hooks: JSON.parse(appRow.hooks) };
    }
  }

  const mode = (agent.mode || 'webhook') as 'webhook' | 'headless' | 'interactive';

  if (mode !== 'webhook') {
    const existing = db
      .select()
      .from(schema.agentSessions)
      .where(
        and(
          eq(schema.agentSessions.feedbackId, feedbackId),
          sql`${schema.agentSessions.status} IN ('pending', 'running')`
        )
      )
      .get();

    if (existing) {
      return {
        dispatched: true,
        sessionId: existing.id,
        status: 200,
        response: `Existing active session: ${existing.id}`,
        existing: true,
      };
    }
  }

  if (mode === 'webhook') {
    const result = await dispatchWebhook(agent.url, agent.authHeader, {
      feedback: hydratedFeedback,
      instructions,
    });

    const now = new Date().toISOString();
    await db.update(schema.feedbackItems).set({
      status: 'dispatched',
      dispatchedTo: agent.name,
      dispatchedAt: now,
      dispatchStatus: result.status >= 200 && result.status < 300 ? 'success' : 'error',
      dispatchResponse: result.response.slice(0, 5000),
      updatedAt: now,
    }).where(eq(schema.feedbackItems.id, feedbackId));

    return {
      dispatched: true,
      status: result.status,
      response: result.response.slice(0, 1000),
    };
  } else {
    const cwd = app?.projectDir || process.cwd();
    const permissionProfile = (agent.permissionProfile || 'interactive') as PermissionProfile;

    const template = agent.promptTemplate || DEFAULT_PROMPT_TEMPLATE;
    const prompt = renderPromptTemplate(template, hydratedFeedback, app, instructions);

    const { sessionId } = await dispatchAgentSession({
      feedbackId,
      agentEndpointId,
      prompt,
      cwd,
      permissionProfile,
      allowedTools: agent.allowedTools,
    });

    const now = new Date().toISOString();
    db.update(schema.feedbackItems).set({
      status: 'dispatched',
      dispatchedTo: agent.name,
      dispatchedAt: now,
      dispatchStatus: 'running',
      dispatchResponse: `Agent session started: ${sessionId}`,
      updatedAt: now,
    }).where(eq(schema.feedbackItems.id, feedbackId)).run();

    return {
      dispatched: true,
      sessionId,
      status: 200,
      response: `Agent session started: ${sessionId}`,
    };
  }
}

export async function dispatchWebhook(
  url: string,
  authHeader: string | null,
  payload: { feedback: FeedbackItem; instructions?: string }
): Promise<{ status: number; response: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  return { status: response.status, response: responseText };
}

export async function dispatchAgentSession(params: {
  feedbackId: string;
  agentEndpointId: string;
  prompt: string;
  cwd: string;
  permissionProfile: PermissionProfile;
  allowedTools?: string | null;
  launcherId?: string | null;
}): Promise<{ sessionId: string }> {
  const sessionId = ulid();
  const now = new Date().toISOString();

  // Resolve launcher: explicit param > agent endpoint preference > local
  let targetLauncherId = params.launcherId || null;
  if (!targetLauncherId) {
    const agent = db
      .select()
      .from(schema.agentEndpoints)
      .where(eq(schema.agentEndpoints.id, params.agentEndpointId))
      .get();
    if (agent?.preferredLauncherId) {
      targetLauncherId = agent.preferredLauncherId;
    }
  }

  const launcher = targetLauncherId ? getLauncher(targetLauncherId) : undefined;

  db.insert(schema.agentSessions)
    .values({
      id: sessionId,
      feedbackId: params.feedbackId,
      agentEndpointId: params.agentEndpointId,
      permissionProfile: params.permissionProfile,
      status: 'pending',
      outputBytes: 0,
      launcherId: launcher ? launcher.id : null,
      createdAt: now,
    })
    .run();

  if (launcher && launcher.ws.readyState === 1) {
    // Route to remote launcher
    const msg: LaunchSession = {
      type: 'launch_session',
      sessionId,
      prompt: params.prompt,
      cwd: params.cwd,
      permissionProfile: params.permissionProfile,
      allowedTools: params.allowedTools,
      cols: 120,
      rows: 40,
    };
    try {
      launcher.ws.send(JSON.stringify(msg));
      addSessionToLauncher(launcher.id, sessionId);
      console.log(`[dispatch] Sent session ${sessionId} to launcher ${launcher.id}`);
    } catch (err) {
      console.error(`[dispatch] Failed to send to launcher, falling back to local:`, err);
      await spawnLocal(sessionId, params);
    }
  } else {
    // Local spawn — await so errors propagate to the caller
    await spawnLocal(sessionId, params);
  }

  return { sessionId };
}

async function spawnLocal(sessionId: string, params: {
  prompt?: string;
  cwd: string;
  permissionProfile: PermissionProfile;
  allowedTools?: string | null;
}): Promise<void> {
  try {
    await spawnAgentSession({
      sessionId,
      prompt: params.prompt,
      cwd: params.cwd,
      permissionProfile: params.permissionProfile,
      allowedTools: params.allowedTools,
    });
  } catch (err) {
    console.error(`Failed to spawn session ${sessionId}:`, err);
    db.update(schema.agentSessions)
      .set({ status: 'failed', completedAt: new Date().toISOString() })
      .where(eq(schema.agentSessions.id, sessionId))
      .run();
    throw err;
  }
}

export async function dispatchTerminalSession(params: {
  cwd: string;
  appId?: string | null;
}): Promise<{ sessionId: string }> {
  const sessionId = ulid();
  const now = new Date().toISOString();

  db.insert(schema.agentSessions)
    .values({
      id: sessionId,
      feedbackId: null,
      agentEndpointId: null,
      permissionProfile: 'plain',
      status: 'pending',
      outputBytes: 0,
      createdAt: now,
    })
    .run();

  try {
    await spawnAgentSession({
      sessionId,
      cwd: params.cwd,
      permissionProfile: 'plain',
    });
  } catch (err) {
    console.error(`Failed to spawn terminal session ${sessionId}:`, err);
    db.update(schema.agentSessions)
      .set({ status: 'failed', completedAt: new Date().toISOString() })
      .where(eq(schema.agentSessions.id, sessionId))
      .run();
    throw err;
  }

  return { sessionId };
}

export async function resumeAgentSession(parentSessionId: string): Promise<{ sessionId: string }> {
  const parent = db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, parentSessionId))
    .get();

  if (!parent) {
    throw new Error('Parent session not found');
  }

  if (parent.status === 'running' || parent.status === 'pending') {
    throw new Error('Session is still active');
  }

  // Plain terminal sessions just spawn a new shell
  if (parent.permissionProfile === 'plain') {
    return dispatchTerminalSession({ cwd: process.cwd() });
  }

  if (!parent.agentEndpointId) {
    throw new Error('Agent endpoint not found');
  }
  if (!parent.feedbackId) {
    throw new Error('Original feedback not found');
  }

  const agent = db
    .select()
    .from(schema.agentEndpoints)
    .where(eq(schema.agentEndpoints.id, parent.agentEndpointId))
    .get();

  if (!agent) {
    throw new Error('Agent endpoint not found');
  }

  const feedbackRow = db
    .select()
    .from(schema.feedbackItems)
    .where(eq(schema.feedbackItems.id, parent.feedbackId))
    .get();

  if (!feedbackRow) {
    throw new Error('Original feedback not found');
  }

  let cwd = process.cwd();
  const resumeAppId = agent.appId || feedbackRow.appId;
  if (resumeAppId) {
    const appRow = db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, resumeAppId))
      .get();
    if (appRow?.projectDir) cwd = appRow.projectDir;
  }

  const originalPrompt = `do feedback item ${parent.feedbackId}\n\nTitle: ${feedbackRow.title}${feedbackRow.description ? `\nDescription: ${feedbackRow.description}` : ''}`;

  // Include a tail of the parent session's output so the agent knows what was already done
  const parentOutput = parent.outputLog || '';
  const outputTail = parentOutput.length > 4000
    ? '...(truncated)\n' + parentOutput.slice(-4000)
    : parentOutput;

  const resumePrompt = `You are resuming a task that a previous agent session worked on but did not fully complete. The user wants you to continue making progress.

Previous session output:
---
${outputTail}
---

Original task:
${originalPrompt}

IMPORTANT: The previous session may have made partial progress. Check the current state (git status, git diff, etc.) then continue working on anything that is still incomplete or broken. Do NOT just summarize what was done — actually do more work. If everything appears complete, verify by running tests or checking the build, and fix any issues you find.`;

  const sessionId = ulid();
  const now = new Date().toISOString();

  // Always resume in interactive mode so the user gets an immediate terminal
  const permissionProfile: PermissionProfile = 'interactive';

  db.insert(schema.agentSessions)
    .values({
      id: sessionId,
      feedbackId: parent.feedbackId,
      agentEndpointId: parent.agentEndpointId,
      parentSessionId,
      permissionProfile,
      status: 'pending',
      outputBytes: 0,
      createdAt: now,
    })
    .run();

  await spawnLocal(sessionId, {
    prompt: resumePrompt,
    cwd,
    permissionProfile,
  });

  return { sessionId };
}
