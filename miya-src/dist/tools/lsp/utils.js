// LSP Utilities - Essential formatters and helpers
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync, } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lspManager } from './client';
import { findServerForExtension } from './config';
import { SEVERITY_MAP, SYMBOL_KIND_MAP } from './constants';
export function findWorkspaceRoot(filePath) {
    let dir = resolve(filePath);
    try {
        if (!statSync(dir).isDirectory()) {
            dir = dirname(dir);
        }
    }
    catch {
        dir = dirname(dir);
    }
    const markers = [
        '.git',
        'package.json',
        'pyproject.toml',
        'Cargo.toml',
        'go.mod',
    ];
    let prevDir = '';
    while (dir !== prevDir) {
        for (const marker of markers) {
            if (existsSync(join(dir, marker))) {
                return dir;
            }
        }
        prevDir = dir;
        dir = dirname(dir);
    }
    return dirname(resolve(filePath));
}
export function uriToPath(uri) {
    return fileURLToPath(uri);
}
export function formatServerLookupError(result) {
    if (result.status === 'not_installed') {
        return [
            `LSP server '${result.server.id}' is NOT INSTALLED.`,
            ``,
            `Command not found: ${result.server.command[0]}`,
            ``,
            `To install: ${result.installHint}`,
        ].join('\n');
    }
    return `No LSP server configured for extension: ${result.extension}`;
}
export async function withLspClient(filePath, fn) {
    const absPath = resolve(filePath);
    const ext = extname(absPath);
    const result = findServerForExtension(ext);
    if (result.status !== 'found') {
        throw new Error(formatServerLookupError(result));
    }
    const server = result.server;
    const root = findWorkspaceRoot(absPath);
    const client = await lspManager.getClient(root, server);
    try {
        return await fn(client);
    }
    catch (e) {
        if (e instanceof Error && e.message.includes('timeout')) {
            const isInitializing = lspManager.isServerInitializing(root, server.id);
            if (isInitializing) {
                throw new Error(`LSP server is still initializing. Please retry in a few seconds.`);
            }
        }
        throw e;
    }
    finally {
        lspManager.releaseClient(root, server.id);
    }
}
export function formatLocation(loc) {
    if ('targetUri' in loc) {
        const uri = uriToPath(loc.targetUri);
        const line = loc.targetRange.start.line + 1;
        const char = loc.targetRange.start.character;
        return `${uri}:${line}:${char}`;
    }
    const uri = uriToPath(loc.uri);
    const line = loc.range.start.line + 1;
    const char = loc.range.start.character;
    return `${uri}:${line}:${char}`;
}
export function formatSymbolKind(kind) {
    return SYMBOL_KIND_MAP[kind] || `Unknown(${kind})`;
}
export function formatSeverity(severity) {
    if (!severity)
        return 'unknown';
    return SEVERITY_MAP[severity] || `unknown(${severity})`;
}
export function formatDiagnostic(diag) {
    const severity = formatSeverity(diag.severity);
    const line = diag.range.start.line + 1;
    const char = diag.range.start.character;
    const source = diag.source ? `[${diag.source}]` : '';
    const code = diag.code ? ` (${diag.code})` : '';
    return `${severity}${source}${code} at ${line}:${char}: ${diag.message}`;
}
export function filterDiagnosticsBySeverity(diagnostics, severityFilter) {
    if (!severityFilter || severityFilter === 'all') {
        return diagnostics;
    }
    const severityMap = {
        error: 1,
        warning: 2,
        information: 3,
        hint: 4,
    };
    const targetSeverity = severityMap[severityFilter];
    return diagnostics.filter((d) => d.severity === targetSeverity);
}
// WorkspaceEdit application
function applyTextEditsToFile(filePath, edits) {
    try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const sortedEdits = [...edits].sort((a, b) => {
            if (b.range.start.line !== a.range.start.line) {
                return b.range.start.line - a.range.start.line;
            }
            return b.range.start.character - a.range.start.character;
        });
        for (const edit of sortedEdits) {
            const startLine = edit.range.start.line;
            const startChar = edit.range.start.character;
            const endLine = edit.range.end.line;
            const endChar = edit.range.end.character;
            if (startLine === endLine) {
                const line = lines[startLine] || '';
                lines[startLine] =
                    line.substring(0, startChar) + edit.newText + line.substring(endChar);
            }
            else {
                const firstLine = lines[startLine] || '';
                const lastLine = lines[endLine] || '';
                const newContent = firstLine.substring(0, startChar) +
                    edit.newText +
                    lastLine.substring(endChar);
                lines.splice(startLine, endLine - startLine + 1, ...newContent.split('\n'));
            }
        }
        writeFileSync(filePath, lines.join('\n'), 'utf-8');
        return { success: true, editCount: edits.length };
    }
    catch (err) {
        return {
            success: false,
            editCount: 0,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
export function applyWorkspaceEdit(edit) {
    if (!edit) {
        return {
            success: false,
            filesModified: [],
            totalEdits: 0,
            errors: ['No edit provided'],
        };
    }
    const result = {
        success: true,
        filesModified: [],
        totalEdits: 0,
        errors: [],
    };
    if (edit.changes) {
        for (const [uri, edits] of Object.entries(edit.changes)) {
            const filePath = uriToPath(uri);
            const applyResult = applyTextEditsToFile(filePath, edits);
            if (applyResult.success) {
                result.filesModified.push(filePath);
                result.totalEdits += applyResult.editCount;
            }
            else {
                result.success = false;
                result.errors.push(`${filePath}: ${applyResult.error}`);
            }
        }
    }
    if (edit.documentChanges) {
        for (const change of edit.documentChanges) {
            if ('kind' in change) {
                if (change.kind === 'create') {
                    try {
                        const filePath = uriToPath(change.uri);
                        writeFileSync(filePath, '', 'utf-8');
                        result.filesModified.push(filePath);
                    }
                    catch (err) {
                        result.success = false;
                        result.errors.push(`Create ${change.uri}: ${err}`);
                    }
                }
                else if (change.kind === 'rename') {
                    try {
                        const oldPath = uriToPath(change.oldUri);
                        const newPath = uriToPath(change.newUri);
                        const content = readFileSync(oldPath, 'utf-8');
                        writeFileSync(newPath, content, 'utf-8');
                        unlinkSync(oldPath);
                        result.filesModified.push(newPath);
                    }
                    catch (err) {
                        result.success = false;
                        result.errors.push(`Rename ${change.oldUri}: ${err}`);
                    }
                }
                else if (change.kind === 'delete') {
                    try {
                        const filePath = uriToPath(change.uri);
                        unlinkSync(filePath);
                        result.filesModified.push(filePath);
                    }
                    catch (err) {
                        result.success = false;
                        result.errors.push(`Delete ${change.uri}: ${err}`);
                    }
                }
            }
            else {
                const filePath = uriToPath(change.textDocument.uri);
                const applyResult = applyTextEditsToFile(filePath, change.edits);
                if (applyResult.success) {
                    result.filesModified.push(filePath);
                    result.totalEdits += applyResult.editCount;
                }
                else {
                    result.success = false;
                    result.errors.push(`${filePath}: ${applyResult.error}`);
                }
            }
        }
    }
    return result;
}
export function formatApplyResult(result) {
    const lines = [];
    if (result.success) {
        lines.push(`Applied ${result.totalEdits} edit(s) to ${result.filesModified.length} file(s):`);
        for (const file of result.filesModified) {
            lines.push(`  - ${file}`);
        }
    }
    else {
        lines.push('Failed to apply some changes:');
        for (const err of result.errors) {
            lines.push(`  Error: ${err}`);
        }
        if (result.filesModified.length > 0) {
            lines.push(`Successfully modified: ${result.filesModified.join(', ')}`);
        }
    }
    return lines.join('\n');
}
