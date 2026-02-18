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
