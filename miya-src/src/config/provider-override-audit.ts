import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

export interface ProviderOverrideAuditEntry {
  at: string;
  source: string;
  agentName: string;
  model?: string;
  providerID?: string;
  activeAgentId?: string;
  hasApiKey: boolean;
  hasBaseURL: boolean;
  optionKeys: string[];
}

function providerOverrideAuditFile(projectDir: string): string {
  return path.join(
    getMiyaRuntimeDir(projectDir),
    'audit',
    'provider-overrides.jsonl',
  );
}

export function appendProviderOverrideAudit(
  projectDir: string,
  input: Omit<ProviderOverrideAuditEntry, 'at'>,
): ProviderOverrideAuditEntry {
  const entry: ProviderOverrideAuditEntry = {
    at: new Date().toISOString(),
    source: input.source,
    agentName: input.agentName,
    model: input.model,
    providerID: input.providerID,
    activeAgentId: input.activeAgentId,
    hasApiKey: input.hasApiKey,
    hasBaseURL: input.hasBaseURL,
    optionKeys: [...input.optionKeys].sort(),
  };
  const file = providerOverrideAuditFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf-8');
  return entry;
}

export function listProviderOverrideAudits(
  projectDir: string,
  limit = 50,
): ProviderOverrideAuditEntry[] {
  const file = providerOverrideAuditFile(projectDir);
  if (!fs.existsSync(file)) return [];
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean);
  return lines
    .slice(-safeLimit)
    .map((line) => {
      try {
        return JSON.parse(line) as ProviderOverrideAuditEntry;
      } catch {
        return null;
      }
    })
    .filter((item): item is ProviderOverrideAuditEntry => item !== null)
    .reverse();
}
