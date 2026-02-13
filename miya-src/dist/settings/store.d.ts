import { type MiyaConfigRisk } from './registry';
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
export declare function ensureSettingsFiles(projectDir: string): void;
export declare function readConfig(projectDir: string): Record<string, unknown>;
export declare function writeConfig(projectDir: string, config: Record<string, unknown>): void;
export declare function flattenConfig(config: Record<string, unknown>): Record<string, unknown>;
export declare function normalizePatchInput(input: unknown): {
    patch: NormalizedConfigPatch;
    errors: string[];
};
export declare function validateConfigPatch(projectDir: string, patchInput: unknown): ConfigValidationResult;
export declare function applyConfigPatch(projectDir: string, validation: ConfigValidationResult): {
    updatedConfig: Record<string, unknown>;
    applied: ConfigValidationChange[];
};
export declare function getConfigValue(projectDir: string, key?: string): unknown;
