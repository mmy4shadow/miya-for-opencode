import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import type { AutopilotPlan, AutopilotPlanStep, PlanBundleMode, PlanBundleRiskTier } from './types';

interface PlanReuseTemplate {
  signature: string;
  templateId: string;
  analysisStepTitles: string[];
  commandCount: number;
  verificationEnabled: boolean;
  lastBundleId: string;
  hits: number;
  createdAt: string;
  updatedAt: string;
}

interface PlanReuseStore {
  templates: Record<string, PlanReuseTemplate>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function reuseFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'autopilot-plan-reuse.json');
}

function ensureDir(projectDir: string): void {
  fs.mkdirSync(getMiyaRuntimeDir(projectDir), { recursive: true });
}

function readStore(projectDir: string): PlanReuseStore {
  const file = reuseFile(projectDir);
  if (!fs.existsSync(file)) return { templates: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as PlanReuseStore;
    if (!parsed || typeof parsed !== 'object' || !parsed.templates) {
      return { templates: {} };
    }
    return parsed;
  } catch {
    return { templates: {} };
  }
}

function writeStore(projectDir: string, store: PlanReuseStore): void {
  ensureDir(projectDir);
  fs.writeFileSync(reuseFile(projectDir), `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function normalizeForSignature(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/"[^"]{1,200}"/g, '"<str>"')
    .replace(/'[^']{1,200}'/g, "'<str>'")
    .replace(/[a-z]:\\[^\s'"]+/gi, '<path>')
    .replace(/\/[^\s'"]+/g, '<path>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\b\d+\b/g, '<num>')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseStepKind(index: number, total: number): AutopilotPlanStep['kind'] {
  return index === total - 1 ? 'execution' : 'analysis';
}

export function buildPlanBundleTaskSignature(input: {
  goal: string;
  commands: string[];
  verificationCommand?: string;
  workingDirectory?: string;
  mode?: PlanBundleMode;
  riskTier?: PlanBundleRiskTier;
}): string {
  const commandShape = input.commands
    .map((command) => normalizeForSignature(command))
    .filter(Boolean)
    .join('|');
  const parts = [
    `goal=${normalizeForSignature(input.goal)}`,
    `cmd=${commandShape}`,
    `verify=${normalizeForSignature(input.verificationCommand ?? '') || '-'}`,
    `cwd=${normalizeForSignature(path.basename(input.workingDirectory ?? '')) || '-'}`,
    `mode=${input.mode ?? 'work'}`,
    `risk=${input.riskTier ?? 'STANDARD'}`,
  ];
  return hashText(parts.join('||'));
}

export function loadReusablePlanTemplate(input: {
  projectDir: string;
  signature: string;
  goal: string;
}): { plan: AutopilotPlan; templateId: string; hits: number } | null {
  const store = readStore(input.projectDir);
  const template = store.templates[input.signature];
  if (!template || !Array.isArray(template.analysisStepTitles) || template.analysisStepTitles.length === 0) {
    return null;
  }
  const nextHits = Math.max(1, Number(template.hits ?? 0) + 1);
  store.templates[input.signature] = {
    ...template,
    hits: nextHits,
    updatedAt: nowIso(),
  };
  writeStore(input.projectDir, store);
  const titles = template.analysisStepTitles
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 8);
  if (titles.length === 0) return null;
  const plan: AutopilotPlan = {
    goal: input.goal.trim(),
    createdAt: nowIso(),
    steps: titles.map((title, index) => ({
      id: `step_${index + 1}`,
      title,
      kind: baseStepKind(index, titles.length),
      done: false,
    })),
  };
  return {
    plan,
    templateId: template.templateId,
    hits: nextHits,
  };
}

export function saveReusablePlanTemplate(input: {
  projectDir: string;
  signature: string;
  plan: AutopilotPlan;
  commandCount: number;
  verificationEnabled: boolean;
  bundleId: string;
}): void {
  const stepTitles = input.plan.steps
    .filter((step) => step.kind === 'analysis' || (step.kind === 'execution' && !step.command))
    .map((step) => String(step.title).trim())
    .filter(Boolean)
    .slice(0, 8);
  if (stepTitles.length === 0) return;
  const store = readStore(input.projectDir);
  const current = store.templates[input.signature];
  const createdAt = current?.createdAt || nowIso();
  const templateId = current?.templateId || `tpl_${hashText(input.signature).slice(0, 12)}`;
  store.templates[input.signature] = {
    signature: input.signature,
    templateId,
    analysisStepTitles: stepTitles,
    commandCount: Math.max(0, Math.floor(input.commandCount)),
    verificationEnabled: input.verificationEnabled,
    lastBundleId: input.bundleId,
    hits: Math.max(0, Number(current?.hits ?? 0)),
    createdAt,
    updatedAt: nowIso(),
  };
  const keys = Object.keys(store.templates);
  if (keys.length > 500) {
    const sorted = keys.sort((a, b) => {
      const atA = Date.parse(store.templates[a]?.updatedAt ?? '');
      const atB = Date.parse(store.templates[b]?.updatedAt ?? '');
      return atB - atA;
    });
    const nextTemplates: Record<string, PlanReuseTemplate> = {};
    for (const key of sorted.slice(0, 500)) {
      const row = store.templates[key];
      if (row) nextTemplates[key] = row;
    }
    store.templates = nextTemplates;
  }
  writeStore(input.projectDir, store);
}
