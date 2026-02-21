import * as fs from 'node:fs';

export interface ProbeBudgetConfig {
  capacity: number;
  refillPerSec: number;
}

interface ProbeBudgetState {
  tokens: number;
  updatedAtMs: number;
}

function readState(
  filePath: string,
  fallbackCapacity: number,
): ProbeBudgetState {
  if (!fs.existsSync(filePath)) {
    return { tokens: fallbackCapacity, updatedAtMs: Date.now() };
  }
  try {
    const parsed = JSON.parse(
      fs.readFileSync(filePath, 'utf-8'),
    ) as Partial<ProbeBudgetState>;
    const tokens = Number(parsed.tokens);
    const updatedAtMs = Number(parsed.updatedAtMs);
    return {
      tokens: Number.isFinite(tokens) ? tokens : fallbackCapacity,
      updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now(),
    };
  } catch {
    return { tokens: fallbackCapacity, updatedAtMs: Date.now() };
  }
}

function writeState(filePath: string, state: ProbeBudgetState): void {
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

export function consumeProbeBudget(
  filePath: string,
  config: ProbeBudgetConfig,
  nowMs = Date.now(),
): { allowed: boolean; remainingTokens: number } {
  const capacity = Math.max(1, Math.floor(config.capacity));
  const refillPerSec = Math.max(0.0001, config.refillPerSec);
  const current = readState(filePath, capacity);
  const elapsedSec = Math.max(0, (nowMs - current.updatedAtMs) / 1000);
  const refilled = Math.min(
    capacity,
    current.tokens + elapsedSec * refillPerSec,
  );
  const allowed = refilled >= 1;
  const nextTokens = allowed ? refilled - 1 : refilled;
  writeState(filePath, { tokens: nextTokens, updatedAtMs: nowMs });
  return { allowed, remainingTokens: Number(nextTokens.toFixed(3)) };
}
