import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { ulid } from 'ulidx';
import * as schema from './schema.js';

const DB_PATH = process.env.DB_PATH || 'prompt-widget.db';

const sqlite: DatabaseType = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { schema, sqlite };

export function runMigrations() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS feedback_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'new',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      data TEXT,
      context TEXT,
      source_url TEXT,
      user_agent TEXT,
      viewport TEXT,
      session_id TEXT,
      user_id TEXT,
      dispatched_to TEXT,
      dispatched_at TEXT,
      dispatch_status TEXT,
      dispatch_response TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback_screenshots (
      id TEXT PRIMARY KEY,
      feedback_id TEXT NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback_tags (
      feedback_id TEXT NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (feedback_id, tag)
    );

    CREATE TABLE IF NOT EXISTS agent_endpoints (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      auth_header TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_items(status);
    CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback_items(type);
    CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback_items(created_at);
    CREATE INDEX IF NOT EXISTS idx_screenshots_feedback ON feedback_screenshots(feedback_id);
    CREATE INDEX IF NOT EXISTS idx_tags_feedback ON feedback_tags(feedback_id);
    CREATE INDEX IF NOT EXISTS idx_tags_tag ON feedback_tags(tag);

    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL UNIQUE,
      project_dir TEXT NOT NULL,
      server_url TEXT,
      hooks TEXT NOT NULL DEFAULT '[]',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_applications_api_key ON applications(api_key);
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      feedback_id TEXT NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
      agent_endpoint_id TEXT NOT NULL REFERENCES agent_endpoints(id) ON DELETE CASCADE,
      permission_profile TEXT NOT NULL DEFAULT 'interactive',
      status TEXT NOT NULL DEFAULT 'pending',
      pid INTEGER,
      exit_code INTEGER,
      output_log TEXT,
      output_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_sessions_feedback ON agent_sessions(feedback_id);
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      group_key TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      linked_feedback_ids TEXT NOT NULL DEFAULT '[]',
      app_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_plans_group_key ON plans(group_key);
    CREATE INDEX IF NOT EXISTS idx_plans_app_id ON plans(app_id);
    CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
  `);

  // Add new columns to existing tables (idempotent via try/catch)
  const alterStatements = [
    `ALTER TABLE feedback_items ADD COLUMN app_id TEXT REFERENCES applications(id) ON DELETE SET NULL`,
    `ALTER TABLE agent_endpoints ADD COLUMN app_id TEXT REFERENCES applications(id) ON DELETE SET NULL`,
    `ALTER TABLE agent_endpoints ADD COLUMN prompt_template TEXT`,
    `ALTER TABLE agent_endpoints ADD COLUMN mode TEXT NOT NULL DEFAULT 'webhook'`,
    `ALTER TABLE agent_endpoints ADD COLUMN permission_profile TEXT NOT NULL DEFAULT 'interactive'`,
    `ALTER TABLE agent_endpoints ADD COLUMN allowed_tools TEXT`,
    `ALTER TABLE agent_sessions ADD COLUMN parent_session_id TEXT`,
    `ALTER TABLE agent_endpoints ADD COLUMN auto_plan INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE agent_sessions ADD COLUMN last_output_seq INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE agent_sessions ADD COLUMN last_input_seq INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE agent_sessions ADD COLUMN tmux_session_name TEXT`,
    `ALTER TABLE agent_sessions ADD COLUMN launcher_id TEXT`,
    `ALTER TABLE agent_endpoints ADD COLUMN preferred_launcher_id TEXT`,
    `ALTER TABLE applications ADD COLUMN tmux_config_id TEXT`,
    `ALTER TABLE applications ADD COLUMN default_permission_profile TEXT DEFAULT 'interactive'`,
    `ALTER TABLE applications ADD COLUMN default_allowed_tools TEXT`,
    `ALTER TABLE applications ADD COLUMN agent_path TEXT`,
    `ALTER TABLE applications ADD COLUMN screenshot_include_widget INTEGER NOT NULL DEFAULT 0`,
  ];

  for (const stmt of alterStatements) {
    try {
      sqlite.exec(stmt);
    } catch {
      // Column already exists
    }
  }

  // Migration: make feedback_id and agent_endpoint_id nullable for plain terminal sessions
  try {
    sqlite.exec(`DROP TABLE IF EXISTS agent_sessions_new`);
    const info = sqlite.pragma(`table_info(agent_sessions)`) as { name: string; notnull: number }[];
    const feedbackCol = info.find(c => c.name === 'feedback_id');
    if (feedbackCol && feedbackCol.notnull === 1) {
      sqlite.exec(`
        CREATE TABLE agent_sessions_new (
          id TEXT PRIMARY KEY,
          feedback_id TEXT REFERENCES feedback_items(id) ON DELETE CASCADE,
          agent_endpoint_id TEXT REFERENCES agent_endpoints(id) ON DELETE CASCADE,
          permission_profile TEXT NOT NULL DEFAULT 'interactive',
          parent_session_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          pid INTEGER,
          exit_code INTEGER,
          output_log TEXT,
          output_bytes INTEGER NOT NULL DEFAULT 0,
          last_output_seq INTEGER NOT NULL DEFAULT 0,
          last_input_seq INTEGER NOT NULL DEFAULT 0,
          tmux_session_name TEXT,
          launcher_id TEXT,
          created_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT
        );
        INSERT INTO agent_sessions_new (
          id, feedback_id, agent_endpoint_id, permission_profile,
          status, pid, exit_code, output_log, output_bytes,
          created_at, started_at, completed_at,
          parent_session_id, last_output_seq, last_input_seq,
          tmux_session_name, launcher_id
        )
        SELECT
          id, feedback_id, agent_endpoint_id, permission_profile,
          status, pid, exit_code, output_log, output_bytes,
          created_at, started_at, completed_at,
          parent_session_id, last_output_seq, last_input_seq,
          tmux_session_name, launcher_id
        FROM agent_sessions;
        DROP TABLE agent_sessions;
        ALTER TABLE agent_sessions_new RENAME TO agent_sessions;
        CREATE INDEX IF NOT EXISTS idx_agent_sessions_feedback ON agent_sessions(feedback_id);
        CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
      `);
    }
  } catch {
    // Migration already applied or table doesn't exist yet
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS pending_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      seq_num INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pending_session_dir_seq
      ON pending_messages(session_id, direction, seq_num);
  `);

  // Tmux configs table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tmux_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Seed default tmux config from tmux-pw.conf if table is empty or default has empty content
  function readTmuxPwConf(): string {
    // Try multiple relative paths since compiled JS runs from dist/db/
    const candidates = [
      resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tmux-pw.conf'),
      resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tmux-pw.conf'),
      resolve(process.cwd(), 'tmux-pw.conf'),
    ];
    for (const p of candidates) {
      try { return readFileSync(p, 'utf-8'); } catch { /* next */ }
    }
    return '';
  }

  const configCount = sqlite.prepare('SELECT count(*) as cnt FROM tmux_configs').get() as { cnt: number };
  if (configCount.cnt === 0) {
    const now = new Date().toISOString();
    sqlite.prepare(
      'INSERT INTO tmux_configs (id, name, content, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)'
    ).run(ulid(), 'Default', readTmuxPwConf(), now, now);
  } else {
    // Re-seed if default row exists but has empty content (path was wrong on first run)
    const defaultRow = sqlite.prepare('SELECT id, content FROM tmux_configs WHERE is_default = 1').get() as { id: string; content: string } | undefined;
    if (defaultRow && defaultRow.content === '') {
      const content = readTmuxPwConf();
      if (content) {
        sqlite.prepare('UPDATE tmux_configs SET content = ?, updated_at = ? WHERE id = ?')
          .run(content, new Date().toISOString(), defaultRow.id);
      }
    }
  }
}
