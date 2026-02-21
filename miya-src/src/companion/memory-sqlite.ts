import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import type {
  CompanionMemoryCorrection,
  CompanionMemoryVector,
  MemoryEvidenceRef,
  MemoryQuoteSpan,
  MemoryShortTermLog,
} from './memory-types';

const require = createRequire(import.meta.url);

interface SqlStatement {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

interface SqlDatabase {
  exec: (sql: string) => unknown;
  query: (sql: string) => SqlStatement;
  transaction: <T extends (...args: any[]) => unknown>(fn: T) => T;
  close: () => void;
}

function createSqlDatabase(file: string): SqlDatabase {
  try {
    const bunSqlite = require('bun:sqlite') as {
      Database: new (
        dbPath: string,
        options?: { create?: boolean; strict?: boolean },
      ) => SqlDatabase;
    };
    return new bunSqlite.Database(file, { create: true, strict: false });
  } catch {}

  try {
    const nodeSqlite = require('node:sqlite') as {
      DatabaseSync: new (
        dbPath: string,
      ) => {
        exec: (sql: string) => unknown;
        prepare: (sql: string) => {
          run: (...params: unknown[]) => unknown;
          get: (...params: unknown[]) => unknown;
          all: (...params: unknown[]) => unknown[];
        };
        close: () => void;
      };
    };
    const nodeDb = new nodeSqlite.DatabaseSync(file);
    const tx = <T extends (...args: any[]) => unknown>(fn: T): T =>
      ((...args: Parameters<T>) => {
        nodeDb.exec('BEGIN');
        try {
          const result = fn(...args);
          nodeDb.exec('COMMIT');
          return result;
        } catch (error) {
          try {
            nodeDb.exec('ROLLBACK');
          } catch {}
          throw error;
        }
      }) as T;
    return {
      exec: (sql: string) => nodeDb.exec(sql),
      query: (sql: string) => {
        const stmt = nodeDb.prepare(sql);
        return {
          run: (...params: unknown[]) => stmt.run(...params),
          get: (...params: unknown[]) => stmt.get(...params),
          all: (...params: unknown[]) => stmt.all(...params),
        };
      },
      transaction: tx,
      close: () => nodeDb.close(),
    };
  } catch {}

  throw new Error('sqlite_runtime_unavailable');
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function textToEmbeddingLite(text: string, dims = 96): number[] {
  const vec = new Array<number>(dims).fill(0);
  const parts = normalizeText(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (parts.length === 0) return vec;
  for (const part of parts) {
    let hash = 0;
    for (let i = 0; i < part.length; i += 1) {
      hash = (hash * 31 + part.charCodeAt(i)) >>> 0;
    }
    for (let i = 0; i < 8; i += 1) {
      const idx = (hash + i * 17) % dims;
      vec[idx] += 1 + ((hash >>> (i % 16)) & 0x3);
    }
  }
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0));
  if (norm <= 0) return vec;
  return vec.map((value) => value / norm);
}

function memoryDir(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'memory');
}

function sqlitePath(projectDir: string): string {
  return path.join(memoryDir(projectDir), 'memories.sqlite');
}

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function ensureSchema(db: SqlDatabase): void {
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA synchronous=NORMAL;');
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec('PRAGMA busy_timeout=5000;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS mem_cells (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL DEFAULT 'work',
      kind TEXT NOT NULL DEFAULT 'Fact',
      subject TEXT NOT NULL DEFAULT 'User',
      predicate TEXT NOT NULL DEFAULT 'fact',
      object TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      polarity TEXT NOT NULL DEFAULT 'neutral',
      confidence REAL NOT NULL DEFAULT 0.5,
      tier TEXT NOT NULL DEFAULT 'L1',
      status TEXT NOT NULL DEFAULT 'candidate',
      conflict_key TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_message_id TEXT,
      evidence_ref_json TEXT,
      score REAL NOT NULL DEFAULT 1,
      embedding_json TEXT NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      conflict_wizard_id TEXT,
      superseded_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_corrections (
      id TEXT PRIMARY KEY,
      conflict_key TEXT NOT NULL,
      candidate_memory_id TEXT NOT NULL,
      existing_memory_ids_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS raw_logs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      at TEXT NOT NULL,
      message_hash TEXT NOT NULL UNIQUE,
      processed_at TEXT,
      processed_job_id TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_packs (
      audit_id TEXT PRIMARY KEY,
      meta_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      policy_hash TEXT,
      created_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mem_scenes (
      scene_id TEXT PRIMARY KEY,
      domain TEXT NOT NULL DEFAULT 'work',
      title TEXT NOT NULL,
      summary_l0 TEXT NOT NULL DEFAULT '[]',
      summary_l1 TEXT NOT NULL DEFAULT '',
      vec_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memscene_cells (
      scene_id TEXT NOT NULL,
      cell_id TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      PRIMARY KEY(scene_id, cell_id),
      FOREIGN KEY(scene_id) REFERENCES mem_scenes(scene_id) ON DELETE CASCADE,
      FOREIGN KEY(cell_id) REFERENCES mem_cells(id) ON DELETE CASCADE
    );
  `);

  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_mem_cells_status_domain ON mem_cells(status, domain);',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_mem_cells_conflict_key ON mem_cells(conflict_key);',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_raw_logs_processed ON raw_logs(processed_at, at);',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_memory_events_created ON memory_events(created_at);',
  );

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS mem_cells_fts USING fts5(
        text,
        content='mem_cells',
        content_rowid='rowid'
      );
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS mem_cells_ai AFTER INSERT ON mem_cells BEGIN
        INSERT INTO mem_cells_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS mem_cells_ad AFTER DELETE ON mem_cells BEGIN
        INSERT INTO mem_cells_fts(mem_cells_fts, rowid, text) VALUES('delete', old.rowid, old.text);
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS mem_cells_au AFTER UPDATE ON mem_cells BEGIN
        INSERT INTO mem_cells_fts(mem_cells_fts, rowid, text) VALUES('delete', old.rowid, old.text);
        INSERT INTO mem_cells_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
    `);
  } catch {
    // FTS5 may be unavailable in some builds. Retrieval falls back to vector/scan.
  }
}

function openDatabase(projectDir: string): SqlDatabase {
  fs.mkdirSync(memoryDir(projectDir), { recursive: true });
  const db = createSqlDatabase(sqlitePath(projectDir));
  ensureSchema(db);
  return db;
}

function rowToMemory(row: Record<string, unknown>): CompanionMemoryVector {
  return {
    id: String(row.id ?? ''),
    text: String(row.text ?? ''),
    memoryKind:
      row.kind === 'Fact' ||
      row.kind === 'Insight' ||
      row.kind === 'UserPreference'
        ? (row.kind as 'Fact' | 'Insight' | 'UserPreference')
        : undefined,
    source: String(row.source ?? 'manual'),
    embedding: safeJsonParse<number[]>(row.embedding_json, []),
    score: Number(row.score ?? 1),
    confidence: Number(row.confidence ?? 0.5),
    tier: String(row.tier ?? 'L1') as CompanionMemoryVector['tier'],
    domain:
      row.domain === 'work' ||
      row.domain === 'relationship' ||
      row.domain === 'personal' ||
      row.domain === 'system'
        ? (row.domain as CompanionMemoryVector['domain'])
        : 'work',
    subject: String(row.subject ?? 'User'),
    predicate: String(row.predicate ?? 'fact'),
    object: String(row.object ?? ''),
    polarity:
      row.polarity === 'positive' ||
      row.polarity === 'negative' ||
      row.polarity === 'neutral'
        ? (row.polarity as 'positive' | 'negative' | 'neutral')
        : 'neutral',
    sourceMessageID:
      typeof row.source_message_id === 'string' && row.source_message_id.trim()
        ? String(row.source_message_id)
        : undefined,
    sourceType:
      row.source_type === 'manual' ||
      row.source_type === 'conversation' ||
      row.source_type === 'reflect' ||
      row.source_type === 'direct_correction'
        ? (row.source_type as CompanionMemoryVector['sourceType'])
        : 'manual',
    status: String(
      row.status ?? 'candidate',
    ) as CompanionMemoryVector['status'],
    conflictKey:
      typeof row.conflict_key === 'string' && row.conflict_key.trim()
        ? String(row.conflict_key)
        : undefined,
    conflictWizardID:
      typeof row.conflict_wizard_id === 'string' &&
      row.conflict_wizard_id.trim()
        ? String(row.conflict_wizard_id)
        : undefined,
    supersededBy:
      typeof row.superseded_by === 'string' && row.superseded_by.trim()
        ? String(row.superseded_by)
        : undefined,
    evidenceRef: safeJsonParse<MemoryEvidenceRef | undefined>(
      row.evidence_ref_json,
      undefined,
    ),
    accessCount: Number(row.access_count ?? 0),
    isArchived: Number(row.is_archived ?? 0) === 1,
    createdAt: String(row.created_at ?? nowIso()),
    updatedAt: String(row.updated_at ?? nowIso()),
    lastAccessedAt: String(row.last_accessed_at ?? nowIso()),
  };
}

function rowToCorrection(
  row: Record<string, unknown>,
): CompanionMemoryCorrection {
  return {
    id: String(row.id ?? ''),
    conflictKey: String(row.conflict_key ?? ''),
    candidateMemoryID: String(row.candidate_memory_id ?? ''),
    existingMemoryIDs: safeJsonParse<string[]>(
      row.existing_memory_ids_json,
      [],
    ),
    status:
      row.status === 'resolved' || row.status === 'rejected'
        ? (row.status as 'resolved' | 'rejected')
        : 'pending',
    createdAt: String(row.created_at ?? nowIso()),
    updatedAt: String(row.updated_at ?? nowIso()),
  };
}

export function withMemoryDb<T>(
  projectDir: string,
  fn: (db: SqlDatabase) => T,
): T {
  let db: SqlDatabase | null = null;
  try {
    db = openDatabase(projectDir);
    return fn(db);
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

export function listMemoryCells(projectDir: string): CompanionMemoryVector[] {
  return withMemoryDb(projectDir, (db) => {
    const rows = db
      .query(
        'SELECT * FROM mem_cells ORDER BY datetime(updated_at) DESC, id DESC',
      )
      .all() as Record<string, unknown>[];
    return rows.map(rowToMemory);
  });
}

export function getMemoryCell(
  projectDir: string,
  id: string,
): CompanionMemoryVector | null {
  return withMemoryDb(projectDir, (db) => {
    const row = db.query('SELECT * FROM mem_cells WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToMemory(row) : null;
  });
}

export function upsertMemoryCell(
  projectDir: string,
  item: CompanionMemoryVector,
): CompanionMemoryVector {
  return withMemoryDb(projectDir, (db) => {
    db.query(`
      INSERT INTO mem_cells (
        id, domain, kind, subject, predicate, object, text, polarity, confidence, tier, status,
        conflict_key, source, source_type, source_message_id, evidence_ref_json, score, embedding_json,
        access_count, is_archived, conflict_wizard_id, superseded_by, created_at, updated_at, last_accessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        domain=excluded.domain,
        kind=excluded.kind,
        subject=excluded.subject,
        predicate=excluded.predicate,
        object=excluded.object,
        text=excluded.text,
        polarity=excluded.polarity,
        confidence=excluded.confidence,
        tier=excluded.tier,
        status=excluded.status,
        conflict_key=excluded.conflict_key,
        source=excluded.source,
        source_type=excluded.source_type,
        source_message_id=excluded.source_message_id,
        evidence_ref_json=excluded.evidence_ref_json,
        score=excluded.score,
        embedding_json=excluded.embedding_json,
        access_count=excluded.access_count,
        is_archived=excluded.is_archived,
        conflict_wizard_id=excluded.conflict_wizard_id,
        superseded_by=excluded.superseded_by,
        created_at=excluded.created_at,
        updated_at=excluded.updated_at,
        last_accessed_at=excluded.last_accessed_at
    `).run(
      item.id,
      item.domain ?? 'work',
      item.memoryKind ?? 'Fact',
      item.subject ?? 'User',
      item.predicate ?? 'fact',
      item.object ?? '',
      item.text,
      item.polarity ?? 'neutral',
      item.confidence,
      item.tier,
      item.status,
      item.conflictKey ?? null,
      item.source,
      item.sourceType ?? 'manual',
      item.sourceMessageID ?? null,
      item.evidenceRef ? JSON.stringify(item.evidenceRef) : null,
      item.score,
      JSON.stringify(item.embedding),
      item.accessCount,
      item.isArchived ? 1 : 0,
      item.conflictWizardID ?? null,
      item.supersededBy ?? null,
      item.createdAt,
      item.updatedAt,
      item.lastAccessedAt,
    );
    return getMemoryCell(projectDir, item.id) ?? item;
  });
}

export function upsertMemoryCells(
  projectDir: string,
  items: CompanionMemoryVector[],
): void {
  withMemoryDb(projectDir, (db) => {
    const run = db.transaction(() => {
      const stmt = db.query(`
        INSERT INTO mem_cells (
          id, domain, kind, subject, predicate, object, text, polarity, confidence, tier, status,
          conflict_key, source, source_type, source_message_id, evidence_ref_json, score, embedding_json,
          access_count, is_archived, conflict_wizard_id, superseded_by, created_at, updated_at, last_accessed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          domain=excluded.domain,
          kind=excluded.kind,
          subject=excluded.subject,
          predicate=excluded.predicate,
          object=excluded.object,
          text=excluded.text,
          polarity=excluded.polarity,
          confidence=excluded.confidence,
          tier=excluded.tier,
          status=excluded.status,
          conflict_key=excluded.conflict_key,
          source=excluded.source,
          source_type=excluded.source_type,
          source_message_id=excluded.source_message_id,
          evidence_ref_json=excluded.evidence_ref_json,
          score=excluded.score,
          embedding_json=excluded.embedding_json,
          access_count=excluded.access_count,
          is_archived=excluded.is_archived,
          conflict_wizard_id=excluded.conflict_wizard_id,
          superseded_by=excluded.superseded_by,
          created_at=excluded.created_at,
          updated_at=excluded.updated_at,
          last_accessed_at=excluded.last_accessed_at
      `);
      for (const item of items) {
        stmt.run(
          item.id,
          item.domain ?? 'work',
          item.memoryKind ?? 'Fact',
          item.subject ?? 'User',
          item.predicate ?? 'fact',
          item.object ?? '',
          item.text,
          item.polarity ?? 'neutral',
          item.confidence,
          item.tier,
          item.status,
          item.conflictKey ?? null,
          item.source,
          item.sourceType ?? 'manual',
          item.sourceMessageID ?? null,
          item.evidenceRef ? JSON.stringify(item.evidenceRef) : null,
          item.score,
          JSON.stringify(item.embedding),
          item.accessCount,
          item.isArchived ? 1 : 0,
          item.conflictWizardID ?? null,
          item.supersededBy ?? null,
          item.createdAt,
          item.updatedAt,
          item.lastAccessedAt,
        );
      }
    });
    run();
  });
}

export function listMemoryCorrections(
  projectDir: string,
): CompanionMemoryCorrection[] {
  return withMemoryDb(projectDir, (db) => {
    const rows = db
      .query(
        'SELECT * FROM memory_corrections ORDER BY datetime(updated_at) DESC, id DESC',
      )
      .all() as Record<string, unknown>[];
    return rows.map(rowToCorrection);
  });
}

export function upsertMemoryCorrection(
  projectDir: string,
  correction: CompanionMemoryCorrection,
): CompanionMemoryCorrection {
  return withMemoryDb(projectDir, (db) => {
    db.query(`
      INSERT INTO memory_corrections (
        id, conflict_key, candidate_memory_id, existing_memory_ids_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        conflict_key=excluded.conflict_key,
        candidate_memory_id=excluded.candidate_memory_id,
        existing_memory_ids_json=excluded.existing_memory_ids_json,
        status=excluded.status,
        created_at=excluded.created_at,
        updated_at=excluded.updated_at
    `).run(
      correction.id,
      correction.conflictKey,
      correction.candidateMemoryID,
      JSON.stringify(correction.existingMemoryIDs),
      correction.status,
      correction.createdAt,
      correction.updatedAt,
    );
    const row = db
      .query('SELECT * FROM memory_corrections WHERE id = ?')
      .get(correction.id) as Record<string, unknown> | undefined;
    return row ? rowToCorrection(row) : correction;
  });
}

export function appendRawMemoryLog(
  projectDir: string,
  row: MemoryShortTermLog,
): MemoryShortTermLog | null {
  return withMemoryDb(projectDir, (db) => {
    try {
      db.query(`
        INSERT INTO raw_logs (id, session_id, sender, text, at, message_hash, processed_at, processed_job_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id,
        row.sessionID,
        row.sender,
        row.text,
        row.at,
        row.messageHash,
        row.processedAt ?? null,
        null,
      );
      return row;
    } catch {
      const existing = db
        .query('SELECT * FROM raw_logs WHERE message_hash = ? LIMIT 1')
        .get(row.messageHash) as Record<string, unknown> | undefined;
      if (!existing) return null;
      return null;
    }
  });
}

export function listRawMemoryLogs(
  projectDir: string,
  options?: { pendingOnly?: boolean; limit?: number },
): MemoryShortTermLog[] {
  return withMemoryDb(projectDir, (db) => {
    const limit = Math.max(1, Math.min(1000, options?.limit ?? 200));
    const sql = options?.pendingOnly
      ? 'SELECT * FROM raw_logs WHERE processed_at IS NULL ORDER BY datetime(at) ASC LIMIT ?'
      : 'SELECT * FROM raw_logs ORDER BY datetime(at) DESC LIMIT ?';
    const rows = db.query(sql).all(limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id ?? ''),
      sessionID: String(row.session_id ?? 'main'),
      sender:
        row.sender === 'assistant' || row.sender === 'system'
          ? (row.sender as 'assistant' | 'system')
          : 'user',
      text: String(row.text ?? ''),
      at: String(row.at ?? nowIso()),
      messageHash: String(row.message_hash ?? ''),
      processedAt:
        typeof row.processed_at === 'string' && row.processed_at.trim()
          ? String(row.processed_at)
          : undefined,
    }));
  });
}

export function markRawLogsProcessed(
  projectDir: string,
  logIDs: string[],
  jobID: string,
  processedAt = nowIso(),
): number {
  if (logIDs.length === 0) return 0;
  return withMemoryDb(projectDir, (db) => {
    const tx = db.transaction(() => {
      const stmt = db.query(
        'UPDATE raw_logs SET processed_at = ?, processed_job_id = ? WHERE id = ?',
      );
      let touched = 0;
      for (const id of logIDs) {
        stmt.run(processedAt, jobID, id);
        touched += 1;
      }
      return touched;
    });
    return tx();
  });
}

export function appendMemoryEvent(
  projectDir: string,
  input: {
    eventID: string;
    eventType: string;
    entityType: string;
    entityID: string;
    payload: unknown;
    policyHash?: string;
    createdAt?: string;
  },
): void {
  withMemoryDb(projectDir, (db) => {
    db.query(`
      INSERT OR IGNORE INTO memory_events (
        event_id, event_type, entity_type, entity_id, payload_json, policy_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.eventID,
      input.eventType,
      input.entityType,
      input.entityID,
      JSON.stringify(input.payload ?? {}),
      input.policyHash ?? null,
      input.createdAt ?? nowIso(),
    );
  });
}

export function listMemoryEvents(
  projectDir: string,
  options?: { since?: string; limit?: number },
): Array<{
  eventID: string;
  eventType: string;
  entityType: string;
  entityID: string;
  payload: unknown;
  policyHash?: string;
  createdAt: string;
}> {
  return withMemoryDb(projectDir, (db) => {
    const limit = Math.max(1, Math.min(2000, options?.limit ?? 200));
    let rows: Record<string, unknown>[];
    if (options?.since) {
      rows = db
        .query(
          `SELECT event_id, event_type, entity_type, entity_id, payload_json, policy_hash, created_at
           FROM memory_events
           WHERE datetime(created_at) >= datetime(?)
           ORDER BY seq ASC
           LIMIT ?`,
        )
        .all(options.since, limit) as Record<string, unknown>[];
    } else {
      rows = db
        .query(
          `SELECT event_id, event_type, entity_type, entity_id, payload_json, policy_hash, created_at
           FROM memory_events
           ORDER BY seq DESC
           LIMIT ?`,
        )
        .all(limit) as Record<string, unknown>[];
      rows.reverse();
    }
    return rows.map((row) => ({
      eventID: String(row.event_id ?? ''),
      eventType: String(row.event_type ?? ''),
      entityType: String(row.entity_type ?? ''),
      entityID: String(row.entity_id ?? ''),
      payload: safeJsonParse(row.payload_json, {}),
      policyHash:
        typeof row.policy_hash === 'string' && row.policy_hash.trim()
          ? String(row.policy_hash)
          : undefined,
      createdAt: String(row.created_at ?? nowIso()),
    }));
  });
}

export function upsertEvidencePack(
  projectDir: string,
  input: {
    auditID: string;
    meta: Record<string, unknown>;
    payload: Record<string, unknown>;
    createdAt?: string;
  },
): void {
  withMemoryDb(projectDir, (db) => {
    db.query(`
      INSERT INTO evidence_packs (audit_id, meta_json, payload_json, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(audit_id) DO UPDATE SET
        meta_json=excluded.meta_json,
        payload_json=excluded.payload_json,
        created_at=excluded.created_at
    `).run(
      input.auditID,
      JSON.stringify(input.meta ?? {}),
      JSON.stringify(input.payload ?? {}),
      input.createdAt ?? nowIso(),
    );
  });
}

export interface ReflectCandidateInput {
  kind: 'Fact' | 'Insight' | 'UserPreference';
  subject: 'User' | 'Miya';
  predicate: string;
  object: string;
  confidence: number;
  tier: 'L0' | 'L1' | 'L2';
  domain: 'work' | 'relationship' | 'personal' | 'system';
  sourceLogID: string;
  quotes: MemoryQuoteSpan[];
}

export function constructReflectBatch(
  projectDir: string,
  input: {
    jobID: string;
    auditID: string;
    processedAt: string;
    policyHash?: string;
    pickedLogs: MemoryShortTermLog[];
    triplets: ReflectCandidateInput[];
    evidenceMeta: Record<string, unknown>;
    evidencePayload: Record<string, unknown>;
    reflectStats?: {
      generatedFacts: number;
      generatedInsights: number;
      generatedPreferences: number;
    };
  },
): { createdMemories: CompanionMemoryVector[]; processedLogs: number } {
  return withMemoryDb(projectDir, (db) => {
    const createdMemories: CompanionMemoryVector[] = [];
    const tx = db.transaction(() => {
      db.query(`
        INSERT INTO evidence_packs (audit_id, meta_json, payload_json, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(audit_id) DO UPDATE SET
          meta_json=excluded.meta_json,
          payload_json=excluded.payload_json,
          created_at=excluded.created_at
      `).run(
        input.auditID,
        JSON.stringify(input.evidenceMeta ?? {}),
        JSON.stringify(input.evidencePayload ?? {}),
        input.processedAt,
      );

      const memoryInsert = db.query(`
        INSERT INTO mem_cells (
          id, domain, kind, subject, predicate, object, text, polarity, confidence, tier, status,
          conflict_key, source, source_type, source_message_id, evidence_ref_json, score, embedding_json,
          access_count, is_archived, conflict_wizard_id, superseded_by, created_at, updated_at, last_accessed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const eventInsert = db.query(`
        INSERT OR IGNORE INTO memory_events (
          event_id, event_type, entity_type, entity_id, payload_json, policy_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const triplet of input.triplets) {
        const id = `mem_${Math.random().toString(36).slice(2, 10)}_${Math.random().toString(36).slice(2, 10)}`;
        const text =
          `${triplet.subject} ${triplet.predicate} ${triplet.object}`.trim();
        const embedding = textToEmbeddingLite(text);
        const evidenceRef: MemoryEvidenceRef = {
          auditID: input.auditID,
          sourceLogIDs: [triplet.sourceLogID],
          quoteSpans: triplet.quotes,
        };
        const record: CompanionMemoryVector = {
          id,
          text,
          memoryKind: triplet.kind,
          source: 'reflect',
          embedding,
          score: 1,
          confidence: triplet.confidence,
          tier: triplet.tier,
          domain: triplet.domain,
          subject: triplet.subject,
          predicate: triplet.predicate,
          object: triplet.object,
          polarity: 'neutral',
          sourceMessageID: triplet.sourceLogID,
          sourceType: 'reflect',
          status: 'candidate',
          conflictKey: undefined,
          conflictWizardID: undefined,
          supersededBy: undefined,
          evidenceRef,
          accessCount: 0,
          isArchived: false,
          createdAt: input.processedAt,
          updatedAt: input.processedAt,
          lastAccessedAt: input.processedAt,
        };
        memoryInsert.run(
          record.id,
          record.domain ?? 'work',
          record.memoryKind ?? 'Fact',
          record.subject ?? 'User',
          record.predicate ?? 'fact',
          record.object ?? '',
          record.text,
          record.polarity ?? 'neutral',
          record.confidence,
          record.tier,
          record.status,
          null,
          record.source,
          record.sourceType ?? 'reflect',
          record.sourceMessageID ?? null,
          JSON.stringify(record.evidenceRef),
          record.score,
          JSON.stringify(record.embedding),
          record.accessCount,
          record.isArchived ? 1 : 0,
          null,
          null,
          record.createdAt,
          record.updatedAt,
          record.lastAccessedAt,
        );
        eventInsert.run(
          `evt_${record.id}`,
          'memory_candidate_created',
          'mem_cell',
          record.id,
          JSON.stringify({
            status: record.status,
            sourceType: record.sourceType,
            source: 'reflect',
            hasEvidence: true,
          }),
          input.policyHash ?? null,
          input.processedAt,
        );
        createdMemories.push(record);
      }

      const markStmt = db.query(
        'UPDATE raw_logs SET processed_at = ?, processed_job_id = ? WHERE id = ?',
      );
      for (const row of input.pickedLogs) {
        markStmt.run(input.processedAt, input.jobID, row.id);
      }

      eventInsert.run(
        `evt_${input.jobID}`,
        'reflect_completed',
        'reflect_job',
        input.jobID,
        JSON.stringify({
          auditID: input.auditID,
          processedLogs: input.pickedLogs.length,
          generatedTriplets: input.triplets.length,
          generatedFacts: input.reflectStats?.generatedFacts ?? 0,
          generatedInsights: input.reflectStats?.generatedInsights ?? 0,
          generatedPreferences: input.reflectStats?.generatedPreferences ?? 0,
        }),
        input.policyHash ?? null,
        input.processedAt,
      );
    });
    tx();
    return {
      createdMemories,
      processedLogs: input.pickedLogs.length,
    };
  });
}

export function getEvidencePack(
  projectDir: string,
  auditID: string,
): {
  auditID: string;
  meta: Record<string, unknown>;
  payload: Record<string, unknown>;
  createdAt: string;
} | null {
  return withMemoryDb(projectDir, (db) => {
    const row = db
      .query(
        'SELECT audit_id, meta_json, payload_json, created_at FROM evidence_packs WHERE audit_id = ?',
      )
      .get(auditID) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      auditID: String(row.audit_id ?? ''),
      meta: safeJsonParse<Record<string, unknown>>(row.meta_json, {}),
      payload: safeJsonParse<Record<string, unknown>>(row.payload_json, {}),
      createdAt: String(row.created_at ?? nowIso()),
    };
  });
}

export function buildMemoryPack(
  projectDir: string,
  input: {
    query: string;
    domain?: 'work' | 'relationship' | 'personal' | 'system';
    mode?: 'execution' | 'response' | 'audit';
    l0Limit?: number;
    l1Limit?: number;
  },
): {
  l0: string[];
  l1: Array<{ text: string; confidence: number; at: string }>;
  l2: string[];
} {
  const domain = input.domain ?? 'work';
  const mode = input.mode ?? 'execution';
  const l0Limit = Math.max(1, Math.min(20, input.l0Limit ?? 10));
  const l1Limit = Math.max(1, Math.min(30, input.l1Limit ?? 12));
  return withMemoryDb(projectDir, (db) => {
    const queryText = input.query.trim();
    const candidates = db
      .query(
        `SELECT id, text, confidence, tier, updated_at, evidence_ref_json
         FROM mem_cells
         WHERE status = 'active' AND is_archived = 0 AND domain = ?
         ORDER BY datetime(last_accessed_at) DESC, score DESC
         LIMIT 100`,
      )
      .all(domain) as Record<string, unknown>[];

    const filtered = queryText
      ? candidates.filter((row) =>
          String(row.text ?? '')
            .toLowerCase()
            .includes(queryText.toLowerCase()),
        )
      : candidates;
    const base = (filtered.length > 0 ? filtered : candidates).slice(0, 100);

    const l0 = base
      .filter((row) => String(row.tier ?? 'L1') === 'L0')
      .slice(0, l0Limit)
      .map((row) => String(row.text ?? ''));

    const l1 = base
      .filter((row) => String(row.tier ?? 'L1') !== 'L0')
      .slice(0, l1Limit)
      .map((row) => ({
        text: String(row.text ?? ''),
        confidence: Number(row.confidence ?? 0.5),
        at: String(row.updated_at ?? nowIso()),
      }));

    const l2 = base
      .map((row) =>
        safeJsonParse<MemoryEvidenceRef | undefined>(
          row.evidence_ref_json,
          undefined,
        ),
      )
      .filter((item): item is MemoryEvidenceRef => Boolean(item?.auditID))
      .map((item) => `miya://audit/evidence/${item.auditID}`);

    const uniqueL2 = Array.from(new Set(l2));
    if (mode === 'execution') {
      // Perception path hard guard: execution agent only receives L0 constraints.
      return { l0, l1: [], l2: [] };
    }
    if (mode === 'response') {
      return { l0, l1, l2: uniqueL2.slice(0, 6) };
    }
    return { l0, l1, l2: uniqueL2 };
  });
}

function buildMemoryProfile(
  projectDir: string,
  domain?: 'work' | 'relationship' | 'personal' | 'system',
): {
  activeCount: number;
  candidateCount: number;
  topConstraints: string[];
} {
  const rows = listMemoryCells(projectDir).filter((row) =>
    domain ? row.domain === domain : true,
  );
  const active = rows.filter(
    (row) => row.status === 'active' && !row.isArchived,
  );
  const candidates = rows.filter(
    (row) => row.status === 'candidate' || row.status === 'pending',
  );
  const topConstraints = active
    .filter((row) => row.tier === 'L0')
    .slice(0, 12)
    .map((row) => row.text);
  return {
    activeCount: active.length,
    candidateCount: candidates.length,
    topConstraints,
  };
}

export function resolveContextFsUri(
  projectDir: string,
  uri: string,
): Record<string, unknown> | null {
  const target = String(uri || '').trim();
  if (!target.startsWith('miya://')) return null;

  if (target.startsWith('miya://mem/cell/')) {
    const id = target.slice('miya://mem/cell/'.length);
    const cell = getMemoryCell(projectDir, id);
    return cell ? { uri: target, data: cell } : null;
  }

  if (target.startsWith('miya://audit/evidence/')) {
    const auditID = target.slice('miya://audit/evidence/'.length);
    const pack = getEvidencePack(projectDir, auditID);
    return pack ? { uri: target, data: pack } : null;
  }

  if (target.startsWith('miya://audit/events')) {
    const question = target.split('?')[1] ?? '';
    const params = new URLSearchParams(question);
    const since = params.get('since') || undefined;
    const limitValue = Number(params.get('limit') ?? '200');
    const limit = Number.isFinite(limitValue)
      ? Math.max(1, Math.min(2000, limitValue))
      : 200;
    return {
      uri: target,
      data: listMemoryEvents(projectDir, { since, limit }),
    };
  }

  if (target.startsWith('miya://mem/query')) {
    const question = target.split('?')[1] ?? '';
    const params = new URLSearchParams(question);
    const domain = params.get('domain') || undefined;
    const status = params.get('status') || undefined;
    const tier = params.get('tier') || undefined;
    const rows = listMemoryCells(projectDir).filter((item) => {
      if (domain && item.domain !== domain) return false;
      if (status && item.status !== status) return false;
      if (tier && item.tier !== tier) return false;
      return true;
    });
    return { uri: target, data: rows };
  }

  if (target.startsWith('miya://mem/profile')) {
    const question = target.split('?')[1] ?? '';
    const params = new URLSearchParams(question);
    const domainRaw = params.get('domain');
    const domain =
      domainRaw === 'work' ||
      domainRaw === 'relationship' ||
      domainRaw === 'personal' ||
      domainRaw === 'system'
        ? domainRaw
        : undefined;
    return {
      uri: target,
      data: buildMemoryProfile(projectDir, domain),
    };
  }

  if (target.startsWith('miya://mem/scenes/')) {
    const sceneID = target.slice('miya://mem/scenes/'.length).trim();
    if (!sceneID) return null;
    return withMemoryDb(projectDir, (db) => {
      const scene = db
        .query(
          'SELECT scene_id, domain, title, summary_l0, summary_l1, updated_at FROM mem_scenes WHERE scene_id = ?',
        )
        .get(sceneID) as Record<string, unknown> | undefined;
      if (!scene) return null;
      const cells = db
        .query(
          `SELECT c.* FROM memscene_cells mc
           JOIN mem_cells c ON c.id = mc.cell_id
           WHERE mc.scene_id = ?
           ORDER BY mc.weight DESC, datetime(c.updated_at) DESC`,
        )
        .all(sceneID) as Record<string, unknown>[];
      return {
        uri: target,
        data: {
          sceneID: String(scene.scene_id ?? ''),
          domain: String(scene.domain ?? 'work'),
          title: String(scene.title ?? ''),
          summaryL0: safeJsonParse<string[]>(scene.summary_l0, []),
          summaryL1: String(scene.summary_l1 ?? ''),
          updatedAt: String(scene.updated_at ?? nowIso()),
          cells: cells.map(rowToMemory),
        },
      };
    });
  }

  return null;
}

export function getCompanionMemorySqliteStats(projectDir: string): {
  sqlitePath: string;
  memoryCount: number;
  candidateCount: number;
  activeCount: number;
  vectorCount: number;
  graphCount: number;
  rawLogCount: number;
  pendingRawLogCount: number;
  evidenceCount: number;
  eventCount: number;
} {
  const dbPath = sqlitePath(projectDir);
  return withMemoryDb(projectDir, (db) => {
    const memoryCount = Number(
      (
        db.query('SELECT COUNT(1) AS c FROM mem_cells').get() as {
          c?: number;
        } | null
      )?.c ?? 0,
    );
    const candidateCount = Number(
      (
        db
          .query(
            "SELECT COUNT(1) AS c FROM mem_cells WHERE status IN ('candidate','pending')",
          )
          .get() as {
          c?: number;
        } | null
      )?.c ?? 0,
    );
    const activeCount = Number(
      (
        db
          .query("SELECT COUNT(1) AS c FROM mem_cells WHERE status = 'active'")
          .get() as {
          c?: number;
        } | null
      )?.c ?? 0,
    );
    const rawLogCount = Number(
      (
        db.query('SELECT COUNT(1) AS c FROM raw_logs').get() as {
          c?: number;
        } | null
      )?.c ?? 0,
    );
    const pendingRawLogCount = Number(
      (
        db
          .query(
            'SELECT COUNT(1) AS c FROM raw_logs WHERE processed_at IS NULL',
          )
          .get() as {
          c?: number;
        } | null
      )?.c ?? 0,
    );
    const evidenceCount = Number(
      (
        db.query('SELECT COUNT(1) AS c FROM evidence_packs').get() as {
          c?: number;
        } | null
      )?.c ?? 0,
    );
    const eventCount = Number(
      (
        db.query('SELECT COUNT(1) AS c FROM memory_events').get() as {
          c?: number;
        } | null
      )?.c ?? 0,
    );

    return {
      sqlitePath: dbPath,
      memoryCount,
      candidateCount,
      activeCount,
      vectorCount: memoryCount,
      graphCount: memoryCount,
      rawLogCount,
      pendingRawLogCount,
      evidenceCount,
      eventCount,
    };
  });
}

// Deprecated no-op: kept for compatibility with older callers.
export function syncCompanionMemoriesToSqlite(
  _projectDir: string,
  _items: CompanionMemoryVector[],
): void {}
