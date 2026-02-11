import type { LSPClient } from './client';
import type { Diagnostic, Location, LocationLink, ServerLookupResult, WorkspaceEdit } from './types';
export declare function findWorkspaceRoot(filePath: string): string;
export declare function uriToPath(uri: string): string;
export declare function formatServerLookupError(result: Exclude<ServerLookupResult, {
    status: 'found';
}>): string;
export declare function withLspClient<T>(filePath: string, fn: (client: LSPClient) => Promise<T>): Promise<T>;
export declare function formatLocation(loc: Location | LocationLink): string;
export declare function formatSymbolKind(kind: number): string;
export declare function formatSeverity(severity: number | undefined): string;
export declare function formatDiagnostic(diag: Diagnostic): string;
export declare function filterDiagnosticsBySeverity(diagnostics: Diagnostic[], severityFilter?: 'error' | 'warning' | 'information' | 'hint' | 'all'): Diagnostic[];
export interface ApplyResult {
    success: boolean;
    filesModified: string[];
    totalEdits: number;
    errors: string[];
}
export declare function applyWorkspaceEdit(edit: WorkspaceEdit | null): ApplyResult;
export declare function formatApplyResult(result: ApplyResult): string;
