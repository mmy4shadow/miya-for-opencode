import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

export function gatewayFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'gateway.json');
}

export function trustModeFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'gateway-trust-mode.json');
}

export function psycheModeFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'gateway-psyche-mode.json');
}

export function learningGateFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'gateway-learning-gate.json');
}

export function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

export function writeJsonAtomic(file: string, payload: unknown): void {
  ensureDir(file);
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, file);
}

export function safeReadJsonObject(
  file: string,
): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
