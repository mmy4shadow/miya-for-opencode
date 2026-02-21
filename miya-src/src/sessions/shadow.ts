import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

const NOISY_TOOLS = new Set([
  'bash',
  'miya_ralph_loop',
  'lsp_diagnostics',
  'grep',
  'ast_grep_search',
]);

function normalizeSessionID(sessionID?: string): string {
  const value = String(sessionID ?? 'main').trim();
  return value.length > 0 ? value : 'main';
}

function shouldCaptureTool(tool: string): boolean {
  const normalized = String(tool ?? '')
    .trim()
    .toLowerCase();
  if (normalized.includes('websearch')) return false;
  return NOISY_TOOLS.has(normalized);
}

function nowIso(): string {
  return new Date().toISOString();
}

function shadowFile(projectDir: string, sessionID: string): string {
  return path.join(
    getMiyaRuntimeDir(projectDir),
    'shadow-sessions',
    `${normalizeSessionID(sessionID)}.jsonl`,
  );
}

export function shouldRouteToShadowSession(input: {
  tool?: string;
  output?: string;
}): boolean {
  const tool = String(input.tool ?? '').trim();
  if (tool.toLowerCase().includes('websearch')) return false;
  const output = String(input.output ?? '');
  if (output.length >= 2400) return true;
  if (shouldCaptureTool(tool) && output.length >= 800) return true;
  return false;
}

export function appendShadowSessionLog(input: {
  projectDir: string;
  sessionID?: string;
  tool: string;
  callID?: string;
  output: string;
}): string {
  const file = shadowFile(
    input.projectDir,
    normalizeSessionID(input.sessionID),
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row = {
    at: nowIso(),
    tool: String(input.tool ?? '').trim() || 'unknown',
    callID: input.callID,
    outputChars: String(input.output ?? '').length,
    output: String(input.output ?? ''),
  };
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf-8');
  return file;
}
