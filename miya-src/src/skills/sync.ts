import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runProcessSync } from '../utils';
import { getMiyaRuntimeDir } from '../workflow';

export interface SourcePack {
  sourcePackID: string;
  name: string;
  skillName: string;
  repo?: string;
  localDir: string;
  branch: string;
  headRevision: string;
  latestRevision?: string;
  lastPulledAt?: string;
  trustLevel: 'allowlisted' | 'untrusted' | 'unknown';
  importPlan?: ImportPlan;
  pinnedRelease?: PinnedRelease;
}

export interface ImportPlan {
  sourcePackID: string;
  localDir: string;
  importMode: 'skills_only';
  permissionMode: 'sandbox_read_only';
  createdAt: string;
  updatedAt: string;
}

export interface PinnedRelease {
  sourcePackID: string;
  revision: string;
  previousRevision?: string;
  appliedAt: string;
}

export interface EcosystemBridgeConflict {
  type: 'skill_name_collision';
  skillName: string;
  sourcePackIDs: string[];
}

export interface EcosystemBridgeListResult {
  sourcePacks: SourcePack[];
  importPlans: ImportPlan[];
  pinnedReleases: PinnedRelease[];
  conflicts: EcosystemBridgeConflict[];
}

export interface SourcePackDiffResult {
  sourcePackID: string;
  localDir: string;
  headRevision: string;
  compareRevision: string;
  compareRef: string;
  ahead: number;
  behind: number;
  pendingCommits: string[];
  pinnedRelease?: PinnedRelease;
}

export interface SourcePackPullResult {
  sourcePackID: string;
  localDir: string;
  latestRevision: string;
  compareRef: string;
  pulledAt: string;
}

export interface SourcePackApplyResult {
  sourcePackID: string;
  localDir: string;
  appliedRevision: string;
  previousRevision?: string;
  detachedHead: boolean;
}

export interface SourcePackRollbackResult {
  sourcePackID: string;
  localDir: string;
  rolledBackTo: string;
  previousRevision: string;
  detachedHead: boolean;
}

interface BridgeSourcePackState {
  sourcePackID: string;
  repo?: string;
  localDir: string;
  latestRevision?: string;
  lastPulledAt?: string;
  lastError?: string;
}

interface EcosystemBridgeState {
  version: 1;
  updatedAt: string;
  sourcePacks: Record<string, BridgeSourcePackState>;
  importPlans: Record<string, ImportPlan>;
  pinnedReleases: Record<string, PinnedRelease>;
}

interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type GitRunner = (args: string[], cwd: string) => GitCommandResult;

export interface EcosystemBridgeOptions {
  gitRunner?: GitRunner;
  now?: () => string;
  sourceRoots?: string[];
}

const DEFAULT_STATE: EcosystemBridgeState = {
  version: 1,
  updatedAt: new Date(0).toISOString(),
  sourcePacks: {},
  importPlans: {},
  pinnedReleases: {},
};

const TRUSTED_SOURCE_ALLOWLIST: RegExp[] = [
  /^https?:\/\/github\.com\/(openclaw|openclaw-girl-agent|Yeachan-Heo|code-yeongyu|SumeLabs|MemTensor|mmy4shadow)\//i,
  /^git@github\.com:(openclaw|openclaw-girl-agent|Yeachan-Heo|code-yeongyu|SumeLabs|MemTensor|mmy4shadow)\//i,
];

function nowIso(options?: EcosystemBridgeOptions): string {
  return options?.now?.() ?? new Date().toISOString();
}

function stateFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'ecosystem-bridge.json');
}

function readState(projectDir: string): EcosystemBridgeState {
  const file = stateFile(projectDir);
  if (!fs.existsSync(file)) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as Partial<EcosystemBridgeState>;
    return {
      version: 1,
      updatedAt:
        typeof parsed.updatedAt === 'string'
          ? parsed.updatedAt
          : new Date(0).toISOString(),
      sourcePacks:
        parsed.sourcePacks && typeof parsed.sourcePacks === 'object'
          ? parsed.sourcePacks
          : {},
      importPlans:
        parsed.importPlans && typeof parsed.importPlans === 'object'
          ? parsed.importPlans
          : {},
      pinnedReleases:
        parsed.pinnedReleases && typeof parsed.pinnedReleases === 'object'
          ? parsed.pinnedReleases
          : {},
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(
  projectDir: string,
  state: EcosystemBridgeState,
  options?: EcosystemBridgeOptions,
): void {
  const file = stateFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next: EcosystemBridgeState = {
    ...state,
    version: 1,
    updatedAt: nowIso(options),
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
}

function runGit(args: string[], cwd: string): GitCommandResult {
  const proc = runProcessSync('git', args, {
    cwd,
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.trim(),
    stderr: proc.stderr.trim(),
  };
}

function git(
  options: EcosystemBridgeOptions | undefined,
  args: string[],
  cwd: string,
): GitCommandResult {
  return (options?.gitRunner ?? runGit)(args, cwd);
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function defaultSourceRoots(projectDir: string): string[] {
  return [
    path.join(projectDir, 'skills'),
    path.join(os.homedir(), '.config', 'opencode', 'miya', 'skills'),
  ];
}

function listSkillReposFromRoot(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, entry.name))
    .filter((dir) => {
      return (
        fs.existsSync(path.join(dir, 'SKILL.md')) &&
        fs.existsSync(path.join(dir, '.git'))
      );
    });
}

function sanitizeIdSegment(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildSourcePackID(repo: string | undefined, localDir: string): string {
  const base =
    sanitizeIdSegment(path.basename(localDir) || 'source-pack') ||
    'source-pack';
  const fingerprint = createHash('sha256')
    .update(`${repo ?? ''}|${path.resolve(localDir)}`)
    .digest('hex')
    .slice(0, 12);
  return `${base}-${fingerprint}`;
}

function trustLevelForRepo(repo: string | undefined): SourcePack['trustLevel'] {
  if (!repo) return 'unknown';
  return TRUSTED_SOURCE_ALLOWLIST.some((rule) => rule.test(repo))
    ? 'allowlisted'
    : 'untrusted';
}

function resolveSkillName(localDir: string): string {
  const manifest = path.join(localDir, 'SKILL.md');
  if (!fs.existsSync(manifest)) return path.basename(localDir);
  try {
    const raw = fs.readFileSync(manifest, 'utf-8');
    const heading = /^#\s+(.+)$/m.exec(raw)?.[1]?.trim();
    if (heading) return heading;
  } catch {}
  return path.basename(localDir);
}

function readGitValue(
  options: EcosystemBridgeOptions | undefined,
  cwd: string,
  args: string[],
): string | undefined {
  const result = git(options, args, cwd);
  if (result.exitCode !== 0) return undefined;
  return normalizeText(result.stdout);
}

function resolveUpstreamRef(
  localDir: string,
  branch: string,
  options?: EcosystemBridgeOptions,
): string {
  const upstream = readGitValue(options, localDir, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ]);
  if (upstream) return upstream;
  if (branch && branch !== 'HEAD') return `origin/${branch}`;
  return 'origin/HEAD';
}

function resolveRevision(
  localDir: string,
  ref: string,
  options?: EcosystemBridgeOptions,
): string {
  const resolved = readGitValue(options, localDir, [
    'rev-parse',
    `${ref}^{commit}`,
  ]);
  if (!resolved) {
    throw new Error(`source_pack_revision_unresolved:${ref}`);
  }
  return resolved;
}

function requireCleanWorkingTree(
  localDir: string,
  options?: EcosystemBridgeOptions,
): void {
  const status = git(options, ['status', '--porcelain'], localDir);
  if (status.exitCode !== 0) {
    throw new Error(status.stderr || 'source_pack_status_failed');
  }
  if (status.stdout.trim()) {
    throw new Error('source_pack_dirty_worktree');
  }
}

function discoverSourcePacks(
  projectDir: string,
  state: EcosystemBridgeState,
  options?: EcosystemBridgeOptions,
): SourcePack[] {
  const roots = options?.sourceRoots?.length
    ? options.sourceRoots
    : defaultSourceRoots(projectDir);
  const dirs = new Set<string>();
  for (const root of roots) {
    for (const repoDir of listSkillReposFromRoot(root)) {
      dirs.add(path.resolve(repoDir));
    }
  }

  const packs: SourcePack[] = [];
  for (const localDir of [...dirs]) {
    const headRevision = readGitValue(options, localDir, ['rev-parse', 'HEAD']);
    if (!headRevision) continue;
    const repo = readGitValue(options, localDir, [
      'config',
      '--get',
      'remote.origin.url',
    ]);
    const branch =
      readGitValue(options, localDir, ['rev-parse', '--abbrev-ref', 'HEAD']) ??
      'HEAD';
    const sourcePackID = buildSourcePackID(repo, localDir);
    const sourceState = state.sourcePacks[sourcePackID];
    const importPlan = state.importPlans[sourcePackID];
    const pinnedRelease = state.pinnedReleases[sourcePackID];
    packs.push({
      sourcePackID,
      name: path.basename(localDir),
      skillName: resolveSkillName(localDir),
      repo,
      localDir,
      branch,
      headRevision,
      latestRevision: sourceState?.latestRevision,
      lastPulledAt: sourceState?.lastPulledAt,
      trustLevel: trustLevelForRepo(repo),
      importPlan,
      pinnedRelease,
    });
  }

  return packs.sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.sourcePackID.localeCompare(b.sourcePackID);
  });
}

function requireSourcePack(
  projectDir: string,
  sourcePackID: string,
  options?: EcosystemBridgeOptions,
): { state: EcosystemBridgeState; sourcePack: SourcePack } {
  const state = readState(projectDir);
  const packs = discoverSourcePacks(projectDir, state, options);
  const sourcePack = packs.find((item) => item.sourcePackID === sourcePackID);
  if (!sourcePack) throw new Error(`unknown_source_pack:${sourcePackID}`);
  return { state, sourcePack };
}

function ensureImportPlan(
  state: EcosystemBridgeState,
  sourcePack: SourcePack,
  options?: EcosystemBridgeOptions,
): ImportPlan {
  const existing = state.importPlans[sourcePack.sourcePackID];
  if (existing) {
    const refreshed: ImportPlan = {
      ...existing,
      sourcePackID: sourcePack.sourcePackID,
      localDir: sourcePack.localDir,
      updatedAt: nowIso(options),
    };
    state.importPlans[sourcePack.sourcePackID] = refreshed;
    return refreshed;
  }
  const created: ImportPlan = {
    sourcePackID: sourcePack.sourcePackID,
    localDir: sourcePack.localDir,
    importMode: 'skills_only',
    permissionMode: 'sandbox_read_only',
    createdAt: nowIso(options),
    updatedAt: nowIso(options),
  };
  state.importPlans[sourcePack.sourcePackID] = created;
  return created;
}

function updateSourcePackState(
  state: EcosystemBridgeState,
  sourcePack: SourcePack,
  patch: Partial<BridgeSourcePackState>,
): void {
  const current = state.sourcePacks[sourcePack.sourcePackID];
  state.sourcePacks[sourcePack.sourcePackID] = {
    sourcePackID: sourcePack.sourcePackID,
    repo: sourcePack.repo,
    localDir: sourcePack.localDir,
    latestRevision: current?.latestRevision,
    lastPulledAt: current?.lastPulledAt,
    lastError: current?.lastError,
    ...patch,
  };
}

export function listEcosystemBridge(
  projectDir: string,
  options?: EcosystemBridgeOptions,
): EcosystemBridgeListResult {
  const state = readState(projectDir);
  const sourcePacks = discoverSourcePacks(projectDir, state, options);
  const bySkillName = new Map<string, SourcePack[]>();
  for (const pack of sourcePacks) {
    const key = pack.skillName.toLowerCase();
    const list = bySkillName.get(key) ?? [];
    list.push(pack);
    bySkillName.set(key, list);
  }
  const conflicts: EcosystemBridgeConflict[] = [];
  for (const [, list] of bySkillName.entries()) {
    if (list.length <= 1) continue;
    conflicts.push({
      type: 'skill_name_collision',
      skillName: list[0].skillName,
      sourcePackIDs: list.map((item) => item.sourcePackID).sort(),
    });
  }
  const importPlans = Object.values(state.importPlans).sort((a, b) =>
    a.sourcePackID.localeCompare(b.sourcePackID),
  );
  const pinnedReleases = Object.values(state.pinnedReleases).sort((a, b) =>
    a.sourcePackID.localeCompare(b.sourcePackID),
  );
  return {
    sourcePacks,
    importPlans,
    pinnedReleases,
    conflicts: conflicts.sort((a, b) => a.skillName.localeCompare(b.skillName)),
  };
}

export function pullSourcePack(
  projectDir: string,
  sourcePackID: string,
  options?: EcosystemBridgeOptions,
): SourcePackPullResult {
  const resolved = requireSourcePack(projectDir, sourcePackID, options);
  const pull = git(
    options,
    ['fetch', '--prune', 'origin'],
    resolved.sourcePack.localDir,
  );
  if (pull.exitCode !== 0) {
    updateSourcePackState(resolved.state, resolved.sourcePack, {
      lastError: pull.stderr || 'source_pack_fetch_failed',
    });
    writeState(projectDir, resolved.state, options);
    throw new Error(pull.stderr || 'source_pack_fetch_failed');
  }

  const compareRef = resolveUpstreamRef(
    resolved.sourcePack.localDir,
    resolved.sourcePack.branch,
    options,
  );
  const latestRevision = resolveRevision(
    resolved.sourcePack.localDir,
    compareRef,
    options,
  );

  ensureImportPlan(resolved.state, resolved.sourcePack, options);
  updateSourcePackState(resolved.state, resolved.sourcePack, {
    latestRevision,
    lastPulledAt: nowIso(options),
    lastError: undefined,
  });
  writeState(projectDir, resolved.state, options);

  return {
    sourcePackID,
    localDir: resolved.sourcePack.localDir,
    latestRevision,
    compareRef,
    pulledAt: nowIso(options),
  };
}

export function diffSourcePack(
  projectDir: string,
  sourcePackID: string,
  options?: EcosystemBridgeOptions,
): SourcePackDiffResult {
  const { state, sourcePack } = requireSourcePack(
    projectDir,
    sourcePackID,
    options,
  );
  const compareRef =
    state.sourcePacks[sourcePackID]?.latestRevision ??
    resolveUpstreamRef(sourcePack.localDir, sourcePack.branch, options);
  const compareRevision = resolveRevision(
    sourcePack.localDir,
    compareRef,
    options,
  );
  const count = git(
    options,
    ['rev-list', '--left-right', '--count', `HEAD...${compareRevision}`],
    sourcePack.localDir,
  );
  if (count.exitCode !== 0) {
    throw new Error(count.stderr || 'source_pack_diff_failed');
  }
  const [aheadRaw, behindRaw] = count.stdout.split(/\s+/);
  const ahead = Number.parseInt(aheadRaw ?? '0', 10) || 0;
  const behind = Number.parseInt(behindRaw ?? '0', 10) || 0;
  const logResult = git(
    options,
    ['log', '--oneline', '--max-count', '20', `HEAD..${compareRevision}`],
    sourcePack.localDir,
  );
  const pendingCommits =
    logResult.exitCode === 0 && logResult.stdout
      ? logResult.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      : [];

  return {
    sourcePackID,
    localDir: sourcePack.localDir,
    headRevision: sourcePack.headRevision,
    compareRevision,
    compareRef,
    ahead,
    behind,
    pendingCommits,
    pinnedRelease: state.pinnedReleases[sourcePackID],
  };
}

export function applySourcePack(
  projectDir: string,
  sourcePackID: string,
  input: { revision?: string } = {},
  options?: EcosystemBridgeOptions,
): SourcePackApplyResult {
  const resolved = requireSourcePack(projectDir, sourcePackID, options);
  requireCleanWorkingTree(resolved.sourcePack.localDir, options);

  const targetRef =
    normalizeText(input.revision) ??
    resolved.state.sourcePacks[sourcePackID]?.latestRevision ??
    resolveUpstreamRef(
      resolved.sourcePack.localDir,
      resolved.sourcePack.branch,
      options,
    );
  const targetRevision = resolveRevision(
    resolved.sourcePack.localDir,
    targetRef,
    options,
  );
  const previousRevision = resolved.sourcePack.headRevision;

  if (previousRevision !== targetRevision) {
    const checkout = git(
      options,
      ['checkout', '--detach', targetRevision],
      resolved.sourcePack.localDir,
    );
    if (checkout.exitCode !== 0) {
      throw new Error(checkout.stderr || 'source_pack_apply_failed');
    }
  }

  ensureImportPlan(resolved.state, resolved.sourcePack, options);
  updateSourcePackState(resolved.state, resolved.sourcePack, {
    latestRevision:
      resolved.state.sourcePacks[sourcePackID]?.latestRevision ??
      targetRevision,
    lastError: undefined,
  });

  resolved.state.pinnedReleases[sourcePackID] = {
    sourcePackID,
    revision: targetRevision,
    previousRevision:
      previousRevision !== targetRevision
        ? previousRevision
        : resolved.state.pinnedReleases[sourcePackID]?.previousRevision,
    appliedAt: nowIso(options),
  };
  writeState(projectDir, resolved.state, options);

  return {
    sourcePackID,
    localDir: resolved.sourcePack.localDir,
    appliedRevision: targetRevision,
    previousRevision:
      previousRevision !== targetRevision ? previousRevision : undefined,
    detachedHead: true,
  };
}

export function rollbackSourcePack(
  projectDir: string,
  sourcePackID: string,
  options?: EcosystemBridgeOptions,
): SourcePackRollbackResult {
  const resolved = requireSourcePack(projectDir, sourcePackID, options);
  const pinned = resolved.state.pinnedReleases[sourcePackID];
  if (!pinned?.previousRevision) {
    throw new Error(`source_pack_rollback_unavailable:${sourcePackID}`);
  }
  requireCleanWorkingTree(resolved.sourcePack.localDir, options);

  const previousRevision = resolved.sourcePack.headRevision;
  const rollbackRevision = resolveRevision(
    resolved.sourcePack.localDir,
    pinned.previousRevision,
    options,
  );
  const checkout = git(
    options,
    ['checkout', '--detach', rollbackRevision],
    resolved.sourcePack.localDir,
  );
  if (checkout.exitCode !== 0) {
    throw new Error(checkout.stderr || 'source_pack_rollback_failed');
  }

  resolved.state.pinnedReleases[sourcePackID] = {
    sourcePackID,
    revision: rollbackRevision,
    previousRevision,
    appliedAt: nowIso(options),
  };
  writeState(projectDir, resolved.state, options);

  return {
    sourcePackID,
    localDir: resolved.sourcePack.localDir,
    rolledBackTo: rollbackRevision,
    previousRevision,
    detachedHead: true,
  };
}
