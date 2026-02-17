import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import { AGENT_ALIASES, ALL_AGENT_NAMES } from './constants';
import type { PluginConfig } from './schema';

const KNOWN_AGENT_NAMES = new Set<string>(ALL_AGENT_NAMES as readonly string[]);
const AGENT_RUNTIME_VERSION = 1;
const MAX_WRITE_RETRIES = 4;
const OPEN_CODE_MODEL_TOKEN_RE = /\b[a-z0-9._-]+\/[a-z0-9._/-]+\b/i;
const STATE_SYNC_STAMP_BY_DIR = new Map<string, string>();

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

interface AgentPatchDraft {
  agentName: string;
  model?: unknown;
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

function readJsonObjectFile(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const set = new Set<string>();
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    set.add(text);
  }
  return [...set];
}

function collectOpenCodeStateDirCandidates(projectDir: string): string[] {
  const envXdgStateHome = normalizeStringValue(process.env.XDG_STATE_HOME);
  const envOpenCodeStateHome = normalizeStringValue(
    process.env.OPENCODE_STATE_HOME,
  );
  const envLocalAppData = normalizeStringValue(process.env.LOCALAPPDATA);
  const envAppData = normalizeStringValue(process.env.APPDATA);
  const homeDir = normalizeStringValue(os.homedir());

  const candidates = uniqueStrings([
    envOpenCodeStateHome ? path.join(envOpenCodeStateHome, 'opencode') : undefined,
    envXdgStateHome ? path.join(envXdgStateHome, 'opencode') : undefined,
    homeDir ? path.join(homeDir, '.local', 'state', 'opencode') : undefined,
    envLocalAppData ? path.join(envLocalAppData, 'opencode', 'state') : undefined,
    envAppData ? path.join(envAppData, 'opencode', 'state') : undefined,
    path.join(projectDir, '.opencode', 'state', 'opencode'),
    path.join(projectDir, '.opencode', 'state'),
  ]);

  return candidates.filter((dir) => fs.existsSync(dir));
}

function buildStateFilesStamp(files: string[]): string {
  return files
    .map((file) => {
      if (!fs.existsSync(file)) return `${file}:missing`;
      const stat = fs.statSync(file);
      return `${file}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
    })
    .join('|');
}

function extractAgentPatchesFromMap(
  map: Record<string, unknown>,
): AgentRuntimeSelectionInput[] {
  const patches: AgentRuntimeSelectionInput[] = [];

  for (const [rawAgentName, rawEntry] of Object.entries(map)) {
    const agentName = normalizeAgentName(rawAgentName);
    if (!agentName) continue;

    const entry = isObject(rawEntry) ? rawEntry : { model: rawEntry };
    const model = normalizeModelRef(entry.model ?? rawEntry) ?? undefined;
    const variant = normalizeStringValue(entry.variant);
    const providerID =
      normalizeProviderID(entry.providerID) ??
      (model ? normalizeProviderID(model.split('/')[0]) : undefined);
    const options = normalizeOptions(entry.options ?? entry.providerOptions);
    const apiKey = normalizeStringValue(entry.apiKey);
    const baseURL = normalizeStringValue(entry.baseURL);

    if (!model && !variant && !providerID && !options && !apiKey && !baseURL) {
      continue;
    }

    patches.push({
      agentName,
      model,
      variant,
      providerID,
      options,
      apiKey,
      baseURL,
    });
  }

  return patches;
}

function mergeRuntimePatch(
  grouped: Map<string, AgentRuntimeSelectionInput>,
  patch: AgentRuntimeSelectionInput,
): void {
  const key = normalizeAgentName(patch.agentName);
  if (!key) return;

  const next = {
    ...(grouped.get(key) ?? { agentName: key }),
    ...patch,
    agentName: key,
  };
  grouped.set(key, next);
}

function extractAgentPatchesFromFlatKeys(
  source: Record<string, unknown>,
): AgentRuntimeSelectionInput[] {
  const grouped = new Map<string, AgentRuntimeSelectionInput>();
  const keyRegex = /^(?:agent|agents)\.([^.]+)\.(model|variant|providerID|options|apiKey|baseURL)$/i;

  for (const [rawKey, value] of Object.entries(source)) {
    const match = rawKey.match(keyRegex);
    if (!match) continue;

    const agentName = normalizeAgentName(String(match[1] ?? ''));
    const field = String(match[2] ?? '');
    if (!agentName || !field) continue;

    const current = grouped.get(agentName) ?? { agentName };
    if (field === 'model') {
      const model = normalizeModelRef(value);
      if (model) {
        current.model = model;
        current.providerID = normalizeProviderID(model.split('/')[0]);
      }
    }
    if (field === 'variant') current.variant = normalizeStringValue(value);
    if (field === 'providerID') current.providerID = normalizeProviderID(value);
    if (field === 'options') current.options = normalizeOptions(value);
    if (field === 'apiKey') current.apiKey = normalizeStringValue(value);
    if (field === 'baseURL') current.baseURL = normalizeStringValue(value);
    grouped.set(agentName, current);
  }

  return [...grouped.values()];
}

function extractActiveAgentFromState(source: Record<string, unknown>): string | undefined {
  const candidates = [
    source.activeAgent,
    source.active_agent,
    source.defaultAgent,
    source.default_agent,
    source.agent,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeAgentName(String(candidate ?? ''));
    if (normalized) return normalized;
  }
  return undefined;
}

function extractPatchesFromStateObject(
  source: Record<string, unknown> | null,
): { patches: AgentRuntimeSelectionInput[]; activeAgentId?: string } {
  if (!source) return { patches: [] };

  const grouped = new Map<string, AgentRuntimeSelectionInput>();
  const mapCandidates = [
    source.agents,
    source.agentModels,
    source.modelsByAgent,
    source.byAgent,
    source.selectedByAgent,
  ];

  for (const mapCandidate of mapCandidates) {
    if (!isObject(mapCandidate)) continue;
    for (const patch of extractAgentPatchesFromMap(mapCandidate)) {
      mergeRuntimePatch(grouped, patch);
    }
  }

  for (const patch of extractAgentPatchesFromFlatKeys(source)) {
    mergeRuntimePatch(grouped, patch);
  }

  const activeAgentId = extractActiveAgentFromState(source);
  return { patches: [...grouped.values()], activeAgentId };
}

function modelTokenFromText(text: string): string | undefined {
  const match = text.match(OPEN_CODE_MODEL_TOKEN_RE);
  if (!match || !match[0]) return undefined;
  const token = match[0].trim();
  return normalizeModelRef(token) ?? undefined;
}

function tokensFromText(text: string): string[] {
  return text
    .split(/[\s,'"`;|]+/g)
    .map((token) => token.replace(/^[^a-z0-9_-]+|[^a-z0-9._/-]+$/gi, '').trim())
    .filter(Boolean);
}

function agentFromText(text: string): string | undefined {
  for (const token of tokensFromText(text)) {
    const normalized = normalizeAgentName(token);
    if (normalized) return normalized;
  }
  return undefined;
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

export function syncPersistedAgentRuntimeFromOpenCodeState(
  projectDir: string,
): boolean {
  const stateDirs = collectOpenCodeStateDirCandidates(projectDir);
  if (stateDirs.length === 0) return false;

  const modelFiles = stateDirs.map((dir) => path.join(dir, 'model.json'));
  const kvFiles = stateDirs.map((dir) => path.join(dir, 'kv.json'));
  const files = [...modelFiles, ...kvFiles];

  const stamp = buildStateFilesStamp(files);
  if (STATE_SYNC_STAMP_BY_DIR.get(projectDir) === stamp) {
    return false;
  }
  STATE_SYNC_STAMP_BY_DIR.set(projectDir, stamp);

  let changed = false;
  let activeAgentId: string | undefined;
  const grouped = new Map<string, AgentRuntimeSelectionInput>();

  for (const file of modelFiles) {
    const parsed = readJsonObjectFile(file);
    const result = extractPatchesFromStateObject(parsed);
    if (!activeAgentId && result.activeAgentId) {
      activeAgentId = result.activeAgentId;
    }
    for (const patch of result.patches) {
      mergeRuntimePatch(grouped, patch);
    }
  }

  for (const file of kvFiles) {
    const parsed = readJsonObjectFile(file);
    const result = extractPatchesFromStateObject(parsed);
    if (!activeAgentId && result.activeAgentId) {
      activeAgentId = result.activeAgentId;
    }
    for (const patch of result.patches) {
      mergeRuntimePatch(grouped, patch);
    }
  }

  for (const patch of grouped.values()) {
    const mergedPatch: AgentRuntimeSelectionInput = {
      ...patch,
      activeAgentId: patch.activeAgentId ?? activeAgentId,
    };
    changed = persistAgentRuntimeSelection(projectDir, mergedPatch) || changed;
  }

  if (activeAgentId && !grouped.has(activeAgentId)) {
    changed =
      persistAgentRuntimeSelection(projectDir, {
        agentName: activeAgentId,
        activeAgentId,
      }) || changed;
  }

  return changed;
}

export function extractAgentRuntimeSelectionsFromCommandEvent(
  event: unknown,
  activeAgentHint?: string,
): AgentRuntimeSelectionInput[] {
  if (!isObject(event) || !isObject(event.properties)) return [];

  const properties = event.properties;
  const eventType = String(event.type ?? '').trim().toLowerCase();
  const activeAgent = normalizeAgentName(String(activeAgentHint ?? '')) ?? undefined;
  const selections: AgentRuntimeSelectionInput[] = [];

  if (eventType === 'command.executed') {
    const commandName = String(properties.name ?? '').trim();
    const commandArgs = String(properties.arguments ?? '').trim();
    const loweredName = commandName.toLowerCase();

    if (loweredName.includes('agent')) {
      const selectedAgent = agentFromText(commandArgs) ?? agentFromText(commandName);
      if (selectedAgent) {
        selections.push({
          agentName: selectedAgent,
          activeAgentId: selectedAgent,
        });
      }
    }

    const isModelCommand =
      loweredName.includes('model') || /\bmodel\b/i.test(commandArgs);
    if (isModelCommand) {
      const selectedModel = modelTokenFromText(commandArgs) ?? modelTokenFromText(commandName);
      const selectedAgent =
        agentFromText(commandArgs) ?? agentFromText(commandName) ?? activeAgent;
      if (selectedAgent && selectedModel) {
        selections.push({
          agentName: selectedAgent,
          model: selectedModel,
          providerID: normalizeProviderID(selectedModel.split('/')[0]),
          activeAgentId: selectedAgent,
        });
      }
    }
  }

  if (eventType === 'tui.command.execute') {
    const command = String(properties.command ?? '').trim();
    const loweredCommand = command.toLowerCase();
    if (loweredCommand.includes('agent')) {
      const selectedAgent = agentFromText(command);
      if (selectedAgent) {
        selections.push({
          agentName: selectedAgent,
          activeAgentId: selectedAgent,
        });
      }
    }
    if (loweredCommand.includes('model') && activeAgent) {
      const selectedModel = modelTokenFromText(command);
      if (selectedModel) {
        selections.push({
          agentName: activeAgent,
          model: selectedModel,
          providerID: normalizeProviderID(selectedModel.split('/')[0]),
          activeAgentId: activeAgent,
        });
      }
    }
  }

  if (selections.length <= 1) {
    return selections;
  }

  const deduped = new Map<string, AgentRuntimeSelectionInput>();
  for (const selection of selections) {
    const key = [
      selection.agentName,
      String(selection.model ?? ''),
      String(selection.activeAgentId ?? ''),
    ].join('|');
    deduped.set(key, selection);
  }
  return [...deduped.values()];
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
  const model = normalizeModelRef(draft.model);
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

function parseAgentPatchSet(
  setMap: Record<string, unknown>,
  source: string,
  activeAgentHint?: string,
): AgentModelSelectionFromEvent[] {
  const drafts = new Map<string, AgentPatchDraft>();
  const providerDrafts = new Map<string, ProviderPatchDraft>();
  let defaultAgentFromPatch: string | undefined;
  for (const [rawKey, value] of Object.entries(setMap)) {
    const key = rawKey.trim();
    if (!key) continue;
    const parts = key.split('.');
    if (parts[0] === 'default_agent' && typeof value === 'string') {
      defaultAgentFromPatch = value;
      continue;
    }
    if (parts[0] === 'agent') {
      if (parts.length < 3) continue;
      const agentNameRaw = parts[1] ?? '';
      const field = parts.slice(2).join('.');
      const draft = drafts.get(agentNameRaw) ?? {
        agentName: agentNameRaw,
      };
      if (field === 'model') draft.model = value;
      if (field === 'variant') draft.variant = value;
      if (field === 'providerID') draft.providerID = value;
      if (field === 'options') draft.options = value;
      if (field === 'apiKey') draft.apiKey = value;
      if (field === 'baseURL') draft.baseURL = value;
      drafts.set(agentNameRaw, draft);
      continue;
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
      continue;
    }
  }

  const activeAgentFromHint =
    normalizeAgentName(String(defaultAgentFromPatch ?? activeAgentHint ?? '')) ?? undefined;
  if (providerDrafts.size > 0) {
    for (const providerPatch of providerDrafts.values()) {
      let targetDraft: AgentPatchDraft | undefined;
      for (const draft of drafts.values()) {
        const modelProvider = normalizeModelRef(draft.model)?.split('/')[0];
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
    const activeAgentHint = String(
      properties.activeAgent ?? properties.currentAgent ?? properties.agent ?? properties.default_agent ?? '',
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
