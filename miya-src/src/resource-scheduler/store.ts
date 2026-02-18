import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import type { ResourceSchedulerSnapshot } from './types';

function schedulerDir(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'resource-scheduler');
}

function snapshotPath(projectDir: string): string {
  return path.join(schedulerDir(projectDir), 'state.json');
}

function eventsPath(projectDir: string): string {
  return path.join(schedulerDir(projectDir), 'events.jsonl');
}

function ensureDir(projectDir: string): void {
  fs.mkdirSync(schedulerDir(projectDir), { recursive: true });
}

export function writeSchedulerSnapshot(
  projectDir: string,
  snapshot: ResourceSchedulerSnapshot,
): void {
  ensureDir(projectDir);
  fs.writeFileSync(
    snapshotPath(projectDir),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf-8',
  );
}

export function appendSchedulerEvent(
  projectDir: string,
  event: Record<string, unknown>,
): void {
  ensureDir(projectDir);
  fs.appendFileSync(
    eventsPath(projectDir),
    `${JSON.stringify(event)}\n`,
    'utf-8',
  );
}
