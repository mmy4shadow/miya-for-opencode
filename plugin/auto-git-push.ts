import type { Plugin } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const REMOTE_NAME = "origin"
const REMOTE_URL = "https://github.com/mmy4shadow/miya-for-opencode.git"
const DEFAULT_BRANCH = "main"
const BRANCH_PREFIX = "miya"
const MIN_FLUSH_INTERVAL_MS = 60_000
const LARGE_FILE_LIMIT_BYTES = 2 * 1024 * 1024
const SELF_APPROVAL_MAX_AGE_MS = 30 * 60 * 1000
const SELF_APPROVAL_RECORD_LIMIT = 500
const STANDARD_RECOVERY_COMMAND =
  "$b=git rev-parse --abbrev-ref HEAD; git pull --rebase origin $b; git push origin $b"

const MUTATING_TOOLS = new Set(["write", "edit", "multiedit", "bash"])
const EXCLUDED_PATH_RULES: RegExp[] = [
  /^\.opencode\//i,
  /^\.venv\//i,
  /(^|\/)node_modules\//i,
  /^tools\/miya-dock\/\.edge-profile\//i,
  /^tools\/miya-dock\/\.tmp\//i,
  /^tools\/miya-dock\/.*\.(log|pid)$/i,
  /^tools\/miya-dock\/.*autohotkey.*\.(zip|exe|msi)$/i,
]
const DENYLIST_PATH_RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: "env_file", pattern: /(^|\/)\.env(\.[^/]+)?$/i },
  { name: "pem_or_key", pattern: /\.(pem|key|p12|pfx)$/i },
  {
    name: "api_or_private_key_file",
    pattern:
      /(^|\/)[^/]*(api[-_]?key|access[-_]?key|private[-_]?key|secret[-_]?key|keypair)[^/]*\.(json|txt|ini|cfg|conf|yml|yaml|env)$/i,
  },
  {
    name: "cookie_file",
    pattern: /(^|\/)[^/]*cookies?[^/]*\.(json|txt|log|sqlite|sqlite3|db)?$/i,
  },
  { name: "sqlite_or_db", pattern: /\.(sqlite|sqlite3|db)(-journal|-wal|-shm)?$/i },
  { name: "log_dir", pattern: /(^|\/)logs?(\/|$)/i },
  { name: "log_file", pattern: /\.(log|trace)$/i },
  { name: "screenshot_dir", pattern: /(^|\/)(screenshots?|screen[-_]?shots?|captures?)(\/|$)/i },
  {
    name: "recording_dir",
    pattern: /(^|\/)(recordings?|screen[-_]?recordings?)(\/|$)/i,
  },
]
const SECRET_RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: "openai", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "openai_project", pattern: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/ },
  { name: "github_pat", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "github_fine_grained_pat", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: "slack_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "aws_key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { name: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+\/=-]{20,}\b/i },
  { name: "set_cookie", pattern: /\bset-cookie\s*:/i },
  {
    name: "password_assignment",
    pattern: /\b(password|passwd|token|api[_-]?key|secret)\b\s*[:=]\s*["']?[A-Za-z0-9._~+\/=-]{8,}/i,
  },
]

type LogLevel = "debug" | "info" | "warn" | "error"
type ClientLike = {
  app?: {
    log?: (params: {
      body: {
        service: string
        level: LogLevel
        message: string
        extra?: Record<string, unknown>
      }
    }) => Promise<unknown>
  }
}

type GitResult = {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

type AutoGitFailureClass = "auth" | "network" | "rebase" | "denied" | "secret_block"

type CommitPushResult =
  | { status: "pushed"; treeHash: string; stagedFiles: string[]; targetRef: string; trace: string }
  | { status: "no_changes" }
  | { status: "duplicate_tree"; treeHash: string }
  | { status: "blocked"; reason: string; details?: string[] }
  | { status: "failed"; reason: string; retryable: boolean }
  | { status: "kill_active"; reason: string }

type SelfApprovalRecord = {
  id: string
  trace_id: string
  session_id: string
  request_hash?: string
  action: string
  tier: "LIGHT" | "STANDARD" | "THOROUGH"
  status: "allow" | "deny"
  reason: string
  checks: string[]
  evidence: string[]
  executor: {
    agent: string
    plan: string
  }
  verifier: {
    agent: string
    verdict: "allow" | "deny"
    summary: string
  }
  rollback: {
    strategy: string
  }
  created_at: string
}

type SelfApprovalStore = {
  records: SelfApprovalRecord[]
}

function getSessionSet(map: Map<string, Set<string>>, sessionID: string) {
  let set = map.get(sessionID)
  if (!set) {
    set = new Set<string>()
    map.set(sessionID, set)
  }
  return set
}

function splitArgs(input: string) {
  return input
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function parseNullDelimited(text: string): string[] {
  return text
    .split("\u0000")
    .map((item) => item.trim())
    .filter(Boolean)
}

function isPathExcluded(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/")
  return EXCLUDED_PATH_RULES.some((rule) => rule.test(normalized))
}

function normalizeProjectPath(projectDir: string, maybePath: unknown): string | undefined {
  if (typeof maybePath !== "string") return
  if (!maybePath.trim()) return

  const absolute = path.isAbsolute(maybePath) ? maybePath : path.resolve(projectDir, maybePath)
  const relative = path.relative(projectDir, absolute)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return
  const normalized = relative.replaceAll("\\", "/")
  if (isPathExcluded(normalized)) return
  return normalized
}

function sanitizeSessionID(sessionID: string): string {
  const safe = sessionID
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
  if (!safe) return "main"
  return safe.slice(0, 80)
}

function shortTrace(): string {
  return createHash("sha1")
    .update(`${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 10)
}

function nowIso(): string {
  return new Date().toISOString()
}

function selfApprovalFile(projectDir: string): string {
  return path.join(projectDir, ".opencode", "miya", "self-approval.json")
}

function readSelfApprovalStore(projectDir: string): SelfApprovalStore {
  const file = selfApprovalFile(projectDir)
  if (!fs.existsSync(file)) return { records: [] }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as SelfApprovalStore
    if (!parsed || !Array.isArray(parsed.records)) return { records: [] }
    return parsed
  } catch {
    return { records: [] }
  }
}

function writeSelfApprovalStore(projectDir: string, store: SelfApprovalStore): void {
  const file = selfApprovalFile(projectDir)
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, "utf-8")
  } catch {}
}

function appendSelfApprovalRecord(
  projectDir: string,
  record: Omit<SelfApprovalRecord, "id" | "created_at">,
): void {
  const store = readSelfApprovalStore(projectDir)
  store.records = [
    {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      created_at: nowIso(),
      ...record,
    },
    ...store.records,
  ].slice(0, SELF_APPROVAL_RECORD_LIMIT)
  writeSelfApprovalStore(projectDir, store)
}

function normalizePathLike(relativePath: string): string {
  return relativePath.replaceAll("\\", "/")
}

function denylistHits(paths: Iterable<string>): string[] {
  const hits: string[] = []
  for (const originalPath of paths) {
    const normalized = normalizePathLike(originalPath)
    for (const rule of DENYLIST_PATH_RULES) {
      if (rule.pattern.test(normalized)) {
        hits.push(`${normalized}:${rule.name}`)
      }
    }
  }
  return hits
}

function buildUnstageCommand(files: string[]): string {
  if (files.length === 0) return "git status"
  return `git restore --staged -- ${files.map((file) => `"${file}"`).join(" ")}`
}

function hasFreshVerifierEvidence(projectDir: string, sessionID: string): {
  ok: boolean
  reason?: string
  evidence?: string[]
} {
  const store = readSelfApprovalStore(projectDir)
  const now = Date.now()
  const latestForSession = store.records.find((record) => record.session_id === sessionID)
  if (!latestForSession) {
    return {
      ok: false,
      reason: "self_approval_missing",
      evidence: ["no self-approval record for this session"],
    }
  }

  const ts = Date.parse(latestForSession.created_at)
  if (!Number.isFinite(ts) || now - ts > SELF_APPROVAL_MAX_AGE_MS) {
    return {
      ok: false,
      reason: "self_approval_stale",
      evidence: [
        `latest_record_created_at=${latestForSession.created_at}`,
        `max_age_ms=${SELF_APPROVAL_MAX_AGE_MS}`,
      ],
    }
  }

  if (latestForSession.status !== "allow" || latestForSession.verifier?.verdict !== "allow") {
    return {
      ok: false,
      reason: "self_approval_not_allowed",
      evidence: [
        `latest_status=${latestForSession.status ?? "unknown"}`,
        `latest_verifier=${latestForSession.verifier?.verdict ?? "unknown"}`,
      ],
    }
  }

  if ((latestForSession.checks?.length ?? 0) === 0 || (latestForSession.evidence?.length ?? 0) === 0) {
    return {
      ok: false,
      reason: "self_approval_evidence_incomplete",
      evidence: [
        `checks=${latestForSession.checks?.length ?? 0}`,
        `evidence=${latestForSession.evidence?.length ?? 0}`,
      ],
    }
  }

  return { ok: true }
}

function isSelfOriginBashCommand(args: any): boolean {
  const command = String(args?.command ?? args?.cmd ?? "")
  if (!command) return false
  return (
    /MIYA_AUTO_GIT_SOURCE=auto-git-push/i.test(command) ||
    /\[miya-auto-git\]/i.test(command)
  )
}

function extractTouchedPaths(tool: string, args: any, projectDir: string): string[] {
  const result = new Set<string>()
  if (!args || typeof args !== "object") return []

  if (tool === "bash" && isSelfOriginBashCommand(args)) {
    return []
  }

  if (tool === "write" || tool === "edit" || tool === "multiedit") {
    const candidates = [args.filePath, args.filepath, args.file_path, args.path, args.target]
    for (const candidate of candidates) {
      const normalized = normalizeProjectPath(projectDir, candidate)
      if (normalized) result.add(normalized)
    }
  }

  if (tool === "bash") {
    for (const token of splitArgs(String(args.command ?? args.cmd ?? ""))) {
      if (token.includes("/") || token.includes("\\")) {
        const normalized = normalizeProjectPath(projectDir, token)
        if (normalized) result.add(normalized)
      }
    }
  }

  return Array.from(result)
}

async function runGit(
  projectDir: string,
  args: string[],
  options?: { trim?: boolean; env?: Record<string, string> },
): Promise<GitResult> {
  const proc = spawn("git", args, {
    cwd: projectDir,
    env: {
      ...process.env,
      MIYA_AUTO_GIT_SOURCE: "auto-git-push",
      ...(options?.env ?? {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  proc.stdout?.on("data", (chunk) => {
    stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  })
  proc.stderr?.on("data", (chunk) => {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  })
  const code = await new Promise<number>((resolve) => {
    proc.on("close", (exitCode) => resolve(exitCode ?? 1))
    proc.on("error", () => resolve(1))
  })
  const stdoutRaw = Buffer.concat(stdoutChunks).toString("utf-8")
  const stderrRaw = Buffer.concat(stderrChunks).toString("utf-8")
  const trim = options?.trim ?? true
  return {
    ok: code === 0,
    code,
    stdout: trim ? stdoutRaw.trim() : stdoutRaw,
    stderr: trim ? stderrRaw.trim() : stderrRaw,
  }
}

async function log(client: ClientLike, level: LogLevel, message: string, extra?: Record<string, unknown>) {
  try {
    await client.app?.log?.({
      body: {
        service: "auto-git-push",
        level,
        message,
        extra,
      },
    })
  } catch {}
}

function readKillSwitch(projectDir: string): {
  active: boolean
  reason?: string
  trace_id?: string
} {
  const file = path.join(projectDir, ".opencode", "miya", "kill-switch.json")
  if (!fs.existsSync(file)) return { active: false }
  try {
    const raw = fs.readFileSync(file, "utf-8")
    const parsed = JSON.parse(raw) as {
      active?: boolean
      reason?: string
      trace_id?: string
    }
    return {
      active: parsed.active === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
      trace_id: typeof parsed.trace_id === "string" ? parsed.trace_id : undefined,
    }
  } catch {
    return { active: false }
  }
}

function writeAutoGitStatus(
  projectDir: string,
  payload: {
    session_id: string
    status: string
    reason?: string
    trace?: string
    trace_id?: string
    failure_class?: AutoGitFailureClass
    target_ref?: string
    recovery_command?: string
  },
): void {
  const file = path.join(projectDir, ".opencode", "miya", "auto-git-push.json")
  const body = {
    updated_at: new Date().toISOString(),
    ...payload,
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, "utf-8")
  } catch {}
}

function classifyFailure(input: {
  reason: string
  stdout?: string
  stderr?: string
  details?: string[]
}): AutoGitFailureClass {
  if (input.reason === "self_approval_missing" || input.reason === "self_approval_stale") return "denied"
  if (input.reason === "staged_security_scan_failed" || input.reason === "denylist_path_blocked") {
    const details = (input.details ?? []).join(" ").toLowerCase()
    if (details.includes("secret:") || details.includes("api") || details.includes("private_key")) {
      return "secret_block"
    }
    return "denied"
  }
  const text = `${input.stdout ?? ""}\n${input.stderr ?? ""}`.toLowerCase()
  if (text.includes("authentication") || text.includes("permission denied") || text.includes("access denied")) {
    return "auth"
  }
  if (text.includes("non-fast-forward") || text.includes("fetch first") || text.includes("rebase")) {
    return "rebase"
  }
  if (
    text.includes("network") ||
    text.includes("timed out") ||
    text.includes("could not resolve host") ||
    text.includes("connection")
  ) {
    return "network"
  }
  if (input.reason.includes("deny")) return "denied"
  return "denied"
}

async function ensureRepo(projectDir: string, client: ClientLike): Promise<boolean> {
  const inside = await runGit(projectDir, ["rev-parse", "--is-inside-work-tree"])
  if (!inside.ok) {
    const init = await runGit(projectDir, ["init", "-b", DEFAULT_BRANCH])
    if (!init.ok) {
      await log(client, "error", "git init failed", { stderr: init.stderr })
      return false
    }
    await log(client, "info", "initialized git repository", { branch: DEFAULT_BRANCH })
  }

  const remoteGet = await runGit(projectDir, ["remote", "get-url", REMOTE_NAME])
  if (!remoteGet.ok) {
    const remoteAdd = await runGit(projectDir, ["remote", "add", REMOTE_NAME, REMOTE_URL])
    if (!remoteAdd.ok) {
      await log(client, "error", "git remote add failed", { stderr: remoteAdd.stderr })
      return false
    }
  } else if (remoteGet.stdout !== REMOTE_URL) {
    const remoteSet = await runGit(projectDir, ["remote", "set-url", REMOTE_NAME, REMOTE_URL])
    if (!remoteSet.ok) {
      await log(client, "error", "git remote set-url failed", { stderr: remoteSet.stderr })
      return false
    }
  }

  return true
}

async function stageTrackedUpdates(projectDir: string): Promise<void> {
  const tracked = await runGit(projectDir, ["ls-files", "-m", "-d", "-z"], { trim: false })
  if (!tracked.ok || !tracked.stdout) return
  const files = parseNullDelimited(tracked.stdout).filter((file) => !isPathExcluded(file))
  if (files.length === 0) return
  await runGit(projectDir, ["add", "-u", "--", ...files])
}

async function unstageExcluded(projectDir: string, stagedFiles: string[]): Promise<void> {
  const excluded = stagedFiles.filter((file) => isPathExcluded(file))
  if (excluded.length === 0) return
  await runGit(projectDir, ["restore", "--staged", "--", ...excluded])
}

async function getStagedFiles(projectDir: string): Promise<string[]> {
  const staged = await runGit(projectDir, ["diff", "--cached", "--name-only", "-z"], {
    trim: false,
  })
  if (!staged.ok || !staged.stdout) return []
  return parseNullDelimited(staged.stdout)
}

async function stageChanges(projectDir: string, paths: Set<string>): Promise<string[]> {
  const list = Array.from(paths).filter((item) => !isPathExcluded(item))
  if (list.length > 0) {
    await runGit(projectDir, ["add", "-A", "--", ...list])
  }
  await stageTrackedUpdates(projectDir)
  const staged = await getStagedFiles(projectDir)
  if (staged.length === 0) return []
  await unstageExcluded(projectDir, staged)
  return await getStagedFiles(projectDir)
}

function secretHits(content: string): string[] {
  const hits: string[] = []
  for (const rule of SECRET_RULES) {
    if (rule.pattern.test(content)) hits.push(rule.name)
  }
  return hits
}

async function scanStagedContent(projectDir: string, stagedFiles: string[]): Promise<{
  ok: boolean
  reason?: string
  details?: string[]
  recovery?: string
}> {
  const issues: string[] = []
  const denylistIssues = denylistHits(stagedFiles)
  if (denylistIssues.length > 0) {
    const denyFiles = Array.from(
      new Set(denylistIssues.map((entry) => entry.split(":")[0]).filter(Boolean)),
    )
    await runGit(projectDir, ["restore", "--staged", "--", ...denyFiles])
    return {
      ok: false,
      reason: "denylist_path_blocked",
      details: denylistIssues,
      recovery: buildUnstageCommand(denyFiles),
    }
  }

  for (const file of stagedFiles) {
    const size = await runGit(projectDir, ["cat-file", "-s", `:${file}`])
    if (!size.ok) continue
    const bytes = Number.parseInt(size.stdout, 10)
    if (Number.isFinite(bytes) && bytes > LARGE_FILE_LIMIT_BYTES) {
      issues.push(`large_file:${file}:${bytes}`)
      continue
    }

    const show = await runGit(projectDir, ["show", `:${file}`], { trim: false })
    if (!show.ok) continue
    const hits = secretHits(show.stdout)
    if (hits.length > 0) {
      issues.push(`secret:${file}:${hits.join(",")}`)
    }
  }

  if (issues.length > 0) {
    const matchedFiles = Array.from(
      new Set(
        issues
          .map((entry) => entry.split(":")[1])
          .filter((item): item is string => typeof item === "string" && item.length > 0),
      ),
    )
    if (matchedFiles.length > 0) {
      await runGit(projectDir, ["restore", "--staged", "--", ...matchedFiles])
    }
    return {
      ok: false,
      reason: "staged_security_scan_failed",
      details: issues,
      recovery: buildUnstageCommand(matchedFiles),
    }
  }
  return { ok: true }
}

async function blockAutoPushWithRecord(
  projectDir: string,
  client: ClientLike,
  sessionID: string,
  trace: string,
  reason: string,
  details: string[],
  recovery: string,
  failureClass: AutoGitFailureClass,
): Promise<CommitPushResult> {
  appendSelfApprovalRecord(projectDir, {
    trace_id: trace,
    session_id: sessionID,
    action: "auto_git_push",
    tier: "STANDARD",
    status: "deny",
    reason,
    checks: ["auto-git pre-push gate"],
    evidence: details.slice(0, 40),
    executor: {
      agent: "auto-git-push",
      plan: "stage changed files and push branch checkpoint",
    },
    verifier: {
      agent: "auto-git-push-verifier",
      verdict: "deny",
      summary: reason,
    },
    rollback: {
      strategy: "redact sensitive content and rerun self-approval before retrying auto push",
    },
  })
  await log(client, "error", "auto push blocked", {
    session: sessionID,
    trace_id: trace,
    reason,
    failure_class: failureClass,
    details,
    recovery,
  })
  writeAutoGitStatus(projectDir, {
    session_id: sessionID,
    status: "blocked",
    reason,
    trace,
    trace_id: trace,
    failure_class: failureClass,
    recovery_command: recovery,
  })
  return { status: "blocked", reason, details }
}

async function commitAndPush(
  projectDir: string,
  client: ClientLike,
  reason: string,
  sessionID: string,
  paths: Set<string>,
  lastTreeHash?: string,
): Promise<CommitPushResult> {
  const kill = readKillSwitch(projectDir)
  if (kill.active) {
    await log(client, "warn", "kill switch active, auto git flush skipped", {
      session: sessionID,
      reason: kill.reason ?? "n/a",
      trace_id: kill.trace_id ?? "n/a",
    })
    writeAutoGitStatus(projectDir, {
      session_id: sessionID,
      status: "skipped",
      reason: `kill_switch_active:${kill.reason ?? "n/a"}`,
      trace: kill.trace_id,
    })
    return { status: "kill_active", reason: kill.reason ?? "kill_switch_active" }
  }

  const trace = shortTrace()
  const approvalGate = hasFreshVerifierEvidence(projectDir, sessionID)
  if (!approvalGate.ok) {
    const details = [
      `gate=self_approval`,
      `reason=${approvalGate.reason ?? "self_approval_missing"}`,
      ...(approvalGate.evidence ?? []),
    ]
    return await blockAutoPushWithRecord(
      projectDir,
      client,
      sessionID,
      trace,
      approvalGate.reason ?? "self_approval_missing",
      details,
      STANDARD_RECOVERY_COMMAND,
      "denied",
    )
  }

  const okRepo = await ensureRepo(projectDir, client)
  if (!okRepo) {
    const failureClass = classifyFailure({ reason: "ensure_repo_failed" })
    writeAutoGitStatus(projectDir, {
      session_id: sessionID,
      status: "failed",
      reason: "ensure_repo_failed",
      trace,
      trace_id: trace,
      failure_class: failureClass,
      recovery_command: STANDARD_RECOVERY_COMMAND,
    })
    return { status: "failed", reason: "ensure_repo_failed", retryable: true }
  }

  const stagedFiles = await stageChanges(projectDir, paths)
  if (stagedFiles.length === 0) {
    return { status: "no_changes" }
  }

  const tree = await runGit(projectDir, ["write-tree"])
  if (tree.ok && tree.stdout && lastTreeHash && tree.stdout === lastTreeHash) {
    return { status: "duplicate_tree", treeHash: tree.stdout }
  }

  const scan = await scanStagedContent(projectDir, stagedFiles)
  if (!scan.ok) {
    const reasonCode = scan.reason ?? "staged_security_scan_failed"
    const details = scan.details ?? []
    return await blockAutoPushWithRecord(
      projectDir,
      client,
      sessionID,
      trace,
      reasonCode,
      details,
      STANDARD_RECOVERY_COMMAND,
      classifyFailure({
        reason: reasonCode,
        details,
      }),
    )
  }

  const commitMessage = `chore(auto-save): ${reason} [session:${sessionID}] [trace:${trace}]`
  const commit = await runGit(projectDir, ["commit", "-m", commitMessage])
  if (!commit.ok) {
    if (/nothing to commit/i.test(`${commit.stdout}\n${commit.stderr}`)) {
      return { status: "no_changes" }
    }
    await log(client, "warn", "git commit failed", {
      session: sessionID,
      trace_id: trace,
      stderr: commit.stderr,
      stdout: commit.stdout,
      recovery_command: STANDARD_RECOVERY_COMMAND,
    })
    const failureClass = classifyFailure({
      reason: "commit_failed",
      stdout: commit.stdout,
      stderr: commit.stderr,
    })
    writeAutoGitStatus(projectDir, {
      session_id: sessionID,
      status: "failed",
      reason: "commit_failed",
      trace,
      trace_id: trace,
      failure_class: failureClass,
      recovery_command: STANDARD_RECOVERY_COMMAND,
    })
    return { status: "failed", reason: "commit_failed", retryable: true }
  }

  const targetRef = `refs/heads/${BRANCH_PREFIX}/${sanitizeSessionID(sessionID)}`
  let push = await runGit(projectDir, ["push", "-u", REMOTE_NAME, `HEAD:${targetRef}`])
  if (!push.ok && /non-fast-forward|fetch first|rejected/i.test(`${push.stderr} ${push.stdout}`)) {
    push = await runGit(projectDir, [
      "push",
      "-u",
      REMOTE_NAME,
      `HEAD:${targetRef}`,
      "--force-with-lease",
    ])
  }

  if (!push.ok) {
    const failureClass = classifyFailure({
      reason: "push_failed",
      stdout: push.stdout,
      stderr: push.stderr,
    })
    await log(client, "error", "git push failed", {
      session: sessionID,
      targetRef,
      trace_id: trace,
      failure_class: failureClass,
      stderr: push.stderr,
      stdout: push.stdout,
      recovery_command: STANDARD_RECOVERY_COMMAND,
    })
    writeAutoGitStatus(projectDir, {
      session_id: sessionID,
      status: "failed",
      reason: "push_failed",
      trace,
      trace_id: trace,
      failure_class: failureClass,
      target_ref: targetRef,
      recovery_command: STANDARD_RECOVERY_COMMAND,
    })
    return { status: "failed", reason: "push_failed", retryable: true }
  }

  await log(client, "info", "git push ok", {
    session: sessionID,
    targetRef,
    trace_id: trace,
    files: stagedFiles,
  })
  appendSelfApprovalRecord(projectDir, {
    trace_id: trace,
    session_id: sessionID,
    action: "auto_git_push",
    tier: "STANDARD",
    status: "allow",
    reason: "auto_push_succeeded",
    checks: ["self-approval gate", "denylist path scan", "secret scan", "large file scan"],
    evidence: [
      `target_ref=${targetRef}`,
      `staged_files=${stagedFiles.join(",")}`,
    ],
    executor: {
      agent: "auto-git-push",
      plan: "commit staged task changes and push branch checkpoint",
    },
    verifier: {
      agent: "auto-git-push-verifier",
      verdict: "allow",
      summary: "All pre-push gates passed.",
    },
    rollback: {
      strategy: `git revert HEAD or reset local branch before next push (trace=${trace})`,
    },
  })
  writeAutoGitStatus(projectDir, {
    session_id: sessionID,
    status: "pushed",
    trace,
    trace_id: trace,
    target_ref: targetRef,
  })

  return {
    status: "pushed",
    treeHash: tree.ok ? tree.stdout : "",
    stagedFiles,
    targetRef,
    trace,
  }
}

export const AutoGitPushPlugin: Plugin = async ({ directory, client }) => {
  const pendingByCall = new Map<string, { sessionID: string; paths: string[] }>()
  const touchedBySession = new Map<string, Set<string>>()
  const dirtySessions = new Set<string>()
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const lastFlushAtBySession = new Map<string, number>()
  const lastCommittedTreeBySession = new Map<string, string>()
  let flushing = false
  let flushRequested = false

  const scheduleFlush = (sessionID: string, delayMs: number, reason: string) => {
    const current = debounceTimers.get(sessionID)
    if (current) {
      clearTimeout(current)
      debounceTimers.delete(sessionID)
    }
    const timer = setTimeout(() => {
      debounceTimers.delete(sessionID)
      void flush(reason, [sessionID])
    }, Math.max(0, delayMs))
    debounceTimers.set(sessionID, timer)
  }

  const flush = async (reason: string, onlySessions?: string[]) => {
    if (flushing) {
      flushRequested = true
      return
    }

    flushing = true
    try {
      do {
        flushRequested = false
        const sessions = onlySessions && onlySessions.length > 0 ? onlySessions : Array.from(dirtySessions)
        for (const sessionID of sessions) {
          if (!dirtySessions.has(sessionID)) continue

          const lastAt = lastFlushAtBySession.get(sessionID) ?? 0
          const waitMs = MIN_FLUSH_INTERVAL_MS - (Date.now() - lastAt)
          if (waitMs > 0) {
            scheduleFlush(sessionID, waitMs, "min-flush-interval")
            continue
          }

          const paths = getSessionSet(touchedBySession, sessionID)
          const result = await commitAndPush(
            directory,
            client as ClientLike,
            reason,
            sessionID,
            paths,
            lastCommittedTreeBySession.get(sessionID),
          )

          if (result.status === "pushed") {
            lastFlushAtBySession.set(sessionID, Date.now())
            if (result.treeHash) lastCommittedTreeBySession.set(sessionID, result.treeHash)
            paths.clear()
            dirtySessions.delete(sessionID)
            continue
          }

          if (result.status === "no_changes" || result.status === "duplicate_tree") {
            lastFlushAtBySession.set(sessionID, Date.now())
            if (result.status === "duplicate_tree") {
              lastCommittedTreeBySession.set(sessionID, result.treeHash)
            }
            paths.clear()
            dirtySessions.delete(sessionID)
            continue
          }

          if (result.status === "blocked") {
            await log(client as ClientLike, "error", "auto git flush blocked", {
              session: sessionID,
              reason: result.reason,
              details: result.details ?? [],
            })
            scheduleFlush(sessionID, MIN_FLUSH_INTERVAL_MS, "retry-after-blocked")
            continue
          }

          if (result.status === "kill_active") {
            scheduleFlush(sessionID, MIN_FLUSH_INTERVAL_MS, "kill-switch-wait")
            continue
          }

          if (result.status === "failed") {
            await log(client as ClientLike, "warn", "auto git flush failed and will retry", {
              session: sessionID,
              reason: result.reason,
              retryable: result.retryable,
            })
            if (result.retryable) {
              scheduleFlush(sessionID, MIN_FLUSH_INTERVAL_MS, "retry-after-failure")
            }
          }
        }
      } while (flushRequested)
    } finally {
      flushing = false
    }
  }

  return {
    "tool.execute.before": async (input: any, output: any) => {
      const tool = String(input?.tool ?? "").toLowerCase()
      if (!MUTATING_TOOLS.has(tool)) return

      const sessionID = String(input?.sessionID ?? "")
      const callID = String(input?.callID ?? "")
      if (!sessionID || !callID) return
      if (tool === "bash" && isSelfOriginBashCommand(output?.args)) return

      const paths = extractTouchedPaths(tool, output?.args, directory)
      pendingByCall.set(callID, { sessionID, paths })
    },

    "tool.execute.after": async (input: any) => {
      const callID = String(input?.callID ?? "")
      const pending = pendingByCall.get(callID)
      if (!pending) return
      pendingByCall.delete(callID)

      const { sessionID, paths } = pending
      const pathSet = getSessionSet(touchedBySession, sessionID)
      for (const p of paths) pathSet.add(p)
      dirtySessions.add(sessionID)
    },

    event: async ({ event }: any) => {
      const type = String(event?.type ?? "")
      if (type === "session.status") {
        const sessionID = String(event?.properties?.sessionID ?? "")
        const statusType = String(event?.properties?.status?.type ?? "")
        if (!sessionID || statusType !== "idle") return
        if (!dirtySessions.has(sessionID)) return
        scheduleFlush(sessionID, 0, "session.status.idle")
        return
      }

      if (type === "session.idle") {
        const sessionID = String(event?.properties?.sessionID ?? "")
        if (!sessionID) return
        if (!dirtySessions.has(sessionID)) return
        scheduleFlush(sessionID, 0, "session.idle")
      }
    },
  }
}

export default AutoGitPushPlugin
