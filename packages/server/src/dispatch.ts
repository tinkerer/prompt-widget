import { execFile } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FeedbackItem, Application, AgentEndpoint } from '@prompt-widget/shared';

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

export async function dispatchHeadless(
  prompt: string,
  cwd: string
): Promise<{ status: number; response: string }> {
  return new Promise((resolve) => {
    execFile(
      'claude',
      ['-p', prompt, '--output-format', 'text'],
      { cwd, timeout: 300_000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            status: 500,
            response: `Error: ${err.message}\n${stderr}`.slice(0, 5000),
          });
        } else {
          resolve({
            status: 200,
            response: stdout.slice(0, 5000),
          });
        }
      }
    );
  });
}

export async function dispatchInteractive(
  prompt: string,
  cwd: string,
  sessionName?: string
): Promise<{ status: number; response: string }> {
  const name = sessionName || `pw-${randomBytes(4).toString('hex')}`;
  const tmpFile = join(tmpdir(), `pw-prompt-${name}.txt`);

  await writeFile(tmpFile, prompt, 'utf-8');

  return new Promise((resolve) => {
    execFile(
      'tmux',
      ['new-session', '-d', '-s', name, '-c', cwd],
      { timeout: 10_000 },
      (err) => {
        if (err) {
          resolve({
            status: 500,
            response: `Failed to create tmux session: ${err.message}`,
          });
          return;
        }

        execFile(
          'tmux',
          ['send-keys', '-t', name, `claude -p "$(cat ${tmpFile})"`, 'Enter'],
          { timeout: 10_000 },
          (sendErr) => {
            if (sendErr) {
              resolve({
                status: 500,
                response: `Failed to send command to tmux: ${sendErr.message}`,
              });
              return;
            }

            resolve({
              status: 200,
              response: `Interactive session started: tmux attach -t ${name}`,
            });

            setTimeout(() => unlink(tmpFile).catch(() => {}), 60_000);
          }
        );
      }
    );
  });
}
