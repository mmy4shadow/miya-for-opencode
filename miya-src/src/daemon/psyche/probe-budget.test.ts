import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { consumeProbeBudget } from './probe-budget';

function tempBudgetPath(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'miya-psyche-probe-budget-'),
  );
  return path.join(dir, 'probe-budget.json');
}

describe('psyche probe budget', () => {
  test('enforces capacity and refills by time', () => {
    const file = tempBudgetPath();
    const cfg = { capacity: 2, refillPerSec: 1 / 60 };
    const start = 1_700_000_000_000;
    const a = consumeProbeBudget(file, cfg, start);
    const b = consumeProbeBudget(file, cfg, start);
    const c = consumeProbeBudget(file, cfg, start);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(c.allowed).toBe(false);

    const d = consumeProbeBudget(file, cfg, start + 120_000);
    expect(d.allowed).toBe(true);
  });
});
