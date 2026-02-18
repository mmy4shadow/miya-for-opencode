import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSkillFrontmatter } from './frontmatter';
import { evaluateSkillGate } from './gating';

export interface SkillDescriptor {
  id: string;
  name: string;
  source: 'workspace' | 'global' | 'builtin' | 'extra';
  dir: string;
  skillFile: string;
  frontmatter: {
    version?: string;
    description?: string;
    bins?: string[];
    env?: string[];
    platforms?: string[];
    permissions?: string[];
  };
  gate: {
    loadable: boolean;
    reasons: string[];
  };
}

function isSkillDir(dir: string): boolean {
  const skillFile = path.join(dir, 'SKILL.md');
  return fs.existsSync(skillFile);
}

function listSkillDirs(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const entries = fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, entry.name));
  return entries.filter(isSkillDir);
}

function builtinSkillRoots(projectDir: string): string[] {
  const roots = new Set<string>();
  roots.add(path.join(projectDir, 'miya-src', 'src', 'skills'));
  roots.add(path.dirname(fileURLToPath(import.meta.url)));
  return [...roots];
}

function enforcePermissionMetadataGate(
  source: SkillDescriptor['source'],
  frontmatter: SkillDescriptor['frontmatter'],
  gate: SkillDescriptor['gate'],
): SkillDescriptor['gate'] {
  if (source === 'builtin') return gate;
  if ((frontmatter.permissions?.length ?? 0) > 0) return gate;
  const reasons = [...gate.reasons, 'missing_permission_metadata'];
  return {
    loadable: false,
    reasons: [...new Set(reasons)],
  };
}

export function discoverSkills(
  projectDir: string,
  extraDirs: string[] = [],
): SkillDescriptor[] {
  const workspaceRoot = path.join(projectDir, 'skills');
  const globalRoot = path.join(
    os.homedir(),
    '.config',
    'opencode',
    'miya',
    'skills',
  );

  const scopedDirs: Array<{
    source: SkillDescriptor['source'];
    dirs: string[];
  }> = [
    { source: 'workspace', dirs: listSkillDirs(workspaceRoot) },
    { source: 'global', dirs: listSkillDirs(globalRoot) },
    {
      source: 'builtin',
      dirs: builtinSkillRoots(projectDir).flatMap((root) =>
        listSkillDirs(root),
      ),
    },
    {
      source: 'extra',
      dirs: extraDirs.flatMap((root) =>
        listSkillDirs(path.resolve(projectDir, root)),
      ),
    },
  ];

  const precedence: Record<SkillDescriptor['source'], number> = {
    workspace: 4,
    global: 3,
    extra: 2,
    builtin: 1,
  };

  const byName = new Map<string, SkillDescriptor>();

  for (const scope of scopedDirs) {
    for (const dir of scope.dirs) {
      const skillFile = path.join(dir, 'SKILL.md');
      let content = '';
      try {
        content = fs.readFileSync(skillFile, 'utf-8');
      } catch {
        continue;
      }
      const frontmatter = parseSkillFrontmatter(content);
      const name = frontmatter.name ?? path.basename(dir);
      const gate = enforcePermissionMetadataGate(
        scope.source,
        frontmatter,
        evaluateSkillGate(frontmatter),
      );
      const descriptor: SkillDescriptor = {
        id: name,
        name,
        source: scope.source,
        dir,
        skillFile,
        frontmatter,
        gate,
      };

      const existing = byName.get(name);
      if (
        !existing ||
        precedence[scope.source] >= precedence[existing.source]
      ) {
        byName.set(name, descriptor);
      }
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
