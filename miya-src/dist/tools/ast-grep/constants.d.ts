import { CLI_LANGUAGES } from './types';
export declare function findSgCliPathSync(): string | null;
export declare function getSgCliPath(): string;
export declare function setSgCliPath(path: string): void;
export { CLI_LANGUAGES };
export declare const DEFAULT_TIMEOUT_MS = 300000;
export declare const DEFAULT_MAX_OUTPUT_BYTES: number;
export declare const DEFAULT_MAX_MATCHES = 500;
export declare const LANG_EXTENSIONS: Record<string, string[]>;
export interface EnvironmentCheckResult {
    cli: {
        available: boolean;
        path: string;
        error?: string;
    };
}
/**
 * Check if ast-grep CLI is available.
 * Call this at startup to provide early feedback about missing dependencies.
 */
export declare function checkEnvironment(): EnvironmentCheckResult;
/**
 * Format environment check result as user-friendly message.
 */
export declare function formatEnvironmentCheck(result: EnvironmentCheckResult): string;
