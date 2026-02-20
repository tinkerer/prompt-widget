import { ulid } from 'ulidx';
import { eq } from 'drizzle-orm';
import type { FeedbackItem, Application, AgentEndpoint, PermissionProfile, LaunchSession } from '@prompt-widget/shared';
import { db, schema } from './db/index.js';
import { spawnAgentSession } from './agent-sessions.js';
import { getLauncher, addSessionToLauncher } from './launcher-registry.js';

export interface DispatchContext {
  feedback: FeedbackItem;
  agent: AgentEndpoint;
  app: Application | null;
  instructions?: string;
  session?: {
    url: string | null;
    viewport: string | null;
  };
  serverUrl?: string;
}

export function fillPromptTemplate(template: string, ctx: DispatchContext): string {
  const fb = ctx.feedback;
  const app = ctx.app;
  const session = ctx.session;

  const consoleLogs = fb.context?.consoleLogs
    ?.map((l) => `[${l.level.toUpperCase()}] ${l.message}`)
    .join('\n') || '';

  const networkErrors = fb.context?.networkErrors
    ?.map((e) => `${e.method} ${e.url} → ${e.status} ${e.statusText}`)
    .join('\n') || '';

  const replacements: Record<string, string> = {
    '{{feedback.title}}': fb.title,
    '{{feedback.description}}': fb.description || '',
    '{{feedback.consoleLogs}}': consoleLogs,
    '{{feedback.networkErrors}}': networkErrors,
    '{{feedback.data}}': fb.data ? JSON.stringify(fb.data, null, 2) : '',
    '{{feedback.tags}}': fb.tags?.join(', ') || '',
    '{{app.name}}': app?.name || '',
    '{{app.projectDir}}': app?.projectDir || '',
    '{{app.hooks}}': app?.hooks?.join(', ') || '',
    '{{app.description}}': app?.description || '',
    '{{instructions}}': ctx.instructions || '',
    '{{session.url}}': session?.url || '',
    '{{session.viewport}}': session?.viewport || '',
  };

  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(key, value);
  }
  return result;
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
      spawnLocal(sessionId, params);
    }
  } else {
    // Local spawn
    spawnLocal(sessionId, params);
  }

  return { sessionId };
}

function spawnLocal(sessionId: string, params: {
  prompt: string;
  cwd: string;
  permissionProfile: PermissionProfile;
  allowedTools?: string | null;
}): void {
  spawnAgentSession({
    sessionId,
    prompt: params.prompt,
    cwd: params.cwd,
    permissionProfile: params.permissionProfile,
    allowedTools: params.allowedTools,
  }).catch((err) => {
    console.error(`Failed to spawn session ${sessionId}:`, err);
    db.update(schema.agentSessions)
      .set({ status: 'failed', completedAt: new Date().toISOString() })
      .where(eq(schema.agentSessions.id, sessionId))
      .run();
  });
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

  const agent = db
    .select()
    .from(schema.agentEndpoints)
    .where(eq(schema.agentEndpoints.id, parent.agentEndpointId))
    .get();

  if (!agent) {
    throw new Error('Agent endpoint not found');
  }

  // Look up the original feedback to rebuild the prompt with full context
  const feedbackRow = db
    .select()
    .from(schema.feedbackItems)
    .where(eq(schema.feedbackItems.id, parent.feedbackId))
    .get();

  if (!feedbackRow) {
    throw new Error('Original feedback not found');
  }

  const tags = db
    .select()
    .from(schema.feedbackTags)
    .where(eq(schema.feedbackTags.feedbackId, feedbackRow.id))
    .all()
    .map((t) => t.tag);

  const feedback: FeedbackItem = {
    ...feedbackRow,
    type: feedbackRow.type as FeedbackItem['type'],
    status: feedbackRow.status as FeedbackItem['status'],
    data: feedbackRow.data ? JSON.parse(feedbackRow.data) : null,
    context: feedbackRow.context ? JSON.parse(feedbackRow.context) : null,
    appId: feedbackRow.appId || null,
    tags,
    screenshots: [],
  };

  let cwd = process.cwd();
  let app: Application | null = null;
  const resumeAppId = agent.appId || feedbackRow.appId;
  if (resumeAppId) {
    const appRow = db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, resumeAppId))
      .get();
    if (appRow) {
      app = {
        ...appRow,
        hooks: JSON.parse(appRow.hooks || '[]'),
        serverUrl: appRow.serverUrl || null,
      };
      if (appRow.projectDir) cwd = appRow.projectDir;
    }
  }

  // Rebuild the original prompt template with feedback context
  const baseTemplate = agent.promptTemplate || '{{feedback.title}}\n\n{{feedback.description}}\n\n{{instructions}}';
  const template = agent.autoPlan
    ? baseTemplate + '\n\nIMPORTANT: Before making any changes, create a detailed plan first. Present the plan and wait for approval before implementing.'
    : baseTemplate;

  const agentTyped: AgentEndpoint = {
    ...agent,
    mode: agent.mode as AgentEndpoint['mode'],
    appId: agent.appId || null,
    promptTemplate: agent.promptTemplate || null,
    authHeader: agent.authHeader || null,
    isDefault: !!agent.isDefault,
    permissionProfile: (agent.permissionProfile || 'interactive') as PermissionProfile,
    allowedTools: agent.allowedTools || null,
    autoPlan: !!agent.autoPlan,
  };

  const ctx: DispatchContext = { feedback, agent: agentTyped, app };
  const originalPrompt = fillPromptTemplate(template, ctx);

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

  spawnAgentSession({
    sessionId,
    prompt: resumePrompt,
    cwd,
    permissionProfile,
  }).catch((err) => {
    console.error(`Failed to resume session ${sessionId}:`, err);
    db.update(schema.agentSessions)
      .set({ status: 'failed', completedAt: new Date().toISOString() })
      .where(eq(schema.agentSessions.id, sessionId))
      .run();
  });

  return { sessionId };
}
