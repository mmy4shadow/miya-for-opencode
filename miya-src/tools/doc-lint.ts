import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Violation = {
  code: string;
  message: string;
};

const violations: Violation[] = [];

const LEGACY_PATH_PATTERNS = [
  /miya-src\/src\/memory(?:\/|\b)/,
  /(?:miya-src\/)?src\/agents\/orchestrator\.ts/,
  /(?:miya-src\/)?src\/agents\/explorer\.ts/,
  /(?:miya-src\/)?src\/agents\/oracle\.ts/,
  /(?:miya-src\/)?src\/agents\/librarian\.ts/,
  /(?:miya-src\/)?src\/agents\/designer\.ts/,
  /(?:miya-src\/)?src\/agents\/fixer\.ts/,
];

const LEGACY_TERMS = [
  'user.message.before',
  'tool.use.before',
  'tool.use.after',
];

const UNRESOLVED_PLANNING_MARKERS = [
  '待确认问题（影响实现取舍）',
  '待确认后冻结',
  '规划态',
];

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

function isLegacyPathToken(candidate: string): boolean {
  const normalized = normalizePathToken(candidate);
  return LEGACY_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
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

function assertNoLegacyTerms(content: string, scope: string): void {
  for (const legacy of LEGACY_TERMS) {
    if (content.includes(legacy)) {
      violations.push({
        code: 'docs.legacy.term',
        message: `${scope} contains forbidden legacy term: ${legacy}`,
      });
    }
  }
}

const repoRoot = process.cwd();
const workspaceRoot = join(repoRoot, '..');
const planningPath = join(workspaceRoot, 'Miya插件开发完整项目规划.md');
const readmePath = join(repoRoot, 'README.md');
const pluginEntryPath = join(repoRoot, 'src', 'index.ts');
const packagePath = join(repoRoot, 'package.json');
const manifestPath = join(repoRoot, 'opencode.json');

requireFile(pluginEntryPath, 'entry.missing');
requireFile(packagePath, 'package.missing');
requireFile(manifestPath, 'manifest.missing');
requireFile(planningPath, 'planning.missing');
requireFile(readmePath, 'readme.missing');

if (existsSync(pluginEntryPath)) {
  const source = readFileSync(pluginEntryPath, 'utf8');
  requireText(source, "'tool.execute.before'", 'hook.before', 'src/index.ts');
  requireText(source, "'tool.execute.after'", 'hook.after', 'src/index.ts');
  if (!source.includes("'permission.ask'") && !source.includes('PERMISSION_OBSERVED_HOOK')) {
    violations.push({
      code: 'hook.permission',
      message: 'src/index.ts missing permission hook wiring (permission.ask/PERMISSION_OBSERVED_HOOK)',
    });
  }
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

if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, 'utf8');
  assertNoLegacyTerms(readme, 'README.md');
  for (const pattern of LEGACY_PATH_PATTERNS) {
    if (pattern.test(readme)) {
      violations.push({
        code: 'readme.path.legacy',
        message: `README.md contains forbidden legacy path pattern: ${pattern.source}`,
      });
    }
  }
  const readmePaths = extractPlanningPathCandidates(readme);
  for (const candidate of readmePaths) {
    if (isLegacyPathToken(candidate)) {
      violations.push({
        code: 'readme.path.legacy',
        message: `README.md contains forbidden legacy path: ${candidate}`,
      });
    }
  }
}

if (existsSync(planningPath)) {
  const planning = readFileSync(planningPath, 'utf8');
  assertNoLegacyTerms(planning, '规划文档');
  for (const marker of UNRESOLVED_PLANNING_MARKERS) {
    if (planning.includes(marker)) {
      violations.push({
        code: 'planning.unresolved.marker',
        message: `规划文档包含未收口标记: ${marker}`,
      });
    }
  }
  for (const expected of [
    'tool.execute.before',
    'tool.execute.after',
    'permission.asked',
    'permission.replied',
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
    if (isLegacyPathToken(candidate)) {
      violations.push({
        code: 'planning.path.legacy',
        message: `规划路径使用了已禁用旧口径: ${candidate}`,
      });
      continue;
    }

    if (!wildcardPathExists(workspaceRoot, candidate)) {
      violations.push({
        code: 'planning.path.unresolved',
        message: `规划路径不可解析: ${candidate}`,
      });
      continue;
    }

    const sourcePath = distToSourcePath(candidate);
    if (sourcePath && !wildcardPathExists(workspaceRoot, sourcePath)) {
      violations.push({
        code: 'planning.path.source_missing',
        message: `dist 路径缺少可解析的 src source-of-truth: ${candidate} -> ${sourcePath}`,
      });
      continue;
    }

    if (sourcePath && !planning.includes(sourcePath)) {
      violations.push({
        code: 'planning.path.source_undeclared',
        message: `规划引用 dist 路径但未声明对应 src source-of-truth: ${candidate} -> ${sourcePath}`,
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
