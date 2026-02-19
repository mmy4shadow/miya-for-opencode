import { createRequire } from 'node:module';

export interface SqliteStatement {
  run: (...args: unknown[]) => unknown;
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
}

export interface SqliteDatabase {
  exec: (sql: string) => void;
  query: (sql: string) => SqliteStatement;
  transaction: (callback: () => void) => () => void;
  close: () => void;
}

interface SqliteBackend {
  open: (file: string) => SqliteDatabase;
}

let cachedBackend: SqliteBackend | null | undefined;

interface BunSqliteStatementLike {
  run: (...args: unknown[]) => unknown;
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
}

interface BunSqliteDatabaseLike {
  exec: (sql: string) => void;
  query: (sql: string) => BunSqliteStatementLike;
  transaction: (callback: () => void) => () => void;
  close: () => void;
}

interface NodeSqlitePreparedLike {
  run: (...args: unknown[]) => unknown;
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
}

interface NodeSqliteDatabaseLike {
  exec: (sql: string) => void;
  prepare: (sql: string) => NodeSqlitePreparedLike;
  close: () => void;
}

function resolveBunBackend(require: NodeRequire): SqliteBackend | null {
  try {
    const mod = require('bun:sqlite') as {
      Database?: new (file: string) => BunSqliteDatabaseLike;
    };
    const BunDatabase = mod?.Database;
    if (typeof BunDatabase !== 'function') return null;
    return {
      open(file: string): SqliteDatabase {
        const db = new BunDatabase(file);
        return {
          exec(sql: string) {
            db.exec(sql);
          },
          query(sql: string): SqliteStatement {
            const statement = db.query(sql);
            return {
              run: (...args: unknown[]) => statement.run(...args),
              get: (...args: unknown[]) => statement.get(...args),
              all: (...args: unknown[]) => statement.all(...args),
            };
          },
          transaction(callback: () => void): () => void {
            return db.transaction(callback);
          },
          close() {
            db.close();
          },
        };
      },
    };
  } catch {
    return null;
  }
}

function resolveNodeBackend(require: NodeRequire): SqliteBackend | null {
  try {
    const mod = require('node:sqlite') as {
      DatabaseSync?: new (file: string) => NodeSqliteDatabaseLike;
    };
    const DatabaseSync = mod?.DatabaseSync;
    if (typeof DatabaseSync !== 'function') return null;
    return {
      open(file: string): SqliteDatabase {
        const db = new DatabaseSync(file);
        return {
          exec(sql: string) {
            db.exec(sql);
          },
          query(sql: string): SqliteStatement {
            return {
              run: (...args: unknown[]) => db.prepare(sql).run(...args),
              get: (...args: unknown[]) => db.prepare(sql).get(...args),
              all: (...args: unknown[]) => db.prepare(sql).all(...args),
            };
          },
          transaction(callback: () => void): () => void {
            return () => {
              db.exec('BEGIN IMMEDIATE');
              try {
                callback();
                db.exec('COMMIT');
              } catch (error) {
                try {
                  db.exec('ROLLBACK');
                } catch {}
                throw error;
              }
            };
          },
          close() {
            db.close();
          },
        };
      },
    };
  } catch {
    return null;
  }
}

function resolveBackend(): SqliteBackend | null {
  if (cachedBackend !== undefined) return cachedBackend;
  const require = createRequire(import.meta.url);
  cachedBackend = resolveBunBackend(require) ?? resolveNodeBackend(require);
  return cachedBackend;
}

export function openSqliteDatabase(file: string): SqliteDatabase | null {
  const backend = resolveBackend();
  if (!backend) return null;
  try {
    return backend.open(file);
  } catch {
    return null;
  }
}
