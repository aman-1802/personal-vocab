import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '../vocab.db');

export const db = createClient({ url: `file:${dbPath}` });

export async function initDb() {
  await db.execute('PRAGMA journal_mode=WAL');
  await db.execute('PRAGMA foreign_keys=ON');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS words (
      word      TEXT PRIMARY KEY,
      meaning   TEXT NOT NULL,
      sentence  TEXT,
      synonyms  TEXT,
      antonyms  TEXT,
      saved_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS books (
      id        TEXT PRIMARY KEY,
      title     TEXT NOT NULL,
      added_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS notes (
      id         TEXT PRIMARY KEY,
      book_id    TEXT NOT NULL REFERENCES books(id),
      text       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}
