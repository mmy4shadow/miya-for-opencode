import type { ConfigMergeResult, DetectedConfig, InstallConfig, OpenCodeConfig } from './types';
/**
 * Strip JSON comments (single-line // and multi-line) and trailing commas for JSONC support.
 */
export declare function stripJsonComments(json: string): string;
export declare function parseConfigFile(path: string): {
    config: OpenCodeConfig | null;
    error?: string;
};
export declare function parseConfig(path: string): {
    config: OpenCodeConfig | null;
    error?: string;
};
/**
 * Write config to file atomically.
 */
export declare function writeConfig(configPath: string, config: OpenCodeConfig): void;
export declare function addPluginToOpenCodeConfig(): Promise<ConfigMergeResult>;
export declare function writeLiteConfig(installConfig: InstallConfig): ConfigMergeResult;
export declare function disableDefaultAgents(): ConfigMergeResult;
export declare function canModifyOpenCodeConfig(): boolean;
export declare function addAntigravityPlugin(): ConfigMergeResult;
export declare function addGoogleProvider(): ConfigMergeResult;
export declare function addChutesProvider(): ConfigMergeResult;
export declare function detectAntigravityConfig(): boolean;
export declare function detectCurrentConfig(): DetectedConfig;
