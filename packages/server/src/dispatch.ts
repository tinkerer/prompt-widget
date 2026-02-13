import { ulid } from 'ulidx';
import { eq } from 'drizzle-orm';
import type { FeedbackItem, Application, AgentEndpoint, PermissionProfile } from '@prompt-widget/shared';
import { db, schema } from './db/index.js';
import { spawnAgentSession } from './agent-sessions.js';

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
}): Promise<{ sessionId: string }> {
  const sessionId = ulid();
  const now = new Date().toISOString();

  db.insert(schema.agentSessions)
    .values({
      id: sessionId,
      feedbackId: params.feedbackId,
      agentEndpointId: params.agentEndpointId,
      permissionProfile: params.permissionProfile,
      status: 'pending',
      outputBytes: 0,
      createdAt: now,
    })
    .run();

  await spawnAgentSession({
    sessionId,
    prompt: params.prompt,
    cwd: params.cwd,
    permissionProfile: params.permissionProfile,
    allowedTools: params.allowedTools,
  });

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

  const agent = db
    .select()
    .from(schema.agentEndpoints)
    .where(eq(schema.agentEndpoints.id, parent.agentEndpointId))
    .get();

  if (!agent) {
    throw new Error('Agent endpoint not found');
  }

  let cwd = process.cwd();
  if (agent.appId) {
    const app = db
      .select()
      .from(schema.applications)
      .where(eq(schema.applications.id, agent.appId))
      .get();
    if (app?.projectDir) {
      cwd = app.projectDir;
    }
  }

  const sessionId = ulid();
  const now = new Date().toISOString();
  const permissionProfile = (parent.permissionProfile || 'interactive') as PermissionProfile;

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

  await spawnAgentSession({
    sessionId,
    prompt: 'Continue working on this task.',
    cwd,
    permissionProfile,
    allowedTools: agent.allowedTools,
    resume: true,
  });

  return { sessionId };
}
