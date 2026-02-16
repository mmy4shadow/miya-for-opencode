import * as fs from 'node:fs';
import * as path from 'node:path';
import { Database } from 'bun:sqlite';
import { getMiyaRuntimeDir } from '../workflow';

export interface CompanionMemoryGraphEdge {
  memoryID: string;
  subject: string;
  predicate: string;
  object: string;
  memoryKind: string;
  confidence: number;
  sourceMessageID?: string;
  updatedAt: string;
  score: number;
}

function memoryDir(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'memory');
}

function sqlitePath(projectDir: string): string {
  return path.join(memoryDir(projectDir), 'memories.sqlite');
}

function openGraphDb(projectDir: string): Database {
  fs.mkdirSync(memoryDir(projectDir), { recursive: true });
  const db = new Database(sqlitePath(projectDir));
  db.exec(`
    CREATE TABLE IF NOT EXISTS long_term_graph (
      memory_id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      memory_kind TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      source_message_id TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function overlapScore(tokens: string[], text: string): number {
  if (tokens.length === 0) return 0;
  const lower = text.toLowerCase();
  let matched = 0;
  for (const token of tokens) {
    if (lower.includes(token)) matched += 1;
  }
  return matched / tokens.length;
}

export function searchCompanionMemoryGraph(
  projectDir: string,
  query: string,
  limit = 8,
  options?: { minConfidence?: number },
): CompanionMemoryGraphEdge[] {
  const text = String(query ?? '').trim();
  if (!text) return [];
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const minConfidence =
    typeof options?.minConfidence === 'number'
      ? Math.max(0, Math.min(1, options.minConfidence))
      : 0;
  let db: Database | null = null;
  try {
    db = openGraphDb(projectDir);
    const like = `%${text.replace(/[%_]/g, '')}%`;
    const rows = db
      .query(
        `
          SELECT
            memory_id AS memoryID,
            subject,
            predicate,
            object,
            memory_kind AS memoryKind,
            confidence,
            source_message_id AS sourceMessageID,
            updated_at AS updatedAt
          FROM long_term_graph
          WHERE
            confidence >= ?1
            AND (
              subject LIKE ?2
              OR predicate LIKE ?2
              OR object LIKE ?2
            )
          ORDER BY confidence DESC, updated_at DESC
          LIMIT ?3
        `,
      )
      .all(minConfidence, like, safeLimit * 4) as Array<
      Omit<CompanionMemoryGraphEdge, 'score'> & { confidence?: number }
    >;
    const tokens = tokenize(text);
    return rows
      .map((row) => {
        const confidence = Number(row.confidence ?? 0.5);
        const lexical = overlapScore(tokens, `${row.subject} ${row.predicate} ${row.object}`);
        const score = Number((0.55 * lexical + 0.45 * confidence).toFixed(4));
        return {
          ...row,
          confidence,
          score,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, safeLimit);
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

export function listCompanionMemoryGraphNeighbors(
  projectDir: string,
  entity: string,
  limit = 12,
): CompanionMemoryGraphEdge[] {
  const text = String(entity ?? '').trim();
  if (!text) return [];
  const safeLimit = Math.max(1, Math.min(80, Math.floor(limit)));
  let db: Database | null = null;
  try {
    db = openGraphDb(projectDir);
    const like = `%${text.replace(/[%_]/g, '')}%`;
    const rows = db
      .query(
        `
          SELECT
            memory_id AS memoryID,
            subject,
            predicate,
            object,
            memory_kind AS memoryKind,
            confidence,
            source_message_id AS sourceMessageID,
            updated_at AS updatedAt
          FROM long_term_graph
          WHERE subject LIKE ?1 OR object LIKE ?1
          ORDER BY confidence DESC, updated_at DESC
          LIMIT ?2
        `,
      )
      .all(like, safeLimit) as Array<Omit<CompanionMemoryGraphEdge, 'score'>>;
    return rows.map((row) => ({
      ...row,
      confidence: Number(row.confidence ?? 0.5),
      score: Number(row.confidence ?? 0.5),
    }));
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

export function getCompanionMemoryGraphStats(projectDir: string): {
  sqlitePath: string;
  edgeCount: number;
  avgConfidence: number;
  updatedAt?: string;
} {
  let db: Database | null = null;
  try {
    db = openGraphDb(projectDir);
    const row = db
      .query(
        `
          SELECT
            COUNT(1) AS edgeCount,
            AVG(confidence) AS avgConfidence,
            MAX(updated_at) AS updatedAt
          FROM long_term_graph
        `,
      )
      .get() as { edgeCount?: number; avgConfidence?: number; updatedAt?: string } | null;
    return {
      sqlitePath: sqlitePath(projectDir),
      edgeCount: Number(row?.edgeCount ?? 0),
      avgConfidence: Number(Number(row?.avgConfidence ?? 0).toFixed(4)),
      updatedAt: row?.updatedAt,
    };
  } finally {
    try {
      db?.close();
    } catch {}
  }
}
