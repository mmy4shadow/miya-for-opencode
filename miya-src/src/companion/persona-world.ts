import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

export type PersonaWorldRisk = 'low' | 'medium' | 'high';

export interface PersonaPreset {
  id: string;
  name: string;
  persona: string;
  style: string;
  relationship: string;
  risk: PersonaWorldRisk;
  createdAt: string;
  updatedAt: string;
}

export interface WorldPreset {
  id: string;
  name: string;
  summary: string;
  rules: string[];
  tags: string[];
  risk: PersonaWorldRisk;
  createdAt: string;
  updatedAt: string;
}

export interface SessionPersonaWorldBinding {
  sessionID: string;
  personaPresetID?: string;
  worldPresetID?: string;
  updatedAt: string;
}

interface PersonaWorldStore {
  version: 1;
  personas: PersonaPreset[];
  worlds: WorldPreset[];
  bindings: Record<string, SessionPersonaWorldBinding>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function filePath(projectDir: string): string {
  return path.join(
    getMiyaRuntimeDir(projectDir),
    'companion-persona-world.json',
  );
}

function defaultStore(): PersonaWorldStore {
  const now = nowIso();
  return {
    version: 1,
    personas: [
      {
        id: 'persona_default',
        name: 'Default Companion',
        persona: 'calm, supportive, and proactive',
        style: 'warm and concise',
        relationship: 'companion',
        risk: 'low',
        createdAt: now,
        updatedAt: now,
      },
    ],
    worlds: [
      {
        id: 'world_default',
        name: 'Default Workspace',
        summary:
          'Generic software delivery context with safety-first collaboration.',
        rules: ['No irreversible action without explicit approval.'],
        tags: ['software', 'productivity'],
        risk: 'low',
        createdAt: now,
        updatedAt: now,
      },
    ],
    bindings: {},
  };
}

function readStore(projectDir: string): PersonaWorldStore {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) return defaultStore();
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as Partial<PersonaWorldStore>;
    const base = defaultStore();
    return {
      version: 1,
      personas: Array.isArray(parsed.personas)
        ? parsed.personas
        : base.personas,
      worlds: Array.isArray(parsed.worlds) ? parsed.worlds : base.worlds,
      bindings:
        parsed.bindings && typeof parsed.bindings === 'object'
          ? (parsed.bindings as Record<string, SessionPersonaWorldBinding>)
          : {},
    };
  } catch {
    return defaultStore();
  }
}

function writeStore(
  projectDir: string,
  store: PersonaWorldStore,
): PersonaWorldStore {
  const file = filePath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
  return store;
}

function normalizeRisk(risk: unknown): PersonaWorldRisk {
  if (risk === 'high' || risk === 'medium' || risk === 'low') return risk;
  return 'low';
}

export function listPersonaPresets(projectDir: string): PersonaPreset[] {
  return readStore(projectDir).personas;
}

export function listWorldPresets(projectDir: string): WorldPreset[] {
  return readStore(projectDir).worlds;
}

export function upsertPersonaPreset(
  projectDir: string,
  input: {
    id?: string;
    name: string;
    persona: string;
    style: string;
    relationship: string;
    risk?: PersonaWorldRisk;
  },
): PersonaPreset {
  const store = readStore(projectDir);
  const now = nowIso();
  const id = input.id?.trim() || `persona_${randomUUID()}`;
  const current = store.personas.find((item) => item.id === id);
  const next: PersonaPreset = {
    id,
    name: input.name.trim(),
    persona: input.persona.trim(),
    style: input.style.trim(),
    relationship: input.relationship.trim(),
    risk: normalizeRisk(input.risk),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  store.personas = [
    next,
    ...store.personas.filter((item) => item.id !== id),
  ].slice(0, 120);
  writeStore(projectDir, store);
  return next;
}

export function upsertWorldPreset(
  projectDir: string,
  input: {
    id?: string;
    name: string;
    summary: string;
    rules?: string[];
    tags?: string[];
    risk?: PersonaWorldRisk;
  },
): WorldPreset {
  const store = readStore(projectDir);
  const now = nowIso();
  const id = input.id?.trim() || `world_${randomUUID()}`;
  const current = store.worlds.find((item) => item.id === id);
  const next: WorldPreset = {
    id,
    name: input.name.trim(),
    summary: input.summary.trim(),
    rules: Array.isArray(input.rules)
      ? input.rules.map((item) => String(item).trim()).filter(Boolean)
      : [],
    tags: Array.isArray(input.tags)
      ? input.tags.map((item) => String(item).trim()).filter(Boolean)
      : [],
    risk: normalizeRisk(input.risk),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  store.worlds = [next, ...store.worlds.filter((item) => item.id !== id)].slice(
    0,
    120,
  );
  writeStore(projectDir, store);
  return next;
}

export function bindSessionPersonaWorld(
  projectDir: string,
  input: {
    sessionID: string;
    personaPresetID?: string;
    worldPresetID?: string;
  },
): SessionPersonaWorldBinding {
  const store = readStore(projectDir);
  const sessionID = input.sessionID.trim() || 'main';
  const binding: SessionPersonaWorldBinding = {
    sessionID,
    personaPresetID: input.personaPresetID?.trim() || undefined,
    worldPresetID: input.worldPresetID?.trim() || undefined,
    updatedAt: nowIso(),
  };
  store.bindings[sessionID] = binding;
  writeStore(projectDir, store);
  return binding;
}

export function resolveSessionPersonaWorld(
  projectDir: string,
  sessionID: string,
): {
  binding: SessionPersonaWorldBinding;
  persona?: PersonaPreset;
  world?: WorldPreset;
  risk: PersonaWorldRisk;
} {
  const store = readStore(projectDir);
  const binding =
    store.bindings[sessionID] ??
    ({
      sessionID,
      personaPresetID: 'persona_default',
      worldPresetID: 'world_default',
      updatedAt: nowIso(),
    } satisfies SessionPersonaWorldBinding);
  const defaultPersona =
    store.personas.find((item) => item.id === 'persona_default') ??
    store.personas[0];
  const defaultWorld =
    store.worlds.find((item) => item.id === 'world_default') ?? store.worlds[0];
  const persona =
    store.personas.find((item) => item.id === binding.personaPresetID) ??
    defaultPersona;
  const world =
    store.worlds.find((item) => item.id === binding.worldPresetID) ??
    defaultWorld;
  const risk =
    persona?.risk === 'high' || world?.risk === 'high'
      ? 'high'
      : persona?.risk === 'medium' || world?.risk === 'medium'
        ? 'medium'
        : 'low';
  return {
    binding,
    persona,
    world,
    risk,
  };
}

export function buildPersonaWorldPrompt(
  projectDir: string,
  sessionID: string,
): string {
  const resolved = resolveSessionPersonaWorld(projectDir, sessionID);
  const blocks: string[] = [];
  if (resolved.persona) {
    blocks.push(
      [
        `[MIYA_PERSONA id=${resolved.persona.id} risk=${resolved.persona.risk}]`,
        `name=${resolved.persona.name}`,
        `persona=${resolved.persona.persona}`,
        `style=${resolved.persona.style}`,
        `relationship=${resolved.persona.relationship}`,
      ].join('\n'),
    );
  }
  if (resolved.world) {
    blocks.push(
      [
        `[MIYA_WORLD id=${resolved.world.id} risk=${resolved.world.risk}]`,
        `name=${resolved.world.name}`,
        `summary=${resolved.world.summary}`,
        resolved.world.rules.length > 0
          ? `rules:\n${resolved.world.rules.map((item) => `- ${item}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  blocks.push(`[MIYA_PERSONA_WORLD_RISK] ${resolved.risk}`);
  return blocks.join('\n\n');
}
