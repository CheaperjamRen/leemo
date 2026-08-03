import Database from "better-sqlite3";
import type { SqliteDatabase } from "./schema";

/**
 * Open (creating if needed) the file-backed SQLite database the persistence
 * layer writes to. WAL mode so a renderer-driven write burst never blocks a
 * concurrent read. Returned as the DI `SqliteDatabase` seam that schema.ts
 * consumes — the real native better-sqlite3 instance satisfies it structurally.
 *
 * This module is the ONLY place the native module is loaded; it is never
 * imported by tests (which inject an in-memory `new Database(':memory:')`
 * directly), keeping the vitest run on the system-Node ABI.
 */
export function openDatabase(file: string): SqliteDatabase {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  return db;
}
