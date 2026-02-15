import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

export interface TurnEvidencePack {
  turnID: string;
  at: string;
  sessionID: string;
  source: string;
  modeKernel: {
    mode: 'work' | 'chat' | 'mixed';
    confidence: number;
    why: string[];
  };
  arbiter: {
    mode: 'work' | 'chat' | 'mixed';
    executeWork: boolean;
    rightBrainSuppressed: boolean;
    priorityTrail: string[];
    why: string[];
  };
  tracks: {
    work: {
      planned: boolean;
      executed: boolean;
    };
    emotional: {
      planned: boolean;
      executed: boolean;
    };
  };
  outcome: {
    delivered: boolean;
    queued: boolean;
    reason?: string;
  };
  leftBrain?: Record<string, unknown>;
  rightBrain?: Record<string, unknown>;
  routing?: Record<string, unknown>;
}

function evidenceFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'gateway-turn-evidence.jsonl');
}

export function appendTurnEvidencePack(projectDir: string, pack: TurnEvidencePack): void {
  const file = evidenceFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(pack)}\n`, 'utf-8');
}

