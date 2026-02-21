import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import {
  archiveCompanionMemoryVector,
  listCompanionMemoryVectors,
  upsertCompanionMemoryVector,
} from './memory-vector';

export interface CompanionAsset {
  id: string;
  type: 'image' | 'audio';
  label?: string;
  pathOrUrl: string;
  createdAt: string;
}

export interface CompanionProfile {
  enabled: boolean;
  onboardingCompleted: boolean;
  name: string;
  persona: string;
  relationship: string;
  style: string;
  memoryFacts: string[];
  assets: CompanionAsset[];
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'companion.json');
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function defaultProfile(): CompanionProfile {
  return {
    enabled: false,
    onboardingCompleted: false,
    name: 'Miya',
    persona: 'calm, supportive, and proactive',
    relationship: 'companion',
    style: 'warm and concise',
    memoryFacts: [],
    assets: [],
    updatedAt: nowIso(),
  };
}

function deriveActiveMemoryFacts(projectDir: string): string[] {
  try {
    return listCompanionMemoryVectors(projectDir)
      .filter((item) => item.status === 'active' && !item.isArchived)
      .map((item) => item.text)
      .slice(0, 300);
  } catch {
    return [];
  }
}

export function readCompanionProfile(projectDir: string): CompanionProfile {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) {
    return {
      ...defaultProfile(),
      memoryFacts: deriveActiveMemoryFacts(projectDir),
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<CompanionProfile>;
    return {
      ...defaultProfile(),
      ...parsed,
      // Runtime memory truth source is SQLite (mem_cells), not JSON profile blobs.
      memoryFacts: deriveActiveMemoryFacts(projectDir),
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
      updatedAt: parsed.updatedAt ?? nowIso(),
    };
  } catch {
    return {
      ...defaultProfile(),
      memoryFacts: deriveActiveMemoryFacts(projectDir),
    };
  }
}

export function writeCompanionProfile(
  projectDir: string,
  profile: CompanionProfile,
): CompanionProfile {
  const file = filePath(projectDir);
  ensureDir(file);
  const next: CompanionProfile = {
    ...profile,
    memoryFacts: deriveActiveMemoryFacts(projectDir),
    updatedAt: nowIso(),
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

export function patchCompanionProfile(
  projectDir: string,
  patch: Partial<
    Pick<
      CompanionProfile,
      'enabled' | 'onboardingCompleted' | 'name' | 'persona' | 'relationship' | 'style'
    >
  >,
): CompanionProfile {
  const current = readCompanionProfile(projectDir);
  return writeCompanionProfile(projectDir, {
    ...current,
    ...patch,
  });
}

export function addCompanionMemoryFact(
  projectDir: string,
  fact: string,
): CompanionProfile {
  const current = readCompanionProfile(projectDir);
  const normalized = fact.trim();
  if (!normalized) return current;
  upsertCompanionMemoryVector(projectDir, {
    text: normalized,
    source: 'profile_fact',
    activate: false,
  });
  return writeCompanionProfile(projectDir, {
    ...current,
    memoryFacts: deriveActiveMemoryFacts(projectDir),
  });
}

export function addCompanionAsset(
  projectDir: string,
  input: {
    type: CompanionAsset['type'];
    pathOrUrl: string;
    label?: string;
  },
): CompanionProfile {
  const current = readCompanionProfile(projectDir);
  const asset: CompanionAsset = {
    id: `asset_${randomUUID()}`,
    type: input.type,
    pathOrUrl: input.pathOrUrl,
    label: input.label,
    createdAt: nowIso(),
  };
  return writeCompanionProfile(projectDir, {
    ...current,
    assets: [asset, ...current.assets].slice(0, 200),
  });
}

export function resetCompanionProfile(projectDir: string): CompanionProfile {
  const allMemories = listCompanionMemoryVectors(projectDir);
  for (const item of allMemories) {
    if (item.isArchived) continue;
    archiveCompanionMemoryVector(projectDir, {
      memoryID: item.id,
      archived: true,
    });
  }
  return writeCompanionProfile(projectDir, defaultProfile());
}

export function syncCompanionProfileMemoryFacts(projectDir: string): CompanionProfile {
  const current = readCompanionProfile(projectDir);
  return writeCompanionProfile(projectDir, {
    ...current,
    memoryFacts: deriveActiveMemoryFacts(projectDir),
  });
}
