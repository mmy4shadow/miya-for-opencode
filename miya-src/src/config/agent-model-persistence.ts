import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import { AGENT_ALIASES, ALL_AGENT_NAMES } from './constants';
import type { PluginConfig } from './schema';

const KNOWN_AGENT_NAMES = new Set<string>(ALL_AGENT_NAMES as readonly string[]);

interface PersistedAgentModelsFile {
  updatedAt?: string;
  agents?: Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'agent-models.json');
}

export function normalizeAgentName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const canonical = AGENT_ALIASES[trimmed] ?? trimmed;
  return KNOWN_AGENT_NAMES.has(canonical) ? canonical : null;
}

export function normalizeModelRef(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.trim();
    const slash = text.indexOf('/');
    if (slash <= 0 || slash >= text.length - 1) {
      return null;
    }
    return text;
  }

  if (isObject(value)) {
    const providerID = String(value.providerID ?? '').trim();
    const modelID = String(value.modelID ?? '').trim();
    if (!providerID || !modelID) return null;
    return `${providerID}/${modelID}`;
  }

  return null;
}

function parsePersistedModel(value: unknown): string | null {
  return normalizeModelRef(value) ?? (isObject(value) ? normalizeModelRef(value.model) : null);
}

export function readPersistedAgentModels(projectDir: string): Record<string, string> {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) return {};

  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedAgentModelsFile;
    if (!isObject(parsed.agents)) return {};

    const result: Record<string, string> = {};
    for (const [rawAgentName, rawModel] of Object.entries(parsed.agents)) {
      const agentName = normalizeAgentName(rawAgentName);
      const model = parsePersistedModel(rawModel);
      if (!agentName || !model) continue;
      result[agentName] = model;
    }
    return result;
  } catch {
    return {};
  }
}

function writePersistedAgentModels(projectDir: string, models: Record<string, string>): void {
  const file = filePath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ordered = Object.fromEntries(
    Object.keys(models)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => [key, models[key]]),
  );
  const payload: PersistedAgentModelsFile = {
    updatedAt: new Date().toISOString(),
    agents: ordered,
  };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

export function persistAgentModelSelection(
  projectDir: string,
  agentName: string,
  model: unknown,
): boolean {
  const canonicalAgentName = normalizeAgentName(agentName);
  const modelRef = normalizeModelRef(model);
  if (!canonicalAgentName || !modelRef) {
    return false;
  }

  const models = readPersistedAgentModels(projectDir);
  if (models[canonicalAgentName] === modelRef) {
    return false;
  }

  models[canonicalAgentName] = modelRef;
  writePersistedAgentModels(projectDir, models);
  return true;
}

export function applyPersistedAgentModelOverrides(
  config: PluginConfig,
  projectDir: string,
): PluginConfig {
  const persisted = readPersistedAgentModels(projectDir);
  if (Object.keys(persisted).length === 0) {
    return config;
  }

  const nextAgents = { ...(config.agents ?? {}) };
  for (const [agentName, model] of Object.entries(persisted)) {
    nextAgents[agentName] = {
      ...(nextAgents[agentName] ?? {}),
      model,
    };
  }

  return {
    ...config,
    agents: nextAgents,
  };
}

export function extractAgentModelSelectionFromEvent(
  event: unknown,
): { agentName: string; model: string; source: string } | null {
  if (!isObject(event)) return null;
  
  const eventType = String(event.type ?? '');
  const properties = event.properties;
  if (!isObject(properties)) return null;
  
  // Priority 1: Message events (user sends message)
  if (eventType === 'message.updated') {
    const info = properties.info;
    if (!isObject(info) || info.role !== 'user') {
      return null;
    }
    const agentName = normalizeAgentName(String(info.agent ?? ''));
    const model = normalizeModelRef(info.model);
    if (!agentName || !model) return null;
    return { agentName, model, source: 'message' };
  }
  
  // Priority 2: Agent switch events (TAB switch without message)
  if (['agent.selected', 'agent.changed', 'session.agent.changed'].includes(eventType)) {
    const agentName = normalizeAgentName(
      String(properties.agent ?? properties.agentName ?? properties.newAgent ?? '')
    );
    const model = normalizeModelRef(
      properties.model ?? properties.agentModel ?? properties.selectedModel
    );
    if (!agentName || !model) return null;
    return { agentName, model, source: 'agent_switch' };
  }
  
  // Priority 3: Session events (configuration changes)
  if (['session.created', 'session.updated', 'config.updated'].includes(eventType)) {
    const info = properties.info;
    let agentName: string | null = null;
    let model: string | null = null;
    
    if (isObject(info)) {
      agentName = normalizeAgentName(String(info.agent ?? ''));
      model = normalizeModelRef(info.model);
    }
    
    if (!agentName) {
      agentName = normalizeAgentName(String(properties.agent ?? properties.currentAgent ?? ''));
    }
    if (!model) {
      model = normalizeModelRef(properties.model ?? properties.currentModel);
    }
    
    if (!agentName || !model) return null;
    return { agentName, model, source: 'session' };
  }
  
  return null;
}
