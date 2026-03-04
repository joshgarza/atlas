import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';
import * as sqliteVec from 'sqlite-vec';
import { migrate } from './schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', '..', 'data');

let db: Database.Database | null = null;

export function loadVecExtension(database: Database.Database): void {
  sqliteVec.load(database);
}

export function getDb(dbPath?: string): Database.Database {
  if (db) return db;

  const resolvedPath = dbPath ?? join(DATA_DIR, 'atlas.db');

  // Ensure data directory exists
  mkdirSync(dirname(resolvedPath), { recursive: true });

  db = new Database(resolvedPath);

  // Load sqlite-vec extension before pragmas/migrations
  loadVecExtension(db);

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  // Run migrations
  migrate(db);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
