import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

export interface MiyaPolicy {
  version: number;
  updatedAt: string;
  domains: {
    outbound_send: 'running' | 'paused';
    desktop_control: 'running' | 'paused';
  };
  outbound: {
    allowedChannels: Array<'qq' | 'wechat'>;
    requireArchAdvisorApproval: boolean;
    requireAllowlist: boolean;
    minIntervalMs: number;
    burstWindowMs: number;
    burstLimit: number;
    duplicateWindowMs: number;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function policyFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'policy.json');
}

function defaultPolicy(): MiyaPolicy {
  return {
    version: 1,
    updatedAt: nowIso(),
    domains: {
      outbound_send: 'running',
      desktop_control: 'running',
    },
    outbound: {
      allowedChannels: ['qq', 'wechat'],
      requireArchAdvisorApproval: true,
      requireAllowlist: true,
      minIntervalMs: 4000,
      burstWindowMs: 60_000,
      burstLimit: 3,
      duplicateWindowMs: 60_000,
    },
  };
}

export function readPolicy(projectDir: string): MiyaPolicy {
  const file = policyFile(projectDir);
  if (!fs.existsSync(file)) {
    const base = defaultPolicy();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(base, null, 2)}\n`, 'utf-8');
    return base;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<MiyaPolicy>;
    const base = defaultPolicy();
    return {
      ...base,
      ...parsed,
      outbound: {
        ...base.outbound,
        ...(parsed.outbound ?? {}),
      },
    };
  } catch {
    return defaultPolicy();
  }
}

export function writePolicy(
  projectDir: string,
  patch: Partial<MiyaPolicy> & {
    outbound?: Partial<MiyaPolicy['outbound']>;
  },
): MiyaPolicy {
  const file = policyFile(projectDir);
  const current = readPolicy(projectDir);
  const next: MiyaPolicy = {
    ...current,
    ...patch,
    outbound: {
      ...current.outbound,
      ...(patch.outbound ?? {}),
    },
    updatedAt: nowIso(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

export function hashPolicy(policy: MiyaPolicy): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: policy.version,
        domains: policy.domains,
        outbound: policy.outbound,
      }),
    )
    .digest('hex');
}

export function currentPolicyHash(projectDir: string): string {
  return hashPolicy(readPolicy(projectDir));
}

export function assertPolicyHash(
  projectDir: string,
  providedHash: string | undefined,
): { ok: true; hash: string } | { ok: false; hash: string; reason: string } {
  const hash = currentPolicyHash(projectDir);
  if (!providedHash) {
    return { ok: false, hash, reason: 'missing_policy_hash' };
  }
  if (providedHash !== hash) {
    return { ok: false, hash, reason: 'policy_hash_mismatch' };
  }
  return { ok: true, hash };
}

export function isDomainRunning(
  projectDir: string,
  domain: keyof MiyaPolicy['domains'],
): boolean {
  const policy = readPolicy(projectDir);
  return policy.domains[domain] === 'running';
}
