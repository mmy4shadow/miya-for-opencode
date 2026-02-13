export type MiyaConfigRisk = 'LOW' | 'MED' | 'HIGH';
export type MiyaConfigType = 'boolean' | 'integer' | 'string' | 'enum' | 'object' | 'array';
export interface MiyaSettingEntry {
    key: string;
    type: MiyaConfigType;
    defaultValue: unknown;
    risk: MiyaConfigRisk;
    description: string;
    requiresEvidence: boolean;
    minimum?: number;
    maximum?: number;
    enumValues?: string[];
}
export declare function keySegments(key: string): string[];
export declare function getNestedValue(root: unknown, key: string): unknown;
export declare function setNestedValue(root: Record<string, unknown>, key: string, value: unknown): void;
export declare const SETTINGS_REGISTRY: MiyaSettingEntry[];
export declare function getSettingEntry(key: string): MiyaSettingEntry | undefined;
export declare function listSettingEntries(): MiyaSettingEntry[];
export declare function buildDefaultConfig(): Record<string, unknown>;
export declare function buildRegistryDocument(): Record<string, unknown>;
export declare function buildSchemaDocument(): Record<string, unknown>;
