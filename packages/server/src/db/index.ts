import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const DB_PATH = process.env.DB_PATH || 'prompt-widget.db';

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { schema };

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

  // Add new columns to existing tables (idempotent via try/catch)
  const alterStatements = [
    `ALTER TABLE feedback_items ADD COLUMN app_id TEXT REFERENCES applications(id) ON DELETE SET NULL`,
    `ALTER TABLE agent_endpoints ADD COLUMN app_id TEXT REFERENCES applications(id) ON DELETE SET NULL`,
    `ALTER TABLE agent_endpoints ADD COLUMN prompt_template TEXT`,
    `ALTER TABLE agent_endpoints ADD COLUMN mode TEXT NOT NULL DEFAULT 'webhook'`,
    `ALTER TABLE agent_endpoints ADD COLUMN permission_profile TEXT NOT NULL DEFAULT 'interactive'`,
    `ALTER TABLE agent_endpoints ADD COLUMN allowed_tools TEXT`,
    `ALTER TABLE agent_sessions ADD COLUMN parent_session_id TEXT`,
  ];

  for (const stmt of alterStatements) {
    try {
      sqlite.exec(stmt);
    } catch {
      // Column already exists
    }
  }
}
