import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "webhooks.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
  }
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      secret TEXT,
      event_filter TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS delivery_attempts (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id),
      subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_number INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      next_retry_at TEXT,
      last_status_code INTEGER,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_delivery_status ON delivery_attempts(status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_delivery_event ON delivery_attempts(event_id);
    CREATE INDEX IF NOT EXISTS idx_delivery_sub ON delivery_attempts(subscription_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined as any;
  }
}
