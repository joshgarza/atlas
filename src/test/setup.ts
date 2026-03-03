import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { vi, beforeEach, afterEach } from 'vitest';
import { migrate } from '../db/schema.js';

let testDb: Database.Database;

// Mock the connection module so all production code uses our in-memory DB
vi.mock('../db/connection.js', () => ({
  getDb: () => testDb,
  closeDb: () => {},
  loadVecExtension: () => {},
}));

beforeEach(() => {
  testDb = new Database(':memory:');
  sqliteVec.load(testDb);
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
  migrate(testDb);
});

afterEach(() => {
  testDb.close();
});
