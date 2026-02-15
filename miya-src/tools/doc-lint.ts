import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Violation = {
  code: string;
  message: string;
};

const violations: Violation[] = [];

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
}

if (violations.length > 0) {
  for (const item of violations) {
    console.error(`${item.code}: ${item.message}`);
  }
  throw new Error(`[doc-lint] failed with ${violations.length} violation(s)`);
}

console.log('[doc-lint] ok');
