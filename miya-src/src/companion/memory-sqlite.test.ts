import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildMemoryPack, getCompanionMemorySqliteStats, resolveContextFsUri, withMemoryDb } from './memory-sqlite';
import { upsertCompanionMemoryVector } from './memory-vector';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-memory-sqlite-test-'));
}

describe('companion memory sqlite sync', () => {
  test('syncs memory vectors into sqlite hot layer', () => {
    const projectDir = tempProjectDir();
    upsertCompanionMemoryVector(projectDir, {
      text: 'User likes TypeScript',
      source: 'test',
      activate: true,
      confidence: 0.9,
      tier: 'L2',
      sourceMessageID: 'msg-1',
    });
    upsertCompanionMemoryVector(projectDir, {
      text: 'User dislikes noisy logs',
      source: 'test',
      activate: false,
      confidence: 0.7,
      tier: 'L2',
      sourceMessageID: 'msg-2',
    });
    const stats = getCompanionMemorySqliteStats(projectDir);
    expect(stats.memoryCount).toBeGreaterThanOrEqual(2);
    expect(stats.vectorCount).toBeGreaterThanOrEqual(2);
    expect(stats.sqlitePath.endsWith('memories.sqlite')).toBe(true);
    expect(fs.existsSync(stats.sqlitePath)).toBe(true);
  });

  test('enforces L0-only pack for execution mode', () => {
    const projectDir = tempProjectDir();
    upsertCompanionMemoryVector(projectDir, {
      text: 'User prefers strict deterministic builds',
      source: 'test',
      activate: true,
      confidence: 0.99,
      tier: 'L0',
      sourceMessageID: 'msg-l0',
    });
    upsertCompanionMemoryVector(projectDir, {
      text: 'User likes explanatory responses with examples',
      source: 'test',
      activate: true,
      confidence: 0.8,
      tier: 'L1',
      sourceMessageID: 'msg-l1',
    });

    const execPack = buildMemoryPack(projectDir, {
      query: 'user preferences',
      mode: 'execution',
      domain: 'work',
    });
    expect(execPack.l0.length).toBeGreaterThan(0);
    expect(execPack.l1.length).toBe(0);
    expect(execPack.l2.length).toBe(0);

    const responsePack = buildMemoryPack(projectDir, {
      query: 'user preferences',
      mode: 'response',
      domain: 'work',
    });
    expect(responsePack.l1.length).toBeGreaterThan(0);
  });

  test('resolves contextfs profile and scene uri', () => {
    const projectDir = tempProjectDir();
    upsertCompanionMemoryVector(projectDir, {
      text: 'User prefers no proxy for localhost',
      source: 'test',
      activate: true,
      confidence: 0.98,
      tier: 'L0',
      sourceMessageID: 'msg-profile-1',
    });

    withMemoryDb(projectDir, (db) => {
      const now = new Date().toISOString();
      db.query(
        'INSERT INTO mem_scenes (scene_id, domain, title, summary_l0, summary_l1, vec_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('scene_runtime', 'work', 'Runtime Preferences', '["no_proxy localhost"]', 'runtime summary', '[]', now);
      const first = db
        .query('SELECT id FROM mem_cells ORDER BY datetime(updated_at) DESC LIMIT 1')
        .get() as { id?: string } | undefined;
      if (first?.id) {
        db.query('INSERT INTO memscene_cells (scene_id, cell_id, weight) VALUES (?, ?, ?)').run(
          'scene_runtime',
          first.id,
          1,
        );
      }
    });

    const profile = resolveContextFsUri(projectDir, 'miya://mem/profile?domain=work');
    expect(profile?.uri).toBe('miya://mem/profile?domain=work');
    expect(Array.isArray((profile?.data as { topConstraints?: string[] } | undefined)?.topConstraints)).toBe(true);

    const scene = resolveContextFsUri(projectDir, 'miya://mem/scenes/scene_runtime');
    expect(scene?.uri).toBe('miya://mem/scenes/scene_runtime');
    expect((scene?.data as { title?: string } | undefined)?.title).toBe('Runtime Preferences');
  });
});

