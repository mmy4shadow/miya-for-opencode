import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PolicyDomain } from './index';
import { getMiyaRuntimeDir } from '../workflow';

export interface PolicyIncident {
  id: string;
  at: string;
  type:
    | 'friend_tier_sensitive_violation'
    | 'friend_tier_initiate_violation'
    | 'decision_fusion_soft'
    | 'decision_fusion_hard'
    | 'manual_pause'
    | 'manual_resume';
  reason: string;
  channel?: string;
  destination?: string;
  auditID?: string;
  policyHash?: string;
  pausedDomains?: PolicyDomain[];
  statusByDomain?: Partial<Record<PolicyDomain, 'running' | 'paused'>>;
  semanticSummary?: {
    trigger: string;
    keyAssertion: string;
    recovery: string;
  };
  details?: Record<string, unknown>;
}

function incidentFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'policy-incidents.jsonl');
}

export function appendPolicyIncident(
  projectDir: string,
  incident: Omit<PolicyIncident, 'id' | 'at'> & { id?: string; at?: string },
): PolicyIncident {
  const payload: PolicyIncident = {
    id: incident.id ?? `incident_${randomUUID()}`,
    at: incident.at ?? new Date().toISOString(),
    type: incident.type,
    reason: incident.reason,
    channel: incident.channel,
    destination: incident.destination,
    auditID: incident.auditID,
    policyHash: incident.policyHash,
    pausedDomains: incident.pausedDomains,
    statusByDomain: incident.statusByDomain,
    semanticSummary: incident.semanticSummary,
    details: incident.details,
  };
  const file = incidentFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(payload)}\n`, 'utf-8');
  return payload;
}

export function listPolicyIncidents(projectDir: string, limit = 50): PolicyIncident[] {
  const file = incidentFile(projectDir);
  if (!fs.existsSync(file)) return [];
  const rows = fs
    .readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as PolicyIncident;
      } catch {
        return null;
      }
    })
    .filter((row): row is PolicyIncident => Boolean(row));
  return rows
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, Math.max(1, limit));
}
