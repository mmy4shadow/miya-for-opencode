import { Database } from 'bun:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

export interface CompanionMemoryGraphEdge {
  memoryID: string;
  subject: string;
  predicate: string;
  object: string;
  memoryKind: string;
  semanticLayer: string;
  domain: string;
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
      semantic_layer TEXT DEFAULT 'episodic',
      domain TEXT DEFAULT 'relationship',
      confidence REAL DEFAULT 0.5,
      source_message_id TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  try {
    db.exec(
      `ALTER TABLE long_term_graph ADD COLUMN semantic_layer TEXT DEFAULT 'episodic'`,
    );
  } catch {}
  try {
    db.exec(
      `ALTER TABLE long_term_graph ADD COLUMN domain TEXT DEFAULT 'relationship'`,
    );
  } catch {}
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
  options?: { minConfidence?: number; semanticLayer?: string; domain?: string },
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
    const layer =
      typeof options?.semanticLayer === 'string'
        ? options.semanticLayer.trim()
        : '';
    const domain =
      typeof options?.domain === 'string' ? options.domain.trim() : '';
    const rows = db
      .query(
        `
          SELECT
            memory_id AS memoryID,
            subject,
            predicate,
            object,
            memory_kind AS memoryKind,
            semantic_layer AS semanticLayer,
            domain,
            confidence,
            source_message_id AS sourceMessageID,
            updated_at AS updatedAt
          FROM long_term_graph
          WHERE
            confidence >= ?1
            AND (?2 = '' OR semantic_layer = ?2)
            AND (?3 = '' OR domain = ?3)
            AND (
              subject LIKE ?4
              OR predicate LIKE ?4
              OR object LIKE ?4
            )
          ORDER BY confidence DESC, updated_at DESC
          LIMIT ?5
        `,
      )
      .all(minConfidence, layer, domain, like, safeLimit * 4) as Array<
      Omit<CompanionMemoryGraphEdge, 'score'> & { confidence?: number }
    >;
    const tokens = tokenize(text);
    return rows
      .map((row) => {
        const confidence = Number(row.confidence ?? 0.5);
        const lexical = overlapScore(
          tokens,
          `${row.subject} ${row.predicate} ${row.object}`,
        );
        const score = Number((0.55 * lexical + 0.45 * confidence).toFixed(4));
        return {
          ...row,
          semanticLayer: String(row.semanticLayer ?? 'episodic'),
          domain: String(row.domain ?? 'relationship'),
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
            semantic_layer AS semanticLayer,
            domain,
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
      semanticLayer: String(row.semanticLayer ?? 'episodic'),
      domain: String(row.domain ?? 'relationship'),
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
  byLayer: Record<string, number>;
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
      .get() as {
      edgeCount?: number;
      avgConfidence?: number;
      updatedAt?: string;
    } | null;
    const layerRows = db
      .query(
        `
          SELECT semantic_layer AS layer, COUNT(1) AS c
          FROM long_term_graph
          GROUP BY semantic_layer
        `,
      )
      .all() as Array<{ layer?: string; c?: number }>;
    const byLayer: Record<string, number> = {};
    for (const item of layerRows) {
      byLayer[String(item.layer ?? 'unknown')] = Number(item.c ?? 0);
    }
    return {
      sqlitePath: sqlitePath(projectDir),
      edgeCount: Number(row?.edgeCount ?? 0),
      avgConfidence: Number(Number(row?.avgConfidence ?? 0).toFixed(4)),
      byLayer,
      updatedAt: row?.updatedAt,
    };
  } finally {
    try {
      db?.close();
    } catch {}
  }
}
