import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PolicyDomain } from '../policy';
import { POLICY_DOMAINS, readPolicy, writePolicy } from '../policy';
import { getMiyaRuntimeDir } from '../workflow';

export type DomainSafetyState = 'running' | 'paused' | 'killed';

export interface SafetyStateMachine {
  version: 1;
  updatedAt: string;
  globalState: 'running' | 'killed';
  reason?: string;
  traceID?: string;
  domains: Record<PolicyDomain, DomainSafetyState>;
}

export interface SafetyTransitionAudit {
  id: string;
  at: string;
  source: string;
  reason: string;
  traceID?: string;
  policyHash?: string;
  globalState: 'running' | 'killed';
  domains: Partial<Record<PolicyDomain, DomainSafetyState>>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stateFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'safety-state.json');
}

function auditFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'safety-state-audit.jsonl');
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function defaultState(): SafetyStateMachine {
  return {
    version: 1,
    updatedAt: nowIso(),
    globalState: 'running',
    domains: Object.fromEntries(
      POLICY_DOMAINS.map((domain) => [domain, 'running' as const]),
    ) as Record<PolicyDomain, DomainSafetyState>,
  };
}

function writeState(projectDir: string, state: SafetyStateMachine): SafetyStateMachine {
  const file = stateFile(projectDir);
  const next = {
    ...state,
    updatedAt: nowIso(),
  };
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

export function readSafetyState(projectDir: string): SafetyStateMachine {
  const file = stateFile(projectDir);
  if (!fs.existsSync(file)) {
    const created = defaultState();
    return writeState(projectDir, created);
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<SafetyStateMachine>;
    const base = defaultState();
    const domains = {
      ...base.domains,
      ...(parsed.domains ?? {}),
    };
    return {
      ...base,
      ...parsed,
      domains,
    };
  } catch {
    return defaultState();
  }
}

function appendAudit(projectDir: string, row: SafetyTransitionAudit): void {
  const file = auditFile(projectDir);
  ensureDir(file);
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf-8');
}

function syncPolicyDomain(projectDir: string, domain: PolicyDomain, state: DomainSafetyState): void {
  const policy = readPolicy(projectDir);
  const mapped = state === 'running' ? 'running' : 'paused';
  if (policy.domains[domain] === mapped) return;
  writePolicy(projectDir, {
    domains: {
      ...policy.domains,
      [domain]: mapped,
    },
  });
}

export function transitionSafetyState(
  projectDir: string,
  input: {
    source: string;
    reason: string;
    traceID?: string;
    policyHash?: string;
    globalState?: 'running' | 'killed';
    domains?: Partial<Record<PolicyDomain, DomainSafetyState>>;
  },
): SafetyStateMachine {
  const current = readSafetyState(projectDir);
  const next: SafetyStateMachine = {
    ...current,
    globalState: input.globalState ?? current.globalState,
    reason: input.reason,
    traceID: input.traceID ?? current.traceID,
    domains: {
      ...current.domains,
      ...(input.domains ?? {}),
    },
  };
  const written = writeState(projectDir, next);
  for (const domain of POLICY_DOMAINS) {
    syncPolicyDomain(projectDir, domain, written.domains[domain]);
  }
  appendAudit(projectDir, {
    id: `safety_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    at: nowIso(),
    source: input.source,
    reason: input.reason,
    traceID: input.traceID,
    policyHash: input.policyHash,
    globalState: written.globalState,
    domains: input.domains ?? {},
  });
  return written;
}

export function isDomainExecutionAllowed(projectDir: string, domain: PolicyDomain): boolean {
  const state = readSafetyState(projectDir);
  if (state.globalState === 'killed') return false;
  return state.domains[domain] === 'running';
}
