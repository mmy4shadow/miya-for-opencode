import { spawnSync } from 'node:child_process';
import type { SkillFrontmatter } from './frontmatter';

export interface SkillGateResult {
  loadable: boolean;
  reasons: string[];
}

function hasBinary(bin: string): boolean {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [bin], { stdio: 'ignore' });
  return result.status === 0;
}

export function evaluateSkillGate(frontmatter: SkillFrontmatter): SkillGateResult {
  const reasons: string[] = [];

  if (Array.isArray(frontmatter.platforms) && frontmatter.platforms.length > 0) {
    if (!frontmatter.platforms.includes(process.platform)) {
      reasons.push(`platform_not_supported:${process.platform}`);
    }
  }

  for (const envName of frontmatter.env ?? []) {
    if (!process.env[envName]) {
      reasons.push(`missing_env:${envName}`);
    }
  }

  for (const bin of frontmatter.bins ?? []) {
    if (!hasBinary(bin)) {
      reasons.push(`missing_bin:${bin}`);
    }
  }

  return {
    loadable: reasons.length === 0,
    reasons,
  };
}
