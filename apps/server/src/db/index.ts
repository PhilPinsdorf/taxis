import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONNECTORS, MaterialInputSchema, newId, SEED_CATALOG } from '@taxis/shared';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE materials (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE connector_types (
    name TEXT PRIMARY KEY,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    owner_id TEXT,
    name TEXT NOT NULL,
    date TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    plan_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    plan_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX snapshots_project ON snapshots(project_id, created_at);
  CREATE TABLE requests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX requests_project ON requests(project_id);
  CREATE TABLE images (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

export function openDb(dataDir: string): DB {
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const db = new Database(path.join(dataDir, 'app.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seed(db);
  return db;
}

function migrate(db: DB) {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

function seed(db: DB) {
  const hasConnectors = db.prepare('SELECT COUNT(*) AS n FROM connector_types').get() as { n: number };
  if (hasConnectors.n === 0) {
    const ins = db.prepare('INSERT INTO connector_types (name, sort) VALUES (?, ?)');
    DEFAULT_CONNECTORS.forEach((c, i) => ins.run(c, i));
  }
  const hasMaterials = db.prepare('SELECT COUNT(*) AS n FROM materials').get() as { n: number };
  if (hasMaterials.n === 0) {
    const ins = db.prepare('INSERT INTO materials (id, data) VALUES (?, ?)');
    db.transaction(() => {
      for (const m of SEED_CATALOG) ins.run(newId(), JSON.stringify(MaterialInputSchema.parse(m)));
    })();
  }
}
