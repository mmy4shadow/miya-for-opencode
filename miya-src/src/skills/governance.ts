import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import { parseSkillFrontmatter } from './frontmatter';

export interface SourcePackCompatibilityMatrix {
  ok: boolean;
  currentVersion: string;
  minVersion?: string;
  maxVersion?: string;
  notes?: string;
}

export interface SourcePackSignatureRecord {
  algorithm: 'sha256';
  digest: string;
  verifiedAt: string;
}

export interface SourcePackVersionLockRecord {
  revision: string;
  lockedAt: string;
}

export interface SourcePackSmokeRecord {
  ok: boolean;
  requiredFiles: string[];
  missingFiles: string[];
  checkedAt: string;
}

export interface SourcePackRegressionRecord {
  ok: boolean;
  requiredFiles: string[];
  missingFiles: string[];
  requireTestArtifacts: boolean;
  testArtifacts: string[];
  checkedAt: string;
}

export interface SourcePackSecurityRecord {
  ok: boolean;
  strict: boolean;
  requirePermissionMetadata: boolean;
  checkedSkillFiles: string[];
  missingPermissionMetadata: string[];
  disallowedPermissions: Array<{
    skillFile: string;
    permission: string;
  }>;
  checkedAt: string;
}

export interface SourcePackGovernanceRecord {
  sourcePackID: string;
  revision: string;
  lock: SourcePackVersionLockRecord;
  signature: SourcePackSignatureRecord;
  compatibility: SourcePackCompatibilityMatrix;
  smoke: SourcePackSmokeRecord;
  regression?: SourcePackRegressionRecord;
  security?: SourcePackSecurityRecord;
  updatedAt: string;
}

interface GovernanceStore {
  version: 1;
  updatedAt: string;
  records: Record<string, SourcePackGovernanceRecord>;
}

interface CompatConfig {
  miya?: {
    minVersion?: string;
    maxVersion?: string;
  };
  smoke?: {
    requiredFiles?: string[];
  };
  regression?: {
    requiredFiles?: string[];
    requireTests?: boolean;
  };
  security?: {
    requirePermissionMetadata?: boolean;
    allowedPermissions?: string[];
    denyPermissions?: string[];
  };
}

const DEFAULT_STORE: GovernanceStore = {
  version: 1,
  updatedAt: new Date(0).toISOString(),
  records: {},
};

const DEFAULT_STRICT_ALLOWED_PERMISSIONS = [
  'shell_exec',
  'fs_read',
  'fs_write',
  'memory_read',
  'memory_write',
  'memory_delete',
  'desktop_control',
  'outbound_send',
  'skills_install',
  'local_build',
];

function nowIso(): string {
  return new Date().toISOString();
}

function governanceFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'ecosystem-governance.json');
}

function readStore(projectDir: string): GovernanceStore {
  const file = governanceFile(projectDir);
  if (!fs.existsSync(file)) return { ...DEFAULT_STORE };
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as Partial<GovernanceStore>;
    return {
      version: 1,
      updatedAt:
        typeof parsed.updatedAt === 'string'
          ? parsed.updatedAt
          : new Date(0).toISOString(),
      records:
        parsed.records && typeof parsed.records === 'object'
          ? (parsed.records as Record<string, SourcePackGovernanceRecord>)
          : {},
    };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

function writeStore(
  projectDir: string,
  store: GovernanceStore,
): GovernanceStore {
  const file = governanceFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next: GovernanceStore = {
    version: 1,
    updatedAt: nowIso(),
    records: store.records,
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

function normalizeSemver(version: string): [number, number, number] {
  const parts = String(version || '0.0.0')
    .split('.')
    .map((item) => Number.parseInt(item.replace(/[^\d]/g, ''), 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function compareSemver(a: string, b: string): number {
  const left = normalizeSemver(a);
  const right = normalizeSemver(b);
  if (left[0] !== right[0]) return left[0] > right[0] ? 1 : -1;
  if (left[1] !== right[1]) return left[1] > right[1] ? 1 : -1;
  if (left[2] !== right[2]) return left[2] > right[2] ? 1 : -1;
  return 0;
}

function readCompatConfig(localDir: string): CompatConfig {
  const file = path.join(localDir, 'miya.compat.json');
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as CompatConfig;
  } catch {
    return {};
  }
}

function currentMiyaVersion(): string {
  return process.env.MIYA_VERSION?.trim() || '0.7.0';
}

function resolveCompatibility(localDir: string): SourcePackCompatibilityMatrix {
  const compat = readCompatConfig(localDir);
  const minVersion = compat.miya?.minVersion?.trim();
  const maxVersion = compat.miya?.maxVersion?.trim();
  const currentVersion = currentMiyaVersion();
  const minOk = minVersion
    ? compareSemver(currentVersion, minVersion) >= 0
    : true;
  const maxOk = maxVersion
    ? compareSemver(currentVersion, maxVersion) <= 0
    : true;
  const ok = minOk && maxOk;
  return {
    ok,
    currentVersion,
    minVersion,
    maxVersion,
    notes: ok ? 'compatible' : 'version_out_of_range',
  };
}

function requiredFiles(localDir: string): string[] {
  const compat = readCompatConfig(localDir);
  const custom = compat.smoke?.requiredFiles;
  if (Array.isArray(custom) && custom.length > 0) {
    return custom
      .map((item) => String(item))
      .filter(Boolean)
      .slice(0, 30);
  }
  return ['SKILL.md'];
}

function runSmoke(localDir: string): SourcePackSmokeRecord {
  const files = requiredFiles(localDir);
  const missing = files.filter(
    (entry) => !fs.existsSync(path.join(localDir, entry)),
  );
  return {
    ok: missing.length === 0,
    requiredFiles: files,
    missingFiles: missing,
    checkedAt: nowIso(),
  };
}

function normalizeRelativePath(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

function listRelativeFiles(localDir: string): string[] {
  const root = path.resolve(localDir);
  const queue: Array<{ dir: string; depth: number }> = [
    { dir: root, depth: 0 },
  ];
  const files: string[] = [];
  const depthLimit = 6;
  const fileLimit = 5000;
  while (queue.length > 0 && files.length < fileLimit) {
    const current = queue.shift();
    if (!current) break;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(current.dir, entry.name);
      const rel = normalizeRelativePath(path.relative(root, abs));
      if (!rel || rel.startsWith('..')) continue;
      if (entry.isDirectory()) {
        if (
          current.depth < depthLimit &&
          entry.name !== '.git' &&
          entry.name !== 'node_modules' &&
          entry.name !== '.venv' &&
          entry.name !== 'dist'
        ) {
          queue.push({ dir: abs, depth: current.depth + 1 });
        }
        continue;
      }
      if (entry.isFile()) {
        files.push(rel);
      }
      if (files.length >= fileLimit) break;
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function runRegression(
  localDir: string,
  strict = false,
): SourcePackRegressionRecord {
  const compat = readCompatConfig(localDir);
  const files = listRelativeFiles(localDir);
  const required =
    Array.isArray(compat.regression?.requiredFiles) &&
    compat.regression?.requiredFiles.length > 0
      ? compat.regression.requiredFiles
          .map(String)
          .map(normalizeRelativePath)
          .slice(0, 80)
      : requiredFiles(localDir).map(normalizeRelativePath);
  const missingFiles = required.filter(
    (entry) => !fs.existsSync(path.join(localDir, entry)),
  );
  const testArtifacts = files.filter((entry) =>
    /(^|\/)(__tests__|tests|test)\b|\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$/i.test(
      entry,
    ),
  );
  const requireTestArtifacts =
    strict ||
    (typeof compat.regression?.requireTests === 'boolean'
      ? compat.regression.requireTests
      : false);
  const ok =
    missingFiles.length === 0 &&
    (!requireTestArtifacts || testArtifacts.length > 0);
  return {
    ok,
    requiredFiles: required,
    missingFiles,
    requireTestArtifacts,
    testArtifacts: testArtifacts.slice(0, 200),
    checkedAt: nowIso(),
  };
}

function parsePermissionList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 100);
}

function parsePermissionEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/g)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 100);
}

function resolveAllowedPermissions(
  compat: CompatConfig,
  strict: boolean,
): Set<string> | null {
  const fromCompat = parsePermissionList(compat.security?.allowedPermissions);
  if (fromCompat.length > 0) return new Set(fromCompat);
  const fromEnv = parsePermissionEnv(
    process.env.MIYA_ALLOWED_SKILL_PERMISSIONS,
  );
  if (fromEnv.length > 0) return new Set(fromEnv);
  if (!strict) return null;
  return new Set(DEFAULT_STRICT_ALLOWED_PERMISSIONS);
}

function resolveDeniedPermissions(compat: CompatConfig): Set<string> {
  const denied = [
    ...parsePermissionList(compat.security?.denyPermissions),
    ...parsePermissionEnv(process.env.MIYA_DENY_SKILL_PERMISSIONS),
  ];
  return new Set(denied);
}

function runSecurity(
  localDir: string,
  strict = false,
): SourcePackSecurityRecord {
  const compat = readCompatConfig(localDir);
  const files = listRelativeFiles(localDir);
  const skillFiles = files
    .filter((entry) => /(^|\/)SKILL\.md$/i.test(entry))
    .slice(0, 200);
  const requirePermissionMetadata =
    strict ||
    (typeof compat.security?.requirePermissionMetadata === 'boolean'
      ? compat.security.requirePermissionMetadata
      : false);
  const missingPermissionMetadata: string[] = [];
  const disallowedPermissions: Array<{
    skillFile: string;
    permission: string;
  }> = [];
  const allowed = resolveAllowedPermissions(compat, strict);
  const denied = resolveDeniedPermissions(compat);
  for (const rel of skillFiles) {
    const file = path.join(localDir, rel);
    let content = '';
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const frontmatter = parseSkillFrontmatter(content);
    const permissions = parsePermissionList(frontmatter.permissions);
    if (permissions.length === 0) {
      if (requirePermissionMetadata) {
        missingPermissionMetadata.push(rel);
      }
      continue;
    }
    for (const permission of permissions) {
      if (denied.has(permission)) {
        disallowedPermissions.push({ skillFile: rel, permission });
        continue;
      }
      if (allowed && !allowed.has(permission)) {
        disallowedPermissions.push({ skillFile: rel, permission });
      }
    }
  }
  if (requirePermissionMetadata && skillFiles.length === 0) {
    missingPermissionMetadata.push('SKILL.md');
  }
  const ok =
    missingPermissionMetadata.length === 0 &&
    disallowedPermissions.length === 0;
  return {
    ok,
    strict,
    requirePermissionMetadata,
    checkedSkillFiles: skillFiles,
    missingPermissionMetadata,
    disallowedPermissions,
    checkedAt: nowIso(),
  };
}

function buildDigest(localDir: string, revision: string): string {
  const hasher = createHash('sha256');
  hasher.update(revision);
  for (const rel of ['SKILL.md', 'README.md']) {
    const file = path.join(localDir, rel);
    if (!fs.existsSync(file)) continue;
    hasher.update(rel);
    hasher.update('\n');
    hasher.update(fs.readFileSync(file, 'utf-8'));
    hasher.update('\n');
  }
  return hasher.digest('hex');
}

export function refreshSourcePackGovernance(
  projectDir: string,
  input: {
    sourcePackID: string;
    localDir: string;
    revision: string;
  },
): SourcePackGovernanceRecord {
  const store = readStore(projectDir);
  const now = nowIso();
  const record: SourcePackGovernanceRecord = {
    sourcePackID: input.sourcePackID,
    revision: input.revision,
    lock: {
      revision: input.revision,
      lockedAt: now,
    },
    signature: {
      algorithm: 'sha256',
      digest: buildDigest(input.localDir, input.revision),
      verifiedAt: now,
    },
    compatibility: resolveCompatibility(input.localDir),
    smoke: runSmoke(input.localDir),
    regression: runRegression(input.localDir, false),
    security: runSecurity(input.localDir, false),
    updatedAt: now,
  };
  store.records[input.sourcePackID] = record;
  writeStore(projectDir, store);
  return record;
}

export function getSourcePackGovernance(
  projectDir: string,
  sourcePackID: string,
): SourcePackGovernanceRecord | undefined {
  const store = readStore(projectDir);
  return store.records[sourcePackID];
}

export function verifySourcePackGovernance(
  projectDir: string,
  input: {
    sourcePackID: string;
    localDir: string;
    revision: string;
    strict?: boolean;
  },
): {
  signatureValid: boolean;
  lockValid: boolean;
  compatibilityValid: boolean;
  smokeValid: boolean;
  regressionValid: boolean;
  securityValid: boolean;
  record?: SourcePackGovernanceRecord;
} {
  const record = getSourcePackGovernance(projectDir, input.sourcePackID);
  if (!record) {
    return {
      signatureValid: false,
      lockValid: false,
      compatibilityValid: false,
      smokeValid: false,
      regressionValid: false,
      securityValid: false,
      record: undefined,
    };
  }
  const strict = input.strict === true;
  const digest = buildDigest(input.localDir, input.revision);
  const signatureValid = digest === record.signature.digest;
  const lockValid = record.lock.revision === input.revision;
  const compatibility = resolveCompatibility(input.localDir);
  const compatibilityValid = compatibility.ok;
  const smoke = runSmoke(input.localDir);
  const smokeValid = smoke.ok;
  const regression = runRegression(input.localDir, strict);
  const security = runSecurity(input.localDir, strict);
  return {
    signatureValid,
    lockValid,
    compatibilityValid,
    smokeValid,
    regressionValid: regression.ok,
    securityValid: security.ok,
    record: {
      ...record,
      compatibility,
      smoke,
      regression,
      security,
      updatedAt: nowIso(),
    },
  };
}
