import * as fs from 'node:fs';
import * as path from 'node:path';
import { Database } from 'bun:sqlite';
import { getMiyaRuntimeDir } from '../workflow';
import type { CompanionMemoryVector } from './memory-vector';

function memoryDir(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'memory');
}

function sqlitePath(projectDir: string): string {
  return path.join(memoryDir(projectDir), 'memories.sqlite');
}

function openDatabase(projectDir: string): Database {
  fs.mkdirSync(memoryDir(projectDir), { recursive: true });
  const db = new Database(sqlitePath(projectDir));
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      memory_kind TEXT DEFAULT 'Fact',
      confidence REAL DEFAULT 0.5,
      source_message_id TEXT,
      conflict_flag INTEGER DEFAULT 0,
      is_archived INTEGER DEFAULT 0,
      access_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories_vss (
      memory_id TEXT PRIMARY KEY,
      object_embedding TEXT NOT NULL,
      FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS long_term_graph (
      memory_id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      memory_kind TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      source_message_id TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
  `);
  try {
    db.exec(`ALTER TABLE memories ADD COLUMN memory_kind TEXT DEFAULT 'Fact'`);
  } catch {}
  return db;
}

function parseTriplet(text: string): { subject: string; predicate: string; object: string } {
  const parts = text.trim().split(/\s+/);
  if (parts.length >= 3) {
    return {
      subject: parts[0] ?? 'User',
      predicate: parts[1] ?? 'knows',
      object: parts.slice(2).join(' '),
    };
  }
  return {
    subject: 'User',
    predicate: 'fact',
    object: text.trim(),
  };
}

export function syncCompanionMemoriesToSqlite(
  projectDir: string,
  items: CompanionMemoryVector[],
): void {
  let db: Database | null = null;
  try {
    db = openDatabase(projectDir);
    const upsertMemory = db.query(`
      INSERT INTO memories (
        id, subject, predicate, object, memory_kind, confidence, source_message_id,
        conflict_flag, is_archived, access_count, created_at, last_accessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        subject=excluded.subject,
        predicate=excluded.predicate,
        object=excluded.object,
        memory_kind=excluded.memory_kind,
        confidence=excluded.confidence,
        source_message_id=excluded.source_message_id,
        conflict_flag=excluded.conflict_flag,
        is_archived=excluded.is_archived,
        access_count=excluded.access_count,
        created_at=excluded.created_at,
        last_accessed_at=excluded.last_accessed_at
    `);
    const upsertVss = db.query(`
      INSERT INTO memories_vss (memory_id, object_embedding)
      VALUES (?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        object_embedding=excluded.object_embedding
    `);
    const upsertLongTermGraph = db.query(`
      INSERT INTO long_term_graph (
        memory_id, subject, predicate, object, memory_kind, confidence, source_message_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        subject=excluded.subject,
        predicate=excluded.predicate,
        object=excluded.object,
        memory_kind=excluded.memory_kind,
        confidence=excluded.confidence,
        source_message_id=excluded.source_message_id,
        updated_at=excluded.updated_at
    `);

    const tx = db.transaction(() => {
      for (const item of items) {
        const triplet = parseTriplet(item.text);
        upsertMemory.run(
          item.id,
          triplet.subject,
          triplet.predicate,
          triplet.object,
          item.memoryKind ?? 'Fact',
          item.confidence,
          item.sourceMessageID ?? null,
          item.conflictWizardID ? 1 : 0,
          item.isArchived ? 1 : 0,
          item.accessCount,
          item.createdAt,
          item.lastAccessedAt,
        );
        upsertVss.run(item.id, JSON.stringify(item.embedding));
        upsertLongTermGraph.run(
          item.id,
          triplet.subject,
          triplet.predicate,
          triplet.object,
          item.memoryKind ?? 'Fact',
          item.confidence,
          item.sourceMessageID ?? null,
          item.updatedAt,
        );
      }
    });
    tx();
  } catch {
    // Keep JSON memory pipeline available even when SQLite sync fails.
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

export function getCompanionMemorySqliteStats(projectDir: string): {
  sqlitePath: string;
  memoryCount: number;
  vectorCount: number;
  graphCount: number;
} {
  let db: Database | null = null;
  const dbPath = sqlitePath(projectDir);
  try {
    db = openDatabase(projectDir);
    const memoryCount = Number(
      (db.query('SELECT COUNT(1) AS c FROM memories').get() as { c?: number } | null)?.c ?? 0,
    );
    const vectorCount = Number(
      (db.query('SELECT COUNT(1) AS c FROM memories_vss').get() as { c?: number } | null)?.c ?? 0,
    );
    const graphCount = Number(
      (db.query('SELECT COUNT(1) AS c FROM long_term_graph').get() as { c?: number } | null)?.c ??
        0,
    );
    return {
      sqlitePath: dbPath,
      memoryCount,
      vectorCount,
      graphCount,
    };
  } finally {
    try {
      db?.close();
    } catch {}
  }
}
