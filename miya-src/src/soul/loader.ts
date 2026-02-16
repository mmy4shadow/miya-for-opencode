import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import { DEFAULT_SOUL_MARKDOWN } from './templates';
import type { SoulProfile } from './types';

export type SoulLayerMode = 'work' | 'chat' | 'mixed';
export type SoulLayerDepth = 'minimal' | 'full';

function soulFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'SOUL.md');
}

function ensureSoulFile(projectDir: string): string {
  const file = soulFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, DEFAULT_SOUL_MARKDOWN, 'utf-8');
  }
  return file;
}

function parseBulletSection(markdown: string, heading: string): string[] {
  const pattern = new RegExp(`##\\s+${heading}[\\s\\S]*?(?=\\n##\\s+|$)`);
  const block = markdown.match(pattern)?.[0] ?? '';
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-'))
    .map((line) => line.replace(/^-+\s*/, '').trim())
    .filter(Boolean);
}

function parseIdentityValue(items: string[], key: string, fallback: string): string {
  const item = items.find((line) => line.startsWith(`${key}：`));
  if (!item) return fallback;
  return item.replace(`${key}：`, '').trim() || fallback;
}

export function loadSoulProfile(projectDir: string): SoulProfile {
  const file = ensureSoulFile(projectDir);
  const rawMarkdown = fs.readFileSync(file, 'utf-8');
  const identity = parseBulletSection(rawMarkdown, '身份');
  const revision = createHash('sha256').update(rawMarkdown).digest('hex').slice(0, 12);
  return {
    name: parseIdentityValue(identity, '名称', 'Miya'),
    role: parseIdentityValue(identity, '角色', 'Assistant'),
    tone: parseIdentityValue(identity, '语气', 'warm and precise'),
    principles: parseBulletSection(rawMarkdown, '价值观'),
    behaviorRules: parseBulletSection(rawMarkdown, '行为准则'),
    forbidden: parseBulletSection(rawMarkdown, '禁止事项'),
    workAddons: parseBulletSection(rawMarkdown, '工作模式附加'),
    chatAddons: parseBulletSection(rawMarkdown, '对话模式附加'),
    revision,
    rawMarkdown,
  };
}

export function saveSoulMarkdown(projectDir: string, markdown: string): SoulProfile {
  const file = ensureSoulFile(projectDir);
  fs.writeFileSync(file, markdown.trimEnd() + '\n', 'utf-8');
  return loadSoulProfile(projectDir);
}

function compact(items: string[], maxItems: number): string[] {
  return items.slice(0, Math.max(1, maxItems)).map((item) => item.trim()).filter(Boolean);
}

function renderList(items: string[], fallback: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : `- ${fallback}`;
}

export function soulPersonaLayer(
  projectDir: string,
  options?: {
    mode?: SoulLayerMode;
    depth?: SoulLayerDepth;
  },
): string {
  const soul = loadSoulProfile(projectDir);
  const mode = options?.mode ?? 'mixed';
  const depth = options?.depth ?? 'full';
  const principlesBase = depth === 'minimal' ? compact(soul.principles, 2) : soul.principles;
  const rulesBase = depth === 'minimal' ? compact(soul.behaviorRules, 2) : soul.behaviorRules;
  const forbiddenBase = depth === 'minimal' ? compact(soul.forbidden, 3) : soul.forbidden;
  const modeHints =
    mode === 'work'
      ? soul.workAddons
      : mode === 'chat'
        ? soul.chatAddons
        : [...soul.workAddons, ...soul.chatAddons];
  const modeHintLines = depth === 'minimal' ? compact(modeHints, 2) : modeHints;
  return [
    '<PersonaLayer>',
    `mode: ${mode}`,
    `depth: ${depth}`,
    `revision: ${soul.revision}`,
    `name: ${soul.name}`,
    `role: ${soul.role}`,
    `tone: ${soul.tone}`,
    'principles:',
    renderList(principlesBase, '安全优先'),
    'behavior_rules:',
    renderList(rulesBase, '在工作和对话之间自适应'),
    'forbidden:',
    renderList(forbiddenBase, '不绕过安全'),
    'mode_addons:',
    renderList(modeHintLines, mode === 'work' ? '优先清晰交付与证据' : '优先共情与边界'),
    '</PersonaLayer>',
  ].join('\n');
}

export function soulFilePath(projectDir: string): string {
  return ensureSoulFile(projectDir);
}
