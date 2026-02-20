import { ulid } from 'ulidx';
import { eq } from 'drizzle-orm';
import type { FeedbackItem, PermissionProfile, LaunchSession } from '@prompt-widget/shared';
import { db, schema } from './db/index.js';
import { spawnAgentSession } from './agent-sessions.js';
import { getLauncher, addSessionToLauncher } from './launcher-registry.js';

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
