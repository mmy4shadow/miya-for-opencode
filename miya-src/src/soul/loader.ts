import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import { DEFAULT_SOUL_MARKDOWN } from './templates';
import type { SoulProfile } from './types';

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
  return {
    name: parseIdentityValue(identity, '名称', 'Miya'),
    role: parseIdentityValue(identity, '角色', 'Assistant'),
    tone: parseIdentityValue(identity, '语气', 'warm and precise'),
    principles: parseBulletSection(rawMarkdown, '价值观'),
    behaviorRules: parseBulletSection(rawMarkdown, '行为准则'),
    forbidden: parseBulletSection(rawMarkdown, '禁止事项'),
    rawMarkdown,
  };
}

export function saveSoulMarkdown(projectDir: string, markdown: string): SoulProfile {
  const file = ensureSoulFile(projectDir);
  fs.writeFileSync(file, markdown.trimEnd() + '\n', 'utf-8');
  return loadSoulProfile(projectDir);
}

export function soulPersonaLayer(projectDir: string): string {
  const soul = loadSoulProfile(projectDir);
  const principles = soul.principles.length
    ? soul.principles.map((item) => `- ${item}`).join('\n')
    : '- 安全优先';
  const rules = soul.behaviorRules.length
    ? soul.behaviorRules.map((item) => `- ${item}`).join('\n')
    : '- 在工作和对话之间自适应';
  const forbidden = soul.forbidden.length
    ? soul.forbidden.map((item) => `- ${item}`).join('\n')
    : '- 不绕过安全';
  return [
    '<PersonaLayer>',
    `name: ${soul.name}`,
    `role: ${soul.role}`,
    `tone: ${soul.tone}`,
    'principles:',
    principles,
    'behavior_rules:',
    rules,
    'forbidden:',
    forbidden,
    '</PersonaLayer>',
  ].join('\n');
}

export function soulFilePath(projectDir: string): string {
  return ensureSoulFile(projectDir);
}
