import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import { AGENT_ALIASES, ALL_AGENT_NAMES } from './constants';
import type { PluginConfig } from './schema';

const KNOWN_AGENT_NAMES = new Set<string>(ALL_AGENT_NAMES as readonly string[]);
const AGENT_RUNTIME_VERSION = 1;
const MAX_WRITE_RETRIES = 4;

interface AgentRuntimeEntry {
  model?: string;
  variant?: string;
  providerID?: string;
  options?: Record<string, unknown>;
  apiKey?: string;
  baseURL?: string;
  updatedAt: string;
}

interface PersistedAgentRuntimeFile {
  version?: number;
  revision?: number;
  updatedAt?: string;
  activeAgentId?: string;
  agents?: Record<string, unknown>;
}

interface PersistedAgentModelsFile {
  updatedAt?: string;
  agents?: Record<string, unknown>;
}

export interface AgentRuntimeSelectionInput {
  agentName: string;
  model?: unknown;
  variant?: unknown;
  providerID?: unknown;
  options?: unknown;
  apiKey?: unknown;
  baseURL?: unknown;
  activeAgentId?: unknown;
}

export interface AgentModelSelectionFromEvent {
  agentName: string;
  model?: string;
  variant?: string;
  providerID?: string;
  options?: Record<string, unknown>;
  apiKey?: string;
  baseURL?: string;
  activeAgentId?: string;
  source: string;
}

interface NormalizedAgentRuntime {
  version: number;
  revision: number;
  updatedAt: string;
  activeAgentId?: string;
  agents: Record<string, AgentRuntimeEntry>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'agent-runtime.json');
}

function legacyFilePath(projectDir: string): string {
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

function normalizeProviderID(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeStringValue(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeOptions(value: unknown): Record<string, unknown> | undefined {
  if (!isObject(value)) return undefined;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function normalizeAgentRuntimeEntry(value: unknown): AgentRuntimeEntry | null {
  if (!isObject(value)) return null;

  const model = parsePersistedModel(value.model ?? value);
  const variant = normalizeStringValue(value.variant);
  const providerID =
    normalizeProviderID(value.providerID) ??
    (model ? normalizeProviderID(model.split('/')[0]) : undefined);
  const options = normalizeOptions(value.options ?? value.providerOptions);
  const apiKey = normalizeStringValue(value.apiKey);
  const baseURL = normalizeStringValue(value.baseURL);

  if (!model && !variant && !providerID && !options && !apiKey && !baseURL) {
    return null;
  }

  return {
    model: model ?? undefined,
    variant,
    providerID,
    options,
    apiKey,
    baseURL,
    updatedAt: normalizeStringValue(value.updatedAt) ?? new Date().toISOString(),
  };
}

function readLegacyModels(projectDir: string): Record<string, string> {
  const file = legacyFilePath(projectDir);
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

function normalizeRuntimeState(
  projectDir: string,
  parsed: PersistedAgentRuntimeFile | null,
): NormalizedAgentRuntime {
  if (!parsed || !isObject(parsed.agents)) {
    const legacy = readLegacyModels(projectDir);
    const agentsFromLegacy: Record<string, AgentRuntimeEntry> = {};
    for (const [agentName, model] of Object.entries(legacy)) {
      agentsFromLegacy[agentName] = {
        model,
        providerID: model.split('/')[0],
        updatedAt: new Date().toISOString(),
      };
    }
    return {
      version: AGENT_RUNTIME_VERSION,
      revision: 0,
      updatedAt: new Date().toISOString(),
      agents: agentsFromLegacy,
    };
  }

  const agents: Record<string, AgentRuntimeEntry> = {};
  for (const [rawAgentName, rawEntry] of Object.entries(parsed.agents)) {
    const agentName = normalizeAgentName(rawAgentName);
    if (!agentName) continue;
    const entry = normalizeAgentRuntimeEntry(rawEntry);
    if (!entry) continue;
    agents[agentName] = entry;
  }

  const activeAgentId = normalizeAgentName(String(parsed.activeAgentId ?? '')) ?? undefined;

  return {
    version: AGENT_RUNTIME_VERSION,
    revision: Number(parsed.revision ?? 0) || 0,
    updatedAt: normalizeStringValue(parsed.updatedAt) ?? new Date().toISOString(),
    activeAgentId,
    agents,
  };
}

function readRuntimeState(projectDir: string): NormalizedAgentRuntime {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) {
    return normalizeRuntimeState(projectDir, null);
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedAgentRuntimeFile;
    return normalizeRuntimeState(projectDir, parsed);
  } catch {
    return normalizeRuntimeState(projectDir, null);
  }
}

function writeRuntimeStateAtomic(projectDir: string, runtime: NormalizedAgentRuntime): void {
  const file = filePath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const orderedAgents = Object.fromEntries(
    Object.keys(runtime.agents)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => [key, runtime.agents[key]]),
  );
  const payload: PersistedAgentRuntimeFile = {
    version: AGENT_RUNTIME_VERSION,
    revision: runtime.revision,
    updatedAt: runtime.updatedAt,
    activeAgentId: runtime.activeAgentId,
    agents: orderedAgents,
  };
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, file);
}

export function readPersistedAgentModels(projectDir: string): Record<string, string> {
  const runtime = readRuntimeState(projectDir);
  const models: Record<string, string> = {};
  for (const [agentName, entry] of Object.entries(runtime.agents)) {
    if (entry.model) {
      models[agentName] = entry.model;
    }
  }
  return models;
}

export function readPersistedAgentRuntime(projectDir: string): {
  activeAgentId?: string;
  revision: number;
  agents: Record<string, AgentRuntimeEntry>;
} {
  const runtime = readRuntimeState(projectDir);
  return {
    activeAgentId: runtime.activeAgentId,
    revision: runtime.revision,
    agents: runtime.agents,
  };
}

function normalizeSelectionInput(input: AgentRuntimeSelectionInput): {
  agentName: string;
  entryPatch: Partial<AgentRuntimeEntry>;
  activeAgentId?: string;
} | null {
  const agentName = normalizeAgentName(input.agentName);
  if (!agentName) return null;

  const model = normalizeModelRef(input.model);
  const variant = normalizeStringValue(input.variant);
  const providerID =
    normalizeProviderID(input.providerID) ??
    (model ? normalizeProviderID(model.split('/')[0]) : undefined);
  const options = normalizeOptions(input.options);
  const apiKey = normalizeStringValue(input.apiKey);
  const baseURL = normalizeStringValue(input.baseURL);

  const entryPatch: Partial<AgentRuntimeEntry> = {};
  if (model) entryPatch.model = model;
  if (variant) entryPatch.variant = variant;
  if (providerID) entryPatch.providerID = providerID;
  if (options) entryPatch.options = options;
  if (apiKey) entryPatch.apiKey = apiKey;
  if (baseURL) entryPatch.baseURL = baseURL;

  const activeAgentId = normalizeAgentName(String(input.activeAgentId ?? '')) ?? undefined;
  if (Object.keys(entryPatch).length === 0 && !activeAgentId) return null;

  return {
    agentName,
    entryPatch,
    activeAgentId,
  };
}

export function persistAgentRuntimeSelection(
  projectDir: string,
  input: AgentRuntimeSelectionInput,
): boolean {
  const normalized = normalizeSelectionInput(input);
  if (!normalized) return false;

  for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt += 1) {
    const base = readRuntimeState(projectDir);
    const currentEntry = base.agents[normalized.agentName];
    const mergedEntry = {
      ...(currentEntry ?? {}),
      ...normalized.entryPatch,
    };
    const previousComparable = JSON.stringify({
      ...(currentEntry ?? {}),
      updatedAt: undefined,
    });
    const nextComparable = JSON.stringify({
      ...mergedEntry,
      updatedAt: undefined,
    });
    const nextEntry: AgentRuntimeEntry = {
      ...(currentEntry ?? { updatedAt: new Date().toISOString() }),
      ...normalized.entryPatch,
      updatedAt: new Date().toISOString(),
    };

    const entryUnchanged = previousComparable === nextComparable;
    const activeUnchanged =
      normalized.activeAgentId === undefined || base.activeAgentId === normalized.activeAgentId;
    if (entryUnchanged && activeUnchanged) {
      return false;
    }

    const latest = readRuntimeState(projectDir);
    if (latest.revision !== base.revision) {
      continue;
    }

    const nextState: NormalizedAgentRuntime = {
      ...latest,
      revision: latest.revision + 1,
      updatedAt: new Date().toISOString(),
      activeAgentId: normalized.activeAgentId ?? latest.activeAgentId,
      agents: {
        ...latest.agents,
        [normalized.agentName]: nextEntry,
      },
    };
    writeRuntimeStateAtomic(projectDir, nextState);
    return true;
  }
  return false;
}

export function persistAgentModelSelection(
  projectDir: string,
  agentName: string,
  model: unknown,
): boolean {
  if (!normalizeModelRef(model)) {
    return false;
  }
  return persistAgentRuntimeSelection(projectDir, {
    agentName,
    model,
    activeAgentId: agentName,
  });
}

export function applyPersistedAgentModelOverrides(
  config: PluginConfig,
  projectDir: string,
): PluginConfig {
  const runtime = readPersistedAgentRuntime(projectDir);
  if (Object.keys(runtime.agents).length === 0) {
    return config;
  }

  const nextAgents = { ...(config.agents ?? {}) };
  for (const [agentName, entry] of Object.entries(runtime.agents)) {
    const previousAgent = (nextAgents[agentName] ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (entry.model) patch.model = entry.model;
    if (entry.variant) patch.variant = entry.variant;
    if (entry.providerID) patch.providerID = entry.providerID;
    if (entry.options) patch.options = entry.options;
    if (entry.apiKey) patch.apiKey = entry.apiKey;
    if (entry.baseURL) patch.baseURL = entry.baseURL;
    nextAgents[agentName] = {
      ...previousAgent,
      ...patch,
    };
  }

  const activeAgent = runtime.activeAgentId ? runtime.agents[runtime.activeAgentId] : undefined;
  let nextProvider = config.provider;
  if (activeAgent?.providerID) {
    const providerMap = (isObject(config.provider) ? config.provider : {}) as Record<
      string,
      unknown
    >;
    const currentProvider = (providerMap[activeAgent.providerID] ?? {}) as Record<string, unknown>;
    const currentOptions = (isObject(currentProvider.options)
      ? currentProvider.options
      : {}) as Record<string, unknown>;
    const nextOptions: Record<string, unknown> = {
      ...currentOptions,
      ...(activeAgent.options ?? {}),
    };
    if (activeAgent.apiKey) nextOptions.apiKey = activeAgent.apiKey;
    if (activeAgent.baseURL) nextOptions.baseURL = activeAgent.baseURL;
    nextProvider = {
      ...providerMap,
      [activeAgent.providerID]: {
        ...currentProvider,
        options: nextOptions,
      },
    };
  }

  return {
    ...config,
    agents: nextAgents,
    provider: nextProvider,
  };
}

export function extractAgentModelSelectionFromEvent(
  event: unknown,
): AgentModelSelectionFromEvent | null {
  if (!isObject(event)) return null;

  const eventType = String(event.type ?? '');
  const properties = event.properties;
  if (!isObject(properties)) return null;

  const extractFromEvent = (
    source: string,
    scope: Record<string, unknown>,
    fallbackAgent?: string,
    activeAgent = false,
  ): AgentModelSelectionFromEvent | null => {
    const agentName =
      normalizeAgentName(String(scope.agent ?? scope.agentName ?? scope.newAgent ?? fallbackAgent ?? '')) ??
      null;
    if (!agentName) return null;

    const model = normalizeModelRef(scope.model ?? scope.selectedModel ?? scope.agentModel);
    const variant = normalizeStringValue(scope.variant);
    const providerID =
      normalizeProviderID(scope.providerID ?? scope.provider) ??
      (model ? normalizeProviderID(model.split('/')[0]) : undefined);
    const options = normalizeOptions(scope.options ?? scope.providerOptions);
    const apiKey = normalizeStringValue(scope.apiKey ?? (isObject(scope.options) ? scope.options.apiKey : undefined));
    const baseURL = normalizeStringValue(
      scope.baseURL ?? (isObject(scope.options) ? scope.options.baseURL : undefined),
    );

    if (!model && !variant && !providerID && !options && !apiKey && !baseURL && !activeAgent) {
      return null;
    }

    return {
      agentName,
      model: model ?? undefined,
      variant,
      providerID,
      options,
      apiKey,
      baseURL,
      activeAgentId: activeAgent ? agentName : undefined,
      source,
    };
  };

  if (eventType === 'message.updated') {
    const info = properties.info;
    if (!isObject(info) || info.role !== 'user') {
      return null;
    }
    return extractFromEvent('message', info, String(properties.agent ?? ''), true);
  }

  if (['agent.selected', 'agent.changed', 'session.agent.changed'].includes(eventType)) {
    return extractFromEvent('agent_switch', properties, undefined, true);
  }

  if (['session.created', 'session.updated', 'config.updated'].includes(eventType)) {
    const info = properties.info;
    if (isObject(info)) {
      const fromInfo = extractFromEvent(
        'session',
        info,
        String(properties.agent ?? properties.currentAgent ?? ''),
        true,
      );
      if (fromInfo) return fromInfo;
    }
    return extractFromEvent('session', properties, undefined, true);
  }

  return null;
}
