import type { PluginEntryInfo } from './types';
/**
 * Extracts the update channel (latest, alpha, beta, etc.) from a version string.
 * @param version The version or tag to analyze.
 * @returns The channel name.
 */
export declare function extractChannel(version: string | null): string;
/**
 * Resolves the version of the plugin when running in local development mode.
 */
export declare function getLocalDevVersion(directory: string): string | null;
/**
 * Searches across all config locations to find the current installation entry for this plugin.
 */
export declare function findPluginEntry(directory: string): PluginEntryInfo | null;
/**
 * Resolves the installed version from node_modules, with memoization.
 */
export declare function getCachedVersion(): string | null;
/**
 * Safely updates a pinned version in the configuration file.
 * It attempts to replace the exact plugin string to preserve comments and formatting.
 */
export declare function updatePinnedVersion(configPath: string, oldEntry: string, newVersion: string): boolean;
/**
 * Fetches the latest version for a specific channel from the NPM registry.
 */
export declare function getLatestVersion(channel?: string): Promise<string | null>;
