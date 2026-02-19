import { expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  appendToolActionLedgerEvent,
  listToolActionLedgerEvents,
} from '../../src/gateway/kernel/action-ledger';
import { getTestConfig } from '../config/test.config';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-action-ledger-bench-'));
}

interface BenchmarkRecord {
  elapsedMs: number;
  sampleSize: number;
  updatedAt: string;
}

interface BenchmarksFile {
  benchmarks: Record<string, BenchmarkRecord>;
}

const benchmarkKey = 'action_ledger_append_and_query_500';
const baselinePath = path.resolve(
  import.meta.dir,
  '..',
  'baselines',
  'benchmarks.json',
);

function readBenchmarks(): BenchmarksFile {
  if (!fs.existsSync(baselinePath)) {
    return { benchmarks: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf-8')) as
      | BenchmarksFile
      | undefined;
    if (!parsed || typeof parsed !== 'object') return { benchmarks: {} };
    const benchmarks =
      parsed.benchmarks && typeof parsed.benchmarks === 'object'
        ? parsed.benchmarks
        : {};
    return { benchmarks };
  } catch {
    return { benchmarks: {} };
  }
}

function writeBenchmarks(next: BenchmarksFile): void {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
}

test('performance benchmark: append and query 500 ledger events within budget', () => {
  const projectDir = tempProjectDir();
  const start = performance.now();
  for (let i = 0; i < 500; i += 1) {
    appendToolActionLedgerEvent(projectDir, {
      method: 'bench',
      clientID: 'perf',
      role: 'node',
      params: { i, nested: { v: i % 7 } },
      status: 'completed',
      result: { ok: true, i },
    });
  }
  const rows = listToolActionLedgerEvents(projectDir, 1000);
  const elapsedMs = performance.now() - start;

  expect(rows.length).toBe(500);
  expect(elapsedMs).toBeLessThan(12000);

  const testConfig = getTestConfig();
  const percent =
    Number(process.env.MIYA_PERF_REGRESSION_PERCENT ?? '') ||
    testConfig.performance.regressionThreshold;
  const noiseBufferMs = 1_000;
  const shouldUpdateBaseline = process.env.MIYA_UPDATE_BASELINES === '1';
  const file = readBenchmarks();
  const previous = file.benchmarks[benchmarkKey];
  if (!previous) {
    file.benchmarks[benchmarkKey] = {
      elapsedMs,
      sampleSize: 500,
      updatedAt: new Date().toISOString(),
    };
    writeBenchmarks(file);
    return;
  }

  if (shouldUpdateBaseline) {
    file.benchmarks[benchmarkKey] = {
      elapsedMs,
      sampleSize: 500,
      updatedAt: new Date().toISOString(),
    };
    writeBenchmarks(file);
    return;
  }

  const allowedByPercent = previous.elapsedMs * (1 + percent / 100);
  const allowedByNoise = previous.elapsedMs + noiseBufferMs;
  const allowedMs = Math.max(allowedByPercent, allowedByNoise);
  expect(elapsedMs).toBeLessThanOrEqual(allowedMs);
});
