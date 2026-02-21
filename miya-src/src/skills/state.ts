import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

interface SkillState {
  enabled: string[];
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'skills.json');
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function readState(projectDir: string): SkillState {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) {
    return { enabled: [], updatedAt: nowIso() };
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as Partial<SkillState>;
    return {
      enabled: Array.isArray(parsed.enabled) ? parsed.enabled.map(String) : [],
      updatedAt:
        typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
    };
  } catch {
    return { enabled: [], updatedAt: nowIso() };
  }
}

function writeState(projectDir: string, state: SkillState): void {
  const file = filePath(projectDir);
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

export function listEnabledSkills(projectDir: string): string[] {
  return readState(projectDir).enabled;
}

export function setSkillEnabled(
  projectDir: string,
  skillID: string,
  enabled: boolean,
): string[] {
  const state = readState(projectDir);
  const normalized = new Set(state.enabled);
  if (enabled) normalized.add(skillID);
  else normalized.delete(skillID);

  const next: SkillState = {
    enabled: [...normalized].sort(),
    updatedAt: nowIso(),
  };
  writeState(projectDir, next);
  return next.enabled;
}
