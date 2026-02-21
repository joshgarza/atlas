import type Database from 'better-sqlite3';

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      granularity TEXT NOT NULL,
      activation REAL NOT NULL DEFAULT 1.0,
      status TEXT NOT NULL DEFAULT 'active',
      superseded_by TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS node_history (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL REFERENCES nodes(id),
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      change_reason TEXT,
      changed_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES nodes(id),
      target_id TEXT NOT NULL REFERENCES nodes(id),
      type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS node_tags (
      node_id TEXT NOT NULL REFERENCES nodes(id),
      tag TEXT NOT NULL,
      PRIMARY KEY (node_id, tag)
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
    CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
    CREATE INDEX IF NOT EXISTS idx_nodes_activation ON nodes(activation DESC);
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_node_history_node ON node_history(node_id);
    CREATE INDEX IF NOT EXISTS idx_node_tags_tag ON node_tags(tag);
  `);

  // Add processed_at column to events (for archivist consolidation tracking)
  const hasProcessedAt = db.prepare(
    "SELECT COUNT(*) as cnt FROM pragma_table_info('events') WHERE name = 'processed_at'"
  ).get() as { cnt: number };

  if (hasProcessedAt.cnt === 0) {
    db.exec('ALTER TABLE events ADD COLUMN processed_at TEXT');
  }

  // FTS5 virtual table — separate because CREATE VIRTUAL TABLE doesn't support IF NOT EXISTS cleanly
  const ftsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='nodes_fts'"
  ).get();

  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE nodes_fts USING fts5(title, content, content=nodes, content_rowid=rowid, tokenize='porter');

      CREATE TRIGGER nodes_fts_insert AFTER INSERT ON nodes BEGIN
        INSERT INTO nodes_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
      END;

      CREATE TRIGGER nodes_fts_update AFTER UPDATE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
        INSERT INTO nodes_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
      END;

      CREATE TRIGGER nodes_fts_delete AFTER DELETE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
      END;
    `);
  }
}
