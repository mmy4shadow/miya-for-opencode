import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import {
  type MiyaConfigRisk,
  type MiyaConfigType,
  type MiyaSettingEntry,
  buildDefaultConfig,
  buildRegistryDocument,
  buildSchemaDocument,
  getNestedValue,
  getSettingEntry,
  listSettingEntries,
  setNestedValue,
} from './registry';

export interface NormalizedConfigPatch {
  set: Record<string, unknown>;
  unset: string[];
}

export interface ConfigValidationChange {
  key: string;
  operation: 'set' | 'reset';
  risk: MiyaConfigRisk;
  description: string;
  previousValue: unknown;
  nextValue: unknown;
  requiresEvidence: boolean;
}

export interface ConfigValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  normalizedPatch: NormalizedConfigPatch;
  changes: ConfigValidationChange[];
  maxRisk: MiyaConfigRisk;
  requiresEvidence: boolean;
  requiredSafetyTier: 'LIGHT' | 'STANDARD' | 'THOROUGH';
}

const EMPTY_PATCH: NormalizedConfigPatch = { set: {}, unset: [] };

function runtimeFile(projectDir: string, fileName: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), fileName);
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function writeJson(file: string, value: unknown): void {
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function readJsonObject(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function riskRank(risk: MiyaConfigRisk): number {
  if (risk === 'HIGH') return 3;
  if (risk === 'MED') return 2;
  return 1;
}

function maxRisk(current: MiyaConfigRisk, next: MiyaConfigRisk): MiyaConfigRisk {
  return riskRank(next) > riskRank(current) ? next : current;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizePathToKey(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) {
    return trimmed
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .join('.');
  }
  return trimmed;
}

function normalizePatchObject(
  input: Record<string, unknown>,
): { patch: NormalizedConfigPatch; errors: string[] } {
  if ('jsonPatch' in input && Array.isArray(input.jsonPatch)) {
    return normalizePatchInput(input.jsonPatch);
  }

  if ('patch' in input && input.patch !== undefined) {
    return normalizePatchInput(input.patch);
  }

  const setRaw =
    'set' in input && input.set && typeof input.set === 'object'
      ? (input.set as Record<string, unknown>)
      : null;
  const unsetRaw =
    'unset' in input && Array.isArray(input.unset)
      ? input.unset
      : 'reset' in input && Array.isArray(input.reset)
        ? input.reset
        : null;

  if (setRaw || unsetRaw) {
    const patch: NormalizedConfigPatch = {
      set: {},
      unset: [],
    };
    const errors: string[] = [];

    if (setRaw) {
      for (const [key, value] of Object.entries(setRaw)) {
        const normalizedKey = normalizePathToKey(key);
        if (!normalizedKey) {
          errors.push(`Invalid set key: ${key}`);
          continue;
        }
        patch.set[normalizedKey] = value;
      }
    }

    if (unsetRaw) {
      for (const key of unsetRaw) {
        const normalizedKey = normalizePathToKey(String(key));
        if (!normalizedKey) {
          errors.push(`Invalid unset key: ${String(key)}`);
          continue;
        }
        patch.unset.push(normalizedKey);
      }
    }

    patch.unset = [...new Set(patch.unset)];
    return { patch, errors };
  }

  const patch: NormalizedConfigPatch = { set: {}, unset: [] };
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = normalizePathToKey(key);
    if (!normalizedKey) continue;
    patch.set[normalizedKey] = value;
  }
  return { patch, errors: [] };
}

function normalizeJsonPatchArray(
  input: unknown[],
): { patch: NormalizedConfigPatch; errors: string[] } {
  const patch: NormalizedConfigPatch = { set: {}, unset: [] };
  const errors: string[] = [];

  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push('JSON Patch item must be an object.');
      continue;
    }

    const op = String((item as Record<string, unknown>).op ?? '').toLowerCase();
    const pathValue = String((item as Record<string, unknown>).path ?? '');
    const key = normalizePathToKey(pathValue);
    if (!key) {
      errors.push(`JSON Patch path is invalid: ${pathValue}`);
      continue;
    }

    if (op === 'remove') {
      patch.unset.push(key);
      continue;
    }

    if (op === 'add' || op === 'replace' || op === 'set') {
      patch.set[key] = (item as Record<string, unknown>).value;
      continue;
    }

    errors.push(`Unsupported JSON Patch operation: ${op}`);
  }

  patch.unset = [...new Set(patch.unset)];
  return { patch, errors };
}

function validateValueType(
  entryValue: MiyaSettingEntry,
  value: unknown,
): string | null {
  const valueType = entryValue.type as MiyaConfigType;
  if (valueType === 'boolean') {
    return typeof value === 'boolean'
      ? null
      : `Expected boolean for ${entryValue.key}.`;
  }

  if (valueType === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return `Expected integer for ${entryValue.key}.`;
    }
    if (
      typeof entryValue.minimum === 'number' &&
      value < entryValue.minimum
    ) {
      return `${entryValue.key} must be >= ${entryValue.minimum}.`;
    }
    if (
      typeof entryValue.maximum === 'number' &&
      value > entryValue.maximum
    ) {
      return `${entryValue.key} must be <= ${entryValue.maximum}.`;
    }
    return null;
  }

  if (valueType === 'string') {
    return typeof value === 'string' ? null : `Expected string for ${entryValue.key}.`;
  }

  if (valueType === 'enum') {
    if (typeof value !== 'string') {
      return `Expected enum string for ${entryValue.key}.`;
    }
    const options = entryValue.enumValues ?? [];
    if (!options.includes(value)) {
      return `${entryValue.key} must be one of: ${options.join(', ')}.`;
    }
    return null;
  }

  if (valueType === 'object') {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? null
      : `Expected object for ${entryValue.key}.`;
  }

  if (valueType === 'array') {
    return Array.isArray(value) ? null : `Expected array for ${entryValue.key}.`;
  }

  return `Unsupported type for ${entryValue.key}.`;
}

function mergeConfigWithDefaults(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const merged = cloneValue(raw);
  for (const item of listSettingEntries()) {
    const current = getNestedValue(merged, item.key);
    if (current === undefined) {
      setNestedValue(merged, item.key, cloneValue(item.defaultValue));
      continue;
    }
    const issue = validateValueType(item, current);
    if (issue) {
      setNestedValue(merged, item.key, cloneValue(item.defaultValue));
    }
  }
  return merged;
}

export function ensureSettingsFiles(projectDir: string): void {
  const registryPath = runtimeFile(projectDir, 'registry.json');
  const schemaPath = runtimeFile(projectDir, 'schema.json');
  const configPath = runtimeFile(projectDir, 'config.json');

  writeJson(registryPath, buildRegistryDocument());
  writeJson(schemaPath, buildSchemaDocument());

  if (!fs.existsSync(configPath)) {
    writeJson(configPath, buildDefaultConfig());
    return;
  }

  const raw = readJsonObject(configPath);
  const normalized = mergeConfigWithDefaults(raw);
  writeJson(configPath, normalized);
}

export function readConfig(projectDir: string): Record<string, unknown> {
  ensureSettingsFiles(projectDir);
  const raw = readJsonObject(runtimeFile(projectDir, 'config.json'));
  return mergeConfigWithDefaults(raw);
}

export function writeConfig(
  projectDir: string,
  config: Record<string, unknown>,
): void {
  ensureSettingsFiles(projectDir);
  writeJson(runtimeFile(projectDir, 'config.json'), mergeConfigWithDefaults(config));
}

export function flattenConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const item of listSettingEntries()) {
    flat[item.key] = getNestedValue(config, item.key);
  }
  return flat;
}

export function normalizePatchInput(input: unknown): {
  patch: NormalizedConfigPatch;
  errors: string[];
} {
  if (!input) {
    return { patch: cloneValue(EMPTY_PATCH), errors: ['Patch payload is empty.'] };
  }

  if (Array.isArray(input)) {
    return normalizeJsonPatchArray(input);
  }

  if (typeof input !== 'object') {
    return {
      patch: cloneValue(EMPTY_PATCH),
      errors: ['Patch payload must be an object or JSON Patch array.'],
    };
  }

  return normalizePatchObject(input as Record<string, unknown>);
}

export function validateConfigPatch(
  projectDir: string,
  patchInput: unknown,
): ConfigValidationResult {
  const currentConfig = readConfig(projectDir);
  const normalized = normalizePatchInput(patchInput);
  const errors = [...normalized.errors];
  const warnings: string[] = [];
  const changes: ConfigValidationChange[] = [];

  const keysToCheck = [
    ...Object.keys(normalized.patch.set),
    ...normalized.patch.unset,
  ];
  const uniqueKeys = [...new Set(keysToCheck)];

  for (const key of uniqueKeys) {
    const setting = getSettingEntry(key);
    if (!setting) {
      errors.push(`Unknown setting key: ${key}`);
      continue;
    }

    const isReset = normalized.patch.unset.includes(key);
    const nextValue = isReset
      ? cloneValue(setting.defaultValue)
      : normalized.patch.set[key];
    const previousValue = getNestedValue(currentConfig, key);
    const issue = validateValueType(setting, nextValue);
    if (issue) {
      errors.push(issue);
      continue;
    }

    if (deepEqual(previousValue, nextValue)) {
      warnings.push(`${key} is unchanged.`);
      continue;
    }

    changes.push({
      key,
      operation: isReset ? 'reset' : 'set',
      risk: setting.risk,
      description: setting.description,
      previousValue,
      nextValue,
      requiresEvidence: setting.requiresEvidence,
    });
  }

  let highestRisk: MiyaConfigRisk = 'LOW';
  for (const change of changes) {
    highestRisk = maxRisk(highestRisk, change.risk);
  }

  if (
    normalized.patch.set['outbound.enabled'] === true &&
    normalized.patch.set['desktop.requirePreSendScreenshotVerify'] === false
  ) {
    errors.push(
      'outbound.enabled=true 时不允许将 desktop.requirePreSendScreenshotVerify 设为 false。',
    );
  }

  if (changes.length === 0 && errors.length === 0) {
    warnings.push('Patch has no effective changes.');
  }

  const requiredSafetyTier =
    highestRisk === 'HIGH'
      ? 'THOROUGH'
      : highestRisk === 'MED'
        ? 'STANDARD'
        : 'LIGHT';

  return {
    ok: errors.length === 0 && changes.length > 0,
    errors,
    warnings,
    normalizedPatch: normalized.patch,
    changes,
    maxRisk: highestRisk,
    requiresEvidence: changes.some((change) => change.requiresEvidence),
    requiredSafetyTier,
  };
}

export function applyConfigPatch(
  projectDir: string,
  validation: ConfigValidationResult,
): {
  updatedConfig: Record<string, unknown>;
  applied: ConfigValidationChange[];
} {
  const config = readConfig(projectDir);
  for (const change of validation.changes) {
    setNestedValue(config, change.key, cloneValue(change.nextValue));
  }
  writeConfig(projectDir, config);
  return {
    updatedConfig: readConfig(projectDir),
    applied: validation.changes,
  };
}

export function getConfigValue(
  projectDir: string,
  key?: string,
): unknown {
  const config = readConfig(projectDir);
  if (!key) return flattenConfig(config);
  return getNestedValue(config, key);
}

