import type { Plugin } from "@opencode-ai/plugin"
import path from "node:path"

const REMOTE_NAME = "origin"
const REMOTE_URL = "https://github.com/mmy4shadow/miya-for-opencode.git"
const DEFAULT_BRANCH = "main"

const MUTATING_TOOLS = new Set(["write", "edit", "multiedit", "bash"])

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

function normalizeProjectPath(projectDir: string, maybePath: unknown): string | undefined {
  if (typeof maybePath !== "string") return
  if (!maybePath.trim()) return

  const absolute = path.isAbsolute(maybePath) ? maybePath : path.resolve(projectDir, maybePath)
  const relative = path.relative(projectDir, absolute)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return
  return relative.replaceAll("\\", "/")
}

function extractTouchedPaths(tool: string, args: any, projectDir: string): string[] {
  const result = new Set<string>()
  if (!args || typeof args !== "object") return []

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

async function runGit(projectDir: string, args: string[]): Promise<GitResult> {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd: projectDir,
    stdout: "pipe",
    stderr: "pipe",
  })
  const code = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  return {
    ok: code === 0,
    code,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
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

async function stageChanges(projectDir: string, paths: Set<string>) {
  const list = Array.from(paths)
  if (list.length > 0) {
    await runGit(projectDir, ["add", "-A", "--", ...list])
  }
  await runGit(projectDir, ["add", "-u"])
}

async function commitAndPush(projectDir: string, client: ClientLike, reason: string, paths: Set<string>) {
  const okRepo = await ensureRepo(projectDir, client)
  if (!okRepo) return

  await stageChanges(projectDir, paths)
  const staged = await runGit(projectDir, ["diff", "--cached", "--name-only"])
  if (!staged.ok || !staged.stdout) return

  let branch = await runGit(projectDir, ["branch", "--show-current"])
  if (!branch.ok || !branch.stdout) {
    await runGit(projectDir, ["checkout", "-B", DEFAULT_BRANCH])
    branch = await runGit(projectDir, ["branch", "--show-current"])
  }
  const targetBranch = branch.stdout || DEFAULT_BRANCH

  const commit = await runGit(projectDir, ["commit", "-m", `chore(auto-save): ${reason}`])
  if (!commit.ok) {
    await log(client, "warn", "git commit skipped/failed", { stderr: commit.stderr })
    return
  }

  let push = await runGit(projectDir, ["push", "-u", REMOTE_NAME, targetBranch])
  if (!push.ok && /non-fast-forward|fetch first|rejected/i.test(`${push.stderr} ${push.stdout}`)) {
    push = await runGit(projectDir, ["push", "-u", REMOTE_NAME, targetBranch, "--force-with-lease"])
  }

  if (!push.ok) {
    await log(client, "error", "git push failed", {
      branch: targetBranch,
      stderr: push.stderr,
      stdout: push.stdout,
    })
    return
  }

  await log(client, "info", "git push ok", {
    branch: targetBranch,
    files: staged.stdout.split("\n").filter(Boolean),
  })
}

export const AutoGitPushPlugin: Plugin = async ({ directory, client }) => {
  const pendingByCall = new Map<string, { sessionID: string; paths: string[] }>()
  const touchedBySession = new Map<string, Set<string>>()
  const dirtySessions = new Set<string>()
  let flushing = false
  let flushRequested = false

  const flush = async (reason: string) => {
    if (flushing) {
      flushRequested = true
      return
    }

    flushing = true
    try {
      do {
        flushRequested = false
        const sessions = Array.from(dirtySessions)
        for (const sessionID of sessions) {
          const paths = getSessionSet(touchedBySession, sessionID)
          await commitAndPush(directory, client as ClientLike, `${reason} [session:${sessionID}]`, paths)
          paths.clear()
          dirtySessions.delete(sessionID)
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

      await flush("tool.execute.after")
    },

    event: async ({ event }: any) => {
      const type = String(event?.type ?? "")
      if (type !== "session.idle") return

      const sessionID = String(event?.properties?.sessionID ?? "")
      if (!sessionID) return
      dirtySessions.add(sessionID)
      await flush("session.idle")
    },
  }
}

export default AutoGitPushPlugin
