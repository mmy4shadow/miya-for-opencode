import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import type { DaemonJobRecord, DaemonRuntimeState } from './types';

function daemonDir(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'daemon');
}

function runtimeStatePath(projectDir: string): string {
  return path.join(daemonDir(projectDir), 'runtime.json');
}

function jobsPath(projectDir: string): string {
  return path.join(daemonDir(projectDir), 'jobs.jsonl');
}

function checkpointsPath(projectDir: string): string {
  return path.join(daemonDir(projectDir), 'checkpoints.jsonl');
}

function ensureDir(projectDir: string): void {
  fs.mkdirSync(daemonDir(projectDir), { recursive: true });
}

export function writeDaemonRuntimeState(
  projectDir: string,
  state: DaemonRuntimeState,
): void {
  ensureDir(projectDir);
  fs.writeFileSync(
    runtimeStatePath(projectDir),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf-8',
  );
}

export function appendDaemonJob(
  projectDir: string,
  record: DaemonJobRecord,
): void {
  ensureDir(projectDir);
  fs.appendFileSync(
    jobsPath(projectDir),
    `${JSON.stringify(record)}\n`,
    'utf-8',
  );
}

export function appendDaemonRecoveryCheckpoint(
  projectDir: string,
  input: {
    sessionID: string;
    jobID: string;
    tier: string;
    step: number;
    totalSteps: number;
    checkpointPath: string;
    reasonCode: string;
  },
): void {
  ensureDir(projectDir);
  fs.appendFileSync(
    checkpointsPath(projectDir),
    `${JSON.stringify({
      id: `dcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      ...input,
    })}\n`,
    'utf-8',
  );
}
