import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import { AGENT_ALIASES, ALL_AGENT_NAMES } from './constants';
import type { PluginConfig } from './schema';

const KNOWN_AGENT_NAMES = new Set<string>(ALL_AGENT_NAMES as readonly string[]);
const AGENT_RUNTIME_VERSION = 1;
const MAX_WRITE_RETRIES = 4;
const LEGACY_MODEL_REWRITE: Record<string, string> = {
  'openrouter/minimax/z-ai/glm-5': 'openrouter/z-ai/glm-5',
};

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

interface UiModelStateFile {
  model?: unknown;
  models?: unknown;
  byAgent?: unknown;
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

interface AgentPatchDraft {
  agentName: string;
  model?: unknown;
  modelProviderID?: unknown;
  modelID?: unknown;
  variant?: unknown;
  providerID?: unknown;
  options?: unknown;
  apiKey?: unknown;
  baseURL?: unknown;
  activeAgentId?: unknown;
}

interface ProviderPatchDraft {
  providerID: string;
  options?: Record<string, unknown>;
  apiKey?: string;
  baseURL?: string;
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
  const normalizeRefText = (input: string): string | null => {
    const text = LEGACY_MODEL_REWRITE[input.trim()] ?? input.trim();
    const slash = text.indexOf('/');
    if (slash <= 0 || slash >= text.length - 1) {
      return null;
    }
    return text;
  };

  if (typeof value === 'string') {
    return normalizeRefText(value);
  }

  if (isObject(value)) {
    const providerID = String(value.providerID ?? value.provider ?? '').trim();
    const modelID = String(value.modelID ?? '').trim();
    if (providerID && modelID) {
      return normalizeRefText(`${providerID}/${modelID}`);
    }
    return normalizeRefText(modelID);
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

function getUiModelStateFileCandidates(): string[] {
  const candidates = [
    process.env.XDG_STATE_HOME
      ? path.join(process.env.XDG_STATE_HOME, 'opencode', 'model.json')
      : '',
    path.join(os.homedir(), '.local', 'state', 'opencode', 'model.json'),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'opencode', 'state', 'model.json')
      : '',
    process.env.APPDATA
      ? path.join(process.env.APPDATA, 'opencode', 'state', 'model.json')
      : '',
  ].filter((item) => item.trim().length > 0);

  return Array.from(new Set(candidates));
}

function parseUiModelStateAgentMap(value: unknown): Record<string, string> {
  if (!isObject(value)) return {};
  const modelsByAgent: Record<string, string> = {};
  for (const [rawAgentName, rawSelection] of Object.entries(value)) {
    const agentName = normalizeAgentName(rawAgentName);
    if (!agentName) continue;
    const model = normalizeModelRef(rawSelection);
    if (model) {
      modelsByAgent[agentName] = model;
      continue;
    }
    if (isObject(rawSelection)) {
      const normalizedFromObject = normalizeModelRef({
        providerID: rawSelection.providerID,
        modelID: rawSelection.modelID,
      });
      if (normalizedFromObject) {
        modelsByAgent[agentName] = normalizedFromObject;
      }
    }
  }
  return modelsByAgent;
}

function readUiModelStateModels(): {
  sourcePath?: string;
  modelsByAgent: Record<string, string>;
} {
  for (const candidate of getUiModelStateFileCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as UiModelStateFile;
      const maps = [
        parseUiModelStateAgentMap(parsed.model),
        parseUiModelStateAgentMap(parsed.models),
        parseUiModelStateAgentMap(parsed.byAgent),
      ];
      const modelsByAgent = Object.assign({}, ...maps);
      if (Object.keys(modelsByAgent).length === 0) {
        continue;
      }
      return {
        sourcePath: candidate,
        modelsByAgent,
      };
    } catch {
      // try next candidate
    }
  }

  return { modelsByAgent: {} };
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
    const migrated = normalizeRuntimeState(projectDir, null);
    if (Object.keys(migrated.agents).length > 0 || fs.existsSync(legacyFilePath(projectDir))) {
      const runtimeToWrite: NormalizedAgentRuntime = {
        ...migrated,
        revision: migrated.revision > 0 ? migrated.revision : 1,
        updatedAt: new Date().toISOString(),
      };
      writeRuntimeStateAtomic(projectDir, runtimeToWrite);
      return runtimeToWrite;
    }
    return migrated;
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

export function removePersistedAgentRuntimeSelection(
  projectDir: string,
  agentName: string,
  options?: {
    clearActive?: boolean;
    activeAgentId?: string;
  },
): boolean {
  const canonicalAgentName = normalizeAgentName(agentName);
  if (!canonicalAgentName) return false;

  const requestedActiveAgentId =
    normalizeAgentName(String(options?.activeAgentId ?? '')) ?? undefined;

  for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt += 1) {
    const base = readRuntimeState(projectDir);
    const hadEntry = Boolean(base.agents[canonicalAgentName]);
    const nextActiveAgentId =
      requestedActiveAgentId ??
      (options?.clearActive && base.activeAgentId === canonicalAgentName
        ? undefined
        : base.activeAgentId);

    if (!hadEntry && nextActiveAgentId === base.activeAgentId) {
      return false;
    }

    const latest = readRuntimeState(projectDir);
    if (latest.revision !== base.revision) {
      continue;
    }

    const nextAgents = { ...latest.agents };
    delete nextAgents[canonicalAgentName];

    const nextState: NormalizedAgentRuntime = {
      ...latest,
      revision: latest.revision + 1,
      updatedAt: new Date().toISOString(),
      activeAgentId: nextActiveAgentId,
      agents: nextAgents,
    };
    writeRuntimeStateAtomic(projectDir, nextState);
    return true;
  }

  return false;
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
  const many = extractAgentModelSelectionsFromEvent(event);
  return many[0] ?? null;
}

function normalizeSelectionFromDraft(
  draft: AgentPatchDraft,
  source: string,
): AgentModelSelectionFromEvent | null {
  const agentName = normalizeAgentName(String(draft.agentName ?? ''));
  if (!agentName) return null;
  const model =
    normalizeModelRef(draft.model) ??
    normalizeModelRef({
      providerID: draft.modelProviderID ?? draft.providerID,
      modelID: draft.modelID,
    });
  const variant = normalizeStringValue(draft.variant);
  const providerID =
    normalizeProviderID(draft.providerID) ??
    (model ? normalizeProviderID(model.split('/')[0]) : undefined);
  const options = normalizeOptions(draft.options);
  const apiKey = normalizeStringValue(draft.apiKey);
  const baseURL = normalizeStringValue(draft.baseURL);
  const activeAgentId = normalizeAgentName(String(draft.activeAgentId ?? '')) ?? undefined;
  if (!model && !variant && !providerID && !options && !apiKey && !baseURL && !activeAgentId) {
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
    activeAgentId,
    source,
  };
}

function applyAgentPatchField(draft: AgentPatchDraft, field: string, value: unknown): boolean {
  if (field === 'model') {
    draft.model = value;
    return true;
  }
  if (field === 'model.providerID') {
    draft.modelProviderID = value;
    return true;
  }
  if (field === 'model.modelID' || field === 'modelID') {
    draft.modelID = value;
    return true;
  }
  if (field === 'variant') {
    draft.variant = value;
    return true;
  }
  if (field === 'providerID' || field === 'provider') {
    draft.providerID = value;
    return true;
  }
  if (field === 'options') {
    draft.options = value;
    return true;
  }
  if (field === 'apiKey' || field === 'options.apiKey') {
    draft.apiKey = value;
    return true;
  }
  if (field === 'baseURL' || field === 'options.baseURL') {
    draft.baseURL = value;
    return true;
  }
  return false;
}

function parseAgentPatchSet(
  setMap: Record<string, unknown>,
  source: string,
  activeAgentHint?: string,
): AgentModelSelectionFromEvent[] {
  const drafts = new Map<string, AgentPatchDraft>();
  const providerDrafts = new Map<string, ProviderPatchDraft>();
  let defaultAgentFromPatch = '';
  for (const [rawKey, value] of Object.entries(setMap)) {
    const key = rawKey.trim();
    if (!key) continue;
    if (key === 'default_agent' || key === 'defaultAgent') {
      defaultAgentFromPatch = String(value ?? '');
      break;
    }
    const parts = key.split('.');
    if (
      parts.length > 0 &&
      (parts[0] === 'default_agent' || parts[0] === 'defaultAgent') &&
      typeof value === 'string'
    ) {
      defaultAgentFromPatch = value;
      break;
    }
  }
  const activeAgentFromHint =
    normalizeAgentName(String(defaultAgentFromPatch || activeAgentHint || '')) ?? undefined;

  const getOrCreateDraft = (agentNameRaw: string): AgentPatchDraft | null => {
    const agentName = normalizeAgentName(agentNameRaw);
    if (!agentName) return null;
    const existing = drafts.get(agentName);
    if (existing) return existing;
    const created: AgentPatchDraft = { agentName };
    drafts.set(agentName, created);
    return created;
  };

  for (const [rawKey, value] of Object.entries(setMap)) {
    const key = rawKey.trim();
    if (!key) continue;
    if (key === 'default_agent' || key === 'defaultAgent') continue;
    const parts = key.split('.');
    if (parts[0] === 'default_agent' || parts[0] === 'defaultAgent') {
      continue;
    }

    if (parts[0] === 'agent' || parts[0] === 'agents') {
      if (parts.length >= 3) {
        const directDraft = getOrCreateDraft(parts[1] ?? '');
        if (directDraft) {
          applyAgentPatchField(directDraft, parts.slice(2).join('.'), value);
          continue;
        }
        if (!activeAgentFromHint) continue;
        const activeDraft = getOrCreateDraft(activeAgentFromHint);
        if (!activeDraft) continue;
        applyAgentPatchField(activeDraft, parts.slice(1).join('.'), value);
        continue;
      }
      if (parts.length === 2 && activeAgentFromHint) {
        const draft = getOrCreateDraft(activeAgentFromHint);
        if (!draft) continue;
        applyAgentPatchField(draft, parts[1] ?? '', value);
      }
      continue;
    }

    if (activeAgentFromHint) {
      const draft = getOrCreateDraft(activeAgentFromHint);
      if (draft && applyAgentPatchField(draft, key, value)) {
        continue;
      }
    }

    if (parts[0] === 'provider' && parts.length >= 3) {
      const providerID = String(parts[1] ?? '').trim();
      if (!providerID) continue;
      const field = parts.slice(2).join('.');
      const draft = providerDrafts.get(providerID) ?? {
        providerID,
      };
      if (field === 'options' && isObject(value)) {
        draft.options = normalizeOptions(value);
      }
      if (field === 'options.apiKey' || field === 'apiKey') {
        draft.apiKey = normalizeStringValue(value);
      }
      if (field === 'options.baseURL' || field === 'baseURL') {
        draft.baseURL = normalizeStringValue(value);
      }
      providerDrafts.set(providerID, draft);
    }
  }

  if (providerDrafts.size > 0) {
    for (const providerPatch of providerDrafts.values()) {
      let targetDraft: AgentPatchDraft | undefined;
      for (const draft of drafts.values()) {
        const modelProvider =
          normalizeModelRef(draft.model)?.split('/')[0] ??
          normalizeProviderID(draft.modelProviderID);
        const explicitProvider = normalizeProviderID(draft.providerID);
        if (modelProvider === providerPatch.providerID || explicitProvider === providerPatch.providerID) {
          targetDraft = draft;
          break;
        }
      }
      if (!targetDraft && activeAgentFromHint) {
        targetDraft =
          drafts.get(activeAgentFromHint) ??
          ({
            agentName: activeAgentFromHint,
          } as AgentPatchDraft);
      }
      if (!targetDraft) continue;
      targetDraft.providerID = targetDraft.providerID ?? providerPatch.providerID;
      if (providerPatch.options) targetDraft.options = providerPatch.options;
      if (providerPatch.apiKey) targetDraft.apiKey = providerPatch.apiKey;
      if (providerPatch.baseURL) targetDraft.baseURL = providerPatch.baseURL;
      drafts.set(String(targetDraft.agentName), targetDraft);
    }
  }

  const normalized: AgentModelSelectionFromEvent[] = [];
  for (const draft of drafts.values()) {
    if (activeAgentFromHint) {
      draft.activeAgentId = activeAgentFromHint;
    }
    const item = normalizeSelectionFromDraft(draft, source);
    if (item) normalized.push(item);
  }
  return normalized;
}

export function persistAgentRuntimeFromConfigSnapshot(
  projectDir: string,
  snapshot: unknown,
): { updated: number; activeAgentId?: string } {
  if (!isObject(snapshot)) return { updated: 0 };

  const activeAgentId =
    normalizeAgentName(String(snapshot.default_agent ?? snapshot.defaultAgent ?? '')) ?? undefined;
  const agentMap = isObject(snapshot.agent)
    ? snapshot.agent
    : isObject(snapshot.agents)
      ? snapshot.agents
      : {};

  let updated = 0;
  for (const [rawAgentName, rawAgentConfig] of Object.entries(agentMap)) {
    if (!isObject(rawAgentConfig)) continue;
    const agentName = normalizeAgentName(rawAgentName);
    if (!agentName) continue;
    const changed = persistAgentRuntimeSelection(projectDir, {
      agentName,
      model: rawAgentConfig.model,
      variant: rawAgentConfig.variant,
      providerID: rawAgentConfig.providerID,
      options: rawAgentConfig.options,
      apiKey: rawAgentConfig.apiKey,
      baseURL: rawAgentConfig.baseURL,
      activeAgentId: activeAgentId === agentName ? activeAgentId : undefined,
    });
    if (changed) updated += 1;
  }

  if (activeAgentId) {
    const changed = persistAgentRuntimeSelection(projectDir, {
      agentName: activeAgentId,
      activeAgentId,
    });
    if (changed) updated += 1;
  }

  return { updated, activeAgentId };
}

export function persistAgentRuntimeFromUiModelState(projectDir: string): {
  updated: number;
  sourcePath?: string;
} {
  const { sourcePath, modelsByAgent } = readUiModelStateModels();
  if (Object.keys(modelsByAgent).length === 0) {
    return { updated: 0 };
  }

  let updated = 0;
  for (const [agentName, model] of Object.entries(modelsByAgent)) {
    const changed = persistAgentRuntimeSelection(projectDir, {
      agentName,
      model,
    });
    if (changed) updated += 1;
  }

  return { updated, sourcePath };
}

export function extractAgentModelSelectionsFromEvent(
  event: unknown,
): AgentModelSelectionFromEvent[] {
  if (!isObject(event)) return [];

  const eventType = String(event.type ?? '');
  const properties = event.properties;
  if (!isObject(properties)) return [];

  const extractFromEvent = (
    source: string,
    scope: Record<string, unknown>,
    fallbackAgent?: string,
    activeAgent = false,
  ): AgentModelSelectionFromEvent | null => {
    const agentName =
      normalizeAgentName(
        String(
          scope.agent ??
            scope.agentName ??
            scope.newAgent ??
            scope.activeAgent ??
            scope.currentAgent ??
            scope.selectedAgent ??
            scope.defaultAgent ??
            fallbackAgent ??
            '',
        ),
      ) ??
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
      return [];
    }
    const result = extractFromEvent('message', info, String(properties.agent ?? ''), true);
    return result ? [result] : [];
  }

  if (['agent.selected', 'agent.changed', 'session.agent.changed'].includes(eventType)) {
    const result = extractFromEvent('agent_switch', properties, undefined, true);
    return result ? [result] : [];
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
      if (fromInfo) return [fromInfo];
    }
    const fromProperties = extractFromEvent('session', properties, undefined, true);
    if (fromProperties) return [fromProperties];
  }

  if (
    [
      'settings.saved',
      'settings.updated',
      'settings.changed',
      'config.saved',
      'config.changed',
      'agent.updated',
      'agent.config.saved',
    ].includes(eventType)
  ) {
    const info = isObject(properties.info) ? properties.info : {};
    const activeAgentHint = String(
      properties.activeAgent ??
        properties.currentAgent ??
        properties.selectedAgent ??
        properties.agent ??
        properties.defaultAgent ??
        properties.default_agent ??
        info.activeAgent ??
        info.currentAgent ??
        info.selectedAgent ??
        info.agent ??
        info.defaultAgent ??
        info.default_agent ??
        '',
    );
    const patchRaw = properties.patch;
    if (isObject(patchRaw) && isObject(patchRaw.set)) {
      const parsed = parseAgentPatchSet(patchRaw.set, 'settings_save_patch', activeAgentHint);
      if (parsed.length > 0) return parsed;
    }
    if (isObject(properties.set)) {
      const parsed = parseAgentPatchSet(properties.set, 'settings_save_set', activeAgentHint);
      if (parsed.length > 0) return parsed;
    }
  }

  return [];
}
