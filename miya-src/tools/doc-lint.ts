import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Violation = {
  code: string;
  message: string;
};

const violations: Violation[] = [];

const PLANNING_PATH_MIGRATIONS = new Map<string, string>([
  ['miya-src/src/memory/*', 'miya-src/src/companion/*'],
  ['miya-src/src/memory/', 'miya-src/src/companion/'],
  ['miya-src/src/memory', 'miya-src/src/companion'],
  ['miya-src/src/agents/orchestrator.ts', 'miya-src/src/agents/1-task-manager.ts'],
]);

function requireFile(path: string, code: string): void {
  if (!existsSync(path)) {
    violations.push({ code, message: `missing file: ${path}` });
  }
}

function requireText(
  content: string,
  expected: string,
  code: string,
  scope: string,
): void {
  if (!content.includes(expected)) {
    violations.push({
      code,
      message: `${scope} missing required text: ${expected}`,
    });
  }
}

function normalizePathToken(input: string): string {
  return input
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/[),.;:，。；：、]+$/g, '')
    .replace(/\\/g, '/');
}

function extractPlanningPathCandidates(content: string): string[] {
  const candidates = new Set<string>();
  const inlineCodeRegex = /`([^`\r\n]+)`/g;
  let match: RegExpExecArray | null = inlineCodeRegex.exec(content);
  while (match) {
    const token = normalizePathToken(match[1]);
    if (token.startsWith('miya-src/') && token.includes('/')) {
      candidates.add(token);
    }
    match = inlineCodeRegex.exec(content);
  }

  const plainPathRegex = /\bmiya-src\/[A-Za-z0-9_./*-]+/g;
  const plainMatches = content.match(plainPathRegex) ?? [];
  for (const raw of plainMatches) {
    const token = normalizePathToken(raw);
    if (token.startsWith('miya-src/') && token.includes('/')) {
      candidates.add(token);
    }
  }

  return [...candidates].sort();
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardPathExists(workspaceRoot: string, pattern: string): boolean {
  const normalizedPattern = normalizePathToken(pattern);
  const starIndex = normalizedPattern.indexOf('*');
  if (starIndex === -1) {
    return existsSync(join(workspaceRoot, normalizedPattern));
  }
  const prefix = normalizedPattern.slice(0, starIndex);
  const anchorSlash = prefix.lastIndexOf('/');
  const rootPrefix = anchorSlash >= 0 ? prefix.slice(0, anchorSlash + 1) : '';
  const rootAbs = join(workspaceRoot, rootPrefix);
  if (!existsSync(rootAbs)) return false;
  const regex = new RegExp(
    `^${escapeRegex(normalizedPattern).replace(/\\\*/g, '.*')}$`,
  );

  const stack = [rootAbs];
  while (stack.length > 0) {
    const currentAbs = stack.pop();
    if (!currentAbs) continue;
    const entries = readdirSync(currentAbs, { withFileTypes: true });
    for (const entry of entries) {
      const nextAbs = join(currentAbs, entry.name);
      const nextRel = nextAbs
        .replace(`${workspaceRoot}\\`, '')
        .replace(`${workspaceRoot}/`, '')
        .replace(/\\/g, '/');
      if (regex.test(nextRel)) return true;
      if (entry.isDirectory()) {
        stack.push(nextAbs);
      }
    }
  }

  return false;
}

function tryResolvePlanningPath(
  workspaceRoot: string,
  candidate: string,
): {
  ok: boolean;
  resolvedPath?: string;
  mappedFrom?: string;
} {
  if (wildcardPathExists(workspaceRoot, candidate)) {
    return { ok: true, resolvedPath: candidate };
  }
  const mapped = PLANNING_PATH_MIGRATIONS.get(candidate);
  if (mapped && wildcardPathExists(workspaceRoot, mapped)) {
    return { ok: true, resolvedPath: mapped, mappedFrom: candidate };
  }
  return { ok: false };
}

function distToSourcePath(candidate: string): string | null {
  if (!candidate.includes('/dist/')) return null;
  let mapped = candidate.replace('/dist/', '/src/');
  if (mapped.endsWith('.d.ts')) {
    mapped = `${mapped.slice(0, -5)}.ts`;
  } else if (mapped.endsWith('.js')) {
    mapped = `${mapped.slice(0, -3)}.ts`;
  }
  return mapped;
}

const repoRoot = process.cwd();
const workspaceRoot = join(repoRoot, '..');
const planningPath = join(workspaceRoot, 'Miya插件开发完整项目规划.md');
const pluginEntryPath = join(repoRoot, 'src', 'index.ts');
const packagePath = join(repoRoot, 'package.json');
const manifestPath = join(repoRoot, 'opencode.json');

requireFile(pluginEntryPath, 'entry.missing');
requireFile(packagePath, 'package.missing');
requireFile(manifestPath, 'manifest.missing');
requireFile(planningPath, 'planning.missing');

if (existsSync(pluginEntryPath)) {
  const source = readFileSync(pluginEntryPath, 'utf8');
  requireText(source, "'tool.execute.before'", 'hook.before', 'src/index.ts');
  requireText(source, "'tool.execute.after'", 'hook.after', 'src/index.ts');
  requireText(source, "'permission.ask'", 'hook.permission', 'src/index.ts');
  for (const legacyKey of ['tool.use.before', 'tool.use.after']) {
    if (source.includes(legacyKey)) {
      violations.push({
        code: 'hook.legacy',
        message: `src/index.ts contains legacy hook key: ${legacyKey}`,
      });
    }
  }
}

if (existsSync(packagePath)) {
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  for (const name of ['doc:lint', 'check:contracts']) {
    if (!scripts[name]) {
      violations.push({
        code: 'scripts.missing',
        message: `package.json missing script: ${name}`,
      });
    }
  }
}

if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
    string,
    unknown
  >;
  for (const key of ['name', 'version', 'description']) {
    if (!manifest[key]) {
      violations.push({
        code: 'manifest.field',
        message: `opencode.json missing field: ${key}`,
      });
    }
  }
}

if (existsSync(planningPath)) {
  const planning = readFileSync(planningPath, 'utf8');
  for (const expected of [
    'tool.execute.before',
    'tool.execute.after',
    '.opencode/plugins/',
    '.opencode/tools/',
    '.opencode/package.json',
    'Ecosystem Bridge',
    'Doc Linter',
  ]) {
    requireText(planning, expected, 'planning.contract', '规划文档');
  }

  const pathCandidates = extractPlanningPathCandidates(planning);
  for (const candidate of pathCandidates) {
    const resolved = tryResolvePlanningPath(workspaceRoot, candidate);
    if (!resolved.ok) {
      violations.push({
        code: 'planning.path.unresolved',
        message: `规划路径不可解析: ${candidate}`,
      });
      continue;
    }

    const resolvedPath = resolved.resolvedPath ?? candidate;
    const sourcePath = distToSourcePath(resolvedPath);
    if (sourcePath && !wildcardPathExists(workspaceRoot, sourcePath)) {
      violations.push({
        code: 'planning.path.source_missing',
        message: `dist 路径缺少可解析的 src source-of-truth: ${resolvedPath} -> ${sourcePath}`,
      });
      continue;
    }

    if (sourcePath && !planning.includes(sourcePath)) {
      violations.push({
        code: 'planning.path.source_undeclared',
        message: `规划引用 dist 路径但未声明对应 src source-of-truth: ${resolvedPath} -> ${sourcePath}`,
      });
    }
  }
}

if (violations.length > 0) {
  for (const item of violations) {
    console.error(`${item.code}: ${item.message}`);
  }
  throw new Error(`[doc-lint] failed with ${violations.length} violation(s)`);
}

console.log('[doc-lint] ok');
