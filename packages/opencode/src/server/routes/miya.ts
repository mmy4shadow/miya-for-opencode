import { Hono } from "hono"
import { validator } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { lazy } from "@/util/lazy"
import { Instance } from "@/project/instance"
import { Global } from "@/global"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SecretStore } from "@/server/secret-store"
import { MiyaAutomationService } from "@opencode-ai/miya/automation"
import { getMiyaRuntimeDir } from "@opencode-ai/miya/workflow"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

const ModelRef = z.string().regex(/^[^/]+\/[^/]+$/)
const JobCreateInput = z.object({
  name: z.string().min(1),
  time: z.string().regex(/^([01]?\d|2[0-3]):([0-5]\d)$/),
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeout_ms: z.number().positive().optional(),
  require_approval: z.boolean().optional(),
})
const JobEnableInput = z.object({ enabled: z.boolean() })
const GatewayImageInput = z.object({
  url: z.string().min(1),
  filename: z.string().optional(),
  mime: z.string().optional(),
})
const GatewayAudioInput = z.object({
  url: z.string().min(1),
  filename: z.string().optional(),
  mime: z.string().optional(),
})
const GatewayTurnInput = z
  .object({
    session_id: z.string().optional(),
    agent: z.string().optional(),
    model: ModelRef.optional(),
    text: z.string().optional(),
    images: z.array(GatewayImageInput).optional(),
    audios: z.array(GatewayAudioInput).optional(),
  })
  .refine((value) => {
    const text = value.text?.trim() ?? ""
    return text.length > 0 || (value.images?.length ?? 0) > 0 || (value.audios?.length ?? 0) > 0
  }, "either text, images, or audios is required")
const ToolInvokeInput = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
  session_id: z.string().optional(),
  agent: z.string().optional(),
})
const ConnectorPatchInput = z.object({
  enabled: z.boolean().optional(),
  webhook_url: z.string().optional(),
  webhook_secret: z.string().optional(),
  slack_bot_token: z.string().optional(),
  slack_channel: z.string().optional(),
  telegram_bot_token: z.string().optional(),
  telegram_chat_id: z.string().optional(),
})
const BrowserCreateInput = z.object({ url: z.string().optional(), title: z.string().optional() })
const BrowserNavigateInput = z.object({ url: z.string().min(1) })
const BrowserActionInput = z.object({
  action: z.string().min(1),
  target: z.string().optional(),
  value: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
const LoopStatePatchInput = z.object({
  loopEnabled: z.boolean().optional(),
  autoContinue: z.boolean().optional(),
  maxIterationsPerWindow: z.number().int().min(1).max(12).optional(),
  strictQualityGate: z.boolean().optional(),
})
const SessionListQueryInput = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  include_archived: z.coerce.boolean().optional(),
})
const SessionCreateInput = z.object({
  title: z.string().min(1).optional(),
  parent_id: z.string().optional(),
})
const SessionPatchInput = z.object({
  title: z.string().min(1).optional(),
  archived: z.boolean().optional(),
})
const SessionMessagesQueryInput = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
})
const SessionSendInput = z.object({
  text: z.string().min(1),
  agent: z.string().optional(),
  model: ModelRef.optional(),
})
const SessionRouteInput = z.object({
  from_session_id: z.string().optional(),
  to_session_id: z.string(),
  text: z.string().min(1),
  include_context: z.boolean().optional(),
  context_limit: z.number().int().min(1).max(30).optional(),
  agent: z.string().optional(),
  model: ModelRef.optional(),
})
const SessionSpawnInput = z.object({
  task: z.string().min(1),
  label: z.string().optional(),
  parent_session_id: z.string().optional(),
  agent: z.string().optional(),
  model: ModelRef.optional(),
  timeout_seconds: z.number().int().min(0).max(600).optional(),
  cleanup: z.enum(["keep", "delete"]).optional(),
})
const ClawraProfileInput = z.object({
  reference_photo: z.string().optional(),
  voice_sample: z.string().optional(),
  personality_prompt: z.string().optional(),
  nsfw_enabled: z.boolean().optional(),
  auto_persona: z.boolean().optional(),
  elevenlabs_voice_id: z.string().optional(),
  voice_backend_default: z.enum(["elevenlabs", "coqui", "rvc"]).optional(),
  selfie_mode_default: z.enum(["mirror", "direct", "auto"]).optional(),
})
const ClawraSelfieInput = z.object({
  prompt: z.string().min(1),
  mode: z.enum(["mirror", "direct", "auto"]).optional(),
  user_context: z.string().optional(),
  aspect_ratio: z.string().optional(),
  output_format: z.enum(["jpeg", "png", "webp"]).optional(),
  num_images: z.number().int().min(1).max(4).optional(),
  include_persona: z.boolean().optional(),
})
const ClawraVoiceInput = z.object({
  text: z.string().min(1),
  provider: z.enum(["elevenlabs", "coqui", "rvc"]).optional(),
  voice_id: z.string().optional(),
  model_id: z.string().optional(),
  fallback_to_cloud: z.boolean().optional(),
})
const ClawraVoiceCloneInput = z.object({
  provider: z.enum(["elevenlabs", "coqui", "rvc"]).optional(),
  voice_sample_url: z.string().optional(),
  voice_name: z.string().optional(),
  persist_as_default: z.boolean().optional(),
})
const ClawraOnboardingStartInput = z.object({
  reset: z.boolean().optional(),
})
const ClawraOnboardingStepInput = z.object({
  step: z.enum(["photo", "voice", "persona"]),
  value: z.string().min(1),
  provider: z.enum(["elevenlabs", "coqui", "rvc"]).optional(),
})
const SecretPutInput = z.object({ value: z.string().min(1) })
const SecretProviderParam = z.object({
  provider: z.enum(["fal", "elevenlabs", "slack", "telegram", "webhook"]),
})
const SessionHistoryQueryInput = z.object({
  session_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(400).optional(),
  include_tools: z.coerce.boolean().optional(),
})
const SessionSendTimeoutInput = SessionSendInput.extend({
  timeout_seconds: z.number().int().min(0).max(600).optional(),
})
const SessionRouteTimeoutInput = SessionRouteInput.extend({
  timeout_seconds: z.number().int().min(0).max(600).optional(),
})
const FeatureFlagsPatchInput = z.object({
  clawra_v2: z.boolean().optional(),
  browser_core_v2: z.boolean().optional(),
  sessions_core_v2: z.boolean().optional(),
})
const BrowserSessionRefInput = z.object({
  session_id: z.string(),
})
const BrowserOpenInput = z.object({
  session_id: z.string(),
  url: z.string().min(1),
})
const BrowserSnapshotInput = z.object({
  session_id: z.string(),
  max_chars: z.number().int().min(100).max(20_000).optional(),
  include_html: z.boolean().optional(),
})
const BrowserConsoleQueryInput = z.object({
  session_id: z.string(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})
const BrowserFocusInput = z.object({
  session_id: z.string(),
  tab_id: z.string().optional(),
  index: z.number().int().min(0).optional(),
  url: z.string().optional(),
})
const BrowserCloseInput = z.object({
  session_id: z.string(),
  tab_id: z.string().optional(),
  index: z.number().int().min(0).optional(),
})
const SelfApprovalQueryInput = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
})
const KillSwitchActivateInput = z.object({
  reason: z.string().optional(),
})
const SkillPatchInput = z.object({
  enabled: z.boolean().optional(),
  locked_version: z.string().optional(),
})

type GatewayTurnState = {
  id: string
  session_id: string
  agent: string
  request: string
  status: "running" | "completed" | "failed"
  output: string
  error?: string
  created_at: string
  updated_at: string
}
type GatewayTurnsStore = { turns: Record<string, GatewayTurnState> }
type ToolSummary = { name: string; description: string; args: string[]; safe: boolean }
type ConnectorConfig = {
  enabled: boolean
  webhook_url?: string
  webhook_secret?: string
  slack_bot_token?: string
  slack_channel?: string
  telegram_bot_token?: string
  telegram_chat_id?: string
  last_test_at?: string
  last_test_ok?: boolean
  last_test_error?: string
}
type ConnectorsStore = { webhook: ConnectorConfig; slack: ConnectorConfig; telegram: ConnectorConfig }
type BrowserEvent = { id: string; seq: number; type: string; created_at: string; data?: Record<string, unknown> }
type BrowserSession = {
  id: string
  url?: string
  title?: string
  created_at: string
  updated_at: string
  events: BrowserEvent[]
  live?: boolean
  event_seq?: number
}
type BrowserStore = { sessions: Record<string, BrowserSession> }
type BrowserRuntimeSession = {
  browser: any
  context: any
  page: any
  lastActiveAt: number
}
type SessionSpawnRun = {
  id: string
  parent_session_id?: string
  child_session_id: string
  label?: string
  task: string
  agent: string
  status: "running" | "completed" | "failed" | "timeout"
  message_id?: string
  output?: string
  error?: string
  expires_at?: string
  created_at: string
  updated_at: string
}
type SessionSpawnStore = { runs: Record<string, SessionSpawnRun> }
type MiyaSessionSummary = {
  id: string
  title: string
  parent_id?: string
  archived: boolean
  created_at: string
  updated_at: string
  status: { type: string; [key: string]: unknown }
}
type MiyaSessionMessage = {
  id: string
  role: string
  agent?: string
  created_at: string
  text: string
}
type ClawraProfile = {
  reference_photo?: string
  voice_sample?: string
  personality_prompt?: string
  nsfw_enabled: boolean
  auto_persona: boolean
  elevenlabs_voice_id?: string
  voice_backend_default: "elevenlabs" | "coqui" | "rvc"
  selfie_mode_default: "mirror" | "direct" | "auto"
}
type ClawraOnboardingState = {
  stage: "idle" | "photo" | "voice" | "persona" | "ready"
  updated_at: string
  history: { step: "photo" | "voice" | "persona"; value_preview: string; at: string }[]
}
type SessionInteropRun = {
  id: string
  mode: "send" | "route"
  from_session_id?: string
  to_session_id: string
  status: "accepted" | "ok" | "timeout" | "error"
  output?: string
  error?: string
  created_at: string
  updated_at: string
}
type MiyaFeatureFlags = {
  clawra_v2: boolean
  browser_core_v2: boolean
  sessions_core_v2: boolean
}
type KillSwitchState = {
  active: boolean
  reason?: string
  activated_at?: string
  released_at?: string
  updated_at: string
}
type SelfApprovalRecord = {
  id: string
  action: string
  executor: { agent: string; plan: string; expected: string }
  verifier: { agent: string; verdict: "allow" | "deny"; checks: string[]; evidence: string[] }
  rollback: { strategy: string; checkpoint?: string }
  status: "executed" | "failed" | "blocked"
  created_at: string
  duration_ms: number
  error?: string
}
type SelfApprovalStore = { records: SelfApprovalRecord[] }
type SkillPackState = {
  id: string
  enabled: boolean
  locked_version?: string
  source: "project"
  updated_at: string
}
type SkillPackStore = { skills: SkillPackState[] }

const defaultGatewayStore = (): GatewayTurnsStore => ({ turns: {} })
const defaultBrowserStore = (): BrowserStore => ({ sessions: {} })
const defaultSessionSpawnStore = (): SessionSpawnStore => ({ runs: {} })
const defaultClawraProfile = (): ClawraProfile => ({
  nsfw_enabled: true,
  auto_persona: false,
  voice_backend_default: "elevenlabs",
  selfie_mode_default: "auto",
})
const defaultClawraOnboardingState = (): ClawraOnboardingState => ({
  stage: "idle",
  updated_at: nowIso(),
  history: [],
})
const defaultConnectors = (): ConnectorsStore => ({
  webhook: { enabled: false },
  slack: { enabled: false },
  telegram: { enabled: false },
})
const defaultFeatureFlags = (): MiyaFeatureFlags => ({
  clawra_v2: true,
  browser_core_v2: true,
  sessions_core_v2: true,
})
const defaultKillSwitchState = (): KillSwitchState => ({
  active: false,
  updated_at: nowIso(),
})
const defaultSkillPackStore = (): SkillPackStore => ({
  skills: [
    { id: "miya-core-coding", enabled: true, source: "project", updated_at: nowIso() },
    { id: "miya-desktop-ops", enabled: true, source: "project", updated_at: nowIso() },
    { id: "miya-voice-runtime", enabled: true, source: "project", updated_at: nowIso() },
    { id: "miya-browser-ops", enabled: true, source: "project", updated_at: nowIso() },
  ],
})
const voiceSession = new Map<string, { sessionID: string; audioBytes: number }>()
const browserRuntime = new Map<string, BrowserRuntimeSession>()
const browserSnapshotRefs = new Map<string, { createdAt: number; refs: Record<string, string> }>()
const sessionInteropRuns = new Map<string, SessionInteropRun>()
let chromiumPromise: Promise<any> | undefined
let browserRuntimeSweepTimer: ReturnType<typeof setInterval> | undefined
const JSON_WRITE_QUEUE = new Map<string, Promise<void>>()
const SPAWN_RUN_TTL_MS = 1000 * 60 * 60 * 24
const BROWSER_IDLE_TTL_MS = 1000 * 60 * 15
let secretMigrationPromise: Promise<{ migrated: string[]; profile_updated: boolean }> | undefined

function nowIso() {
  return new Date().toISOString()
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function runtimeFile(dir: string, file: string) {
  return path.join(getMiyaRuntimeDir(dir), file)
}
function gatewayAuthFile(dir: string) {
  return runtimeFile(dir, "gateway-auth.json")
}
function gatewayGlobalStateFile() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim()
    const base = appData && appData.length > 0 ? appData : path.join(os.homedir(), "AppData", "Roaming")
    return path.join(base, "miya", "gateway.json")
  }
  return path.join(os.homedir(), ".config", "miya", "gateway.json")
}
function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase()
  return value === "127.0.0.1" || value === "::1" || value === "localhost"
}
function deriveWsUrl(httpUrl: string): string {
  const parsed = new URL(httpUrl)
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:"
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/ws`
  parsed.search = ""
  parsed.hash = ""
  return parsed.toString()
}
function contentTypeFromFile(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === ".html") return "text/html; charset=utf-8"
  if (ext === ".js") return "application/javascript; charset=utf-8"
  if (ext === ".css") return "text/css; charset=utf-8"
  if (ext === ".json" || ext === ".map") return "application/json; charset=utf-8"
  if (ext === ".svg") return "image/svg+xml"
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".webp") return "image/webp"
  if (ext === ".ico") return "image/x-icon"
  if (ext === ".txt") return "text/plain; charset=utf-8"
  return "application/octet-stream"
}
type GatewayEndpoint = {
  http: string
  ws: string
  token?: string
}
function resolveUiDistRoots(dir: string) {
  const envRoot = String(process.env.MIYA_UI_DIST_ROOT ?? "").trim()
  const roots = [
    envRoot,
    path.join(Global.Path.state, "miya", "ui-dist"),
    path.join(getMiyaRuntimeDir(dir), "ui-dist"),
  ].filter(Boolean)
  return Array.from(new Set(roots))
}
function readGatewayToken(dir: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(gatewayAuthFile(dir), "utf-8")) as { token?: unknown }
    const token = typeof raw.token === "string" ? raw.token.trim() : ""
    return token || undefined
  } catch {
    return undefined
  }
}
function parseGatewayEndpoint(input: unknown): GatewayEndpoint | null {
  if (!isRecord(input)) return null
  const httpRaw = (() => {
    if (typeof input.http === "string") return input.http.trim()
    if (typeof input.url === "string") return input.url.trim()
    return ""
  })()
  if (!httpRaw) return null
  const wsRaw =
    typeof input.ws === "string" && input.ws.trim().length > 0
      ? input.ws.trim()
      : deriveWsUrl(httpRaw)
  try {
    const http = new URL(httpRaw)
    const ws = new URL(wsRaw)
    if (!isLoopbackHost(http.hostname) || !isLoopbackHost(ws.hostname)) return null
    return {
      http: http.toString(),
      ws: ws.toString(),
    }
  } catch {
    return null
  }
}
async function resolveGatewayEndpoint(dir: string): Promise<GatewayEndpoint> {
  const candidates = [
    runtimeFile(dir, "gateway.json"),
    gatewayGlobalStateFile(),
  ]
  let endpoint: GatewayEndpoint | null = null
  for (const file of candidates) {
    const parsed = await readJson<Record<string, unknown> | null>(file, null)
    endpoint = parseGatewayEndpoint(parsed)
    if (endpoint) break
  }
  if (!endpoint) {
    throw new Error("gateway_endpoint_unavailable")
  }
  return {
    ...endpoint,
    token: readGatewayToken(dir),
  }
}
async function serveMiyaUiFile(dir: string, relPath: string): Promise<Response | null> {
  const normalized = path.posix.normalize(relPath)
  if (normalized.startsWith("../") || normalized === ".." || normalized.includes("\0")) return null
  for (const root of resolveUiDistRoots(dir)) {
    const filePath = path.join(root, normalized)
    if (!filePath.startsWith(root)) continue
    if (!existsSync(filePath)) continue
    const file = Bun.file(filePath)
    if (!(await file.exists())) continue
    return new Response(file, {
      status: 200,
      headers: {
        "content-type": contentTypeFromFile(filePath),
        "cache-control": normalized.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      },
    })
  }
  return null
}
async function readJson<T>(file: string, fallback: T): Promise<T> {
  const raw = await Bun.file(file).text().catch(() => "")
  if (!raw.trim()) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
async function enqueueJsonWrite(file: string, writer: () => Promise<void>) {
  const previous = JSON_WRITE_QUEUE.get(file) ?? Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(writer)
    .finally(() => {
      if (JSON_WRITE_QUEUE.get(file) === next) JSON_WRITE_QUEUE.delete(file)
    })
  JSON_WRITE_QUEUE.set(file, next)
  await next
}
async function writeJson(file: string, value: unknown) {
  await enqueueJsonWrite(file, async () => {
    mkdirSync(path.dirname(file), { recursive: true })
    const content = `${JSON.stringify(value, null, 2)}\n`
    const temp = `${file}.tmp-${randomUUID()}`
    await Bun.write(temp, content)
    renameSync(temp, file)
    rmSync(temp, { force: true })
  })
}
function parseModelRef(model?: string) {
  if (!model) return
  const [providerID, modelID] = model.split("/")
  if (!providerID || !modelID) return
  return { providerID, modelID }
}
function extractAssistantText(parts: { type: string; text?: string; output?: string; state?: unknown }[] = []) {
  return extractMessageText(parts)
}
function extractMessageText(
  parts: { type: string; text?: string; output?: string; state?: unknown }[] = [],
  options?: { includeTools?: boolean },
) {
  const includeTools = options?.includeTools !== false
  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim()
  if (text || !includeTools) return text
  return parts
    .filter((part) => part.type === "tool")
    .map((part) => {
      if (typeof part.output === "string") return part.output
      if (isRecord(part.state) && typeof part.state.output === "string") return part.state.output
      return ""
    })
    .filter(Boolean)
    .join("\n")
    .trim()
}
function clipText(value: string, max = 240) {
  const normalized = value.trim()
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized
}
function clawraProfileReady(profile: ClawraProfile) {
  return !!(
    profile.reference_photo?.trim() &&
    profile.voice_sample?.trim() &&
    profile.personality_prompt?.trim()
  )
}
function pushOnboardingHistory(
  state: ClawraOnboardingState,
  step: "photo" | "voice" | "persona",
  value: string,
) {
  state.updated_at = nowIso()
  state.history = [...state.history, {
    step,
    value_preview: clipText(value, 64),
    at: nowIso(),
  }].slice(-20)
}
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<{ status: "ok"; value: T } | { status: "timeout" }> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise.then((value) => ({ status: "ok", value }))
  return Promise.race([
    promise.then((value) => ({ status: "ok" as const, value })),
    new Promise<{ status: "timeout" }>((resolve) => setTimeout(() => resolve({ status: "timeout" }), timeoutMs)),
  ])
}
function safeToolAllowed(tool: string) {
  if (tool.startsWith("miya_")) return true
  return new Set(["save_work", "load_work", "check_work", "quality_gate", "cancel_work", "loop_state", "strict_quality_gate_set", "miya_iteration_done"]).has(tool)
}
async function findMiyaTool(tool: string) {
  const plugins = await Plugin.list()
  for (const plugin of plugins) {
    const match = plugin.tool?.[tool]
    if (match) return match
  }
}
async function invokeMiyaTool(toolName: string, args: Record<string, unknown> = {}) {
  const tool = await findMiyaTool(toolName)
  if (!tool) throw new Error(`tool not found: ${toolName}`)
  const parser = z.object(tool.args)
  return tool.execute(parser.parse(args), {
    sessionID: "miya-control",
    messageID: `miya-${randomUUID()}`,
    agent: "1-task-manager",
    directory: Instance.directory,
    worktree: Instance.worktree,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  })
}
async function ensureLocalVoiceProviderReady(provider: "coqui" | "rvc") {
  const health = await getVoiceProviderHealth()
  if (health[provider].available) return true
  try {
    await invokeMiyaTool("miya_voice_up", { providers: provider })
  } catch {
    return false
  }
  const next = await getVoiceProviderHealth()
  return next[provider].available
}
async function listMiyaTools() {
  const plugins = await Plugin.list()
  const tools: ToolSummary[] = []
  for (const plugin of plugins) {
    if (!plugin.tool) continue
    for (const [name, definition] of Object.entries(plugin.tool)) {
      if (!safeToolAllowed(name)) continue
      tools.push({
        name,
        description: definition.description ?? "",
        args: Object.keys(definition.args ?? {}),
        safe: true,
      })
    }
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name))
}
async function readLoopState(dir: string) {
  const parsed = await readJson<{ sessions?: unknown }>(runtimeFile(dir, "loop-state.json"), { sessions: {} })
  if (!isRecord(parsed.sessions)) return { sessions: {} as Record<string, unknown> }
  return { sessions: parsed.sessions }
}
async function readFeatureFlags(dir: string): Promise<MiyaFeatureFlags> {
  const parsed = await readJson<MiyaFeatureFlags>(runtimeFile(dir, "features.json"), defaultFeatureFlags())
  return { ...defaultFeatureFlags(), ...parsed }
}
async function writeFeatureFlags(dir: string, next: MiyaFeatureFlags) {
  await writeJson(runtimeFile(dir, "features.json"), next)
}
async function readKillSwitchState(dir: string): Promise<KillSwitchState> {
  const parsed = await readJson<KillSwitchState>(runtimeFile(dir, "kill-switch.json"), defaultKillSwitchState())
  return { ...defaultKillSwitchState(), ...parsed }
}
async function writeKillSwitchState(dir: string, next: KillSwitchState) {
  await writeJson(runtimeFile(dir, "kill-switch.json"), next)
}
async function readSelfApprovalStore(dir: string): Promise<SelfApprovalStore> {
  const parsed = await readJson<SelfApprovalStore>(runtimeFile(dir, "self-approval.json"), { records: [] })
  if (!Array.isArray(parsed.records)) return { records: [] }
  return parsed
}
async function writeSelfApprovalStore(dir: string, store: SelfApprovalStore) {
  await writeJson(runtimeFile(dir, "self-approval.json"), store)
}
async function appendSelfApprovalRecord(dir: string, record: SelfApprovalRecord) {
  const store = await readSelfApprovalStore(dir)
  store.records = [record, ...store.records].slice(0, 500)
  await writeSelfApprovalStore(dir, store)
}
async function readSkillPackStore(dir: string): Promise<SkillPackStore> {
  const parsed = await readJson<SkillPackStore>(runtimeFile(dir, "skills.json"), defaultSkillPackStore())
  if (!Array.isArray(parsed.skills)) return defaultSkillPackStore()
  return parsed
}
async function writeSkillPackStore(dir: string, store: SkillPackStore) {
  await writeJson(runtimeFile(dir, "skills.json"), store)
}
async function patchMiyaConfig(dir: string, patch: unknown) {
  const root = path.join(dir, ".opencode")
  mkdirSync(root, { recursive: true })
  const jsonc = path.join(root, "miya.jsonc")
  const json = path.join(root, "miya.json")
  const file = existsSync(jsonc) ? jsonc : json
  const before = await Bun.file(file).text().catch(() => "{}\n")
  const errors: { error: number; offset: number; length: number }[] = []
  parseJsonc(before, errors, { allowTrailingComma: true })
  const safe = errors.length ? "{}\n" : before
  const applyPatch = (input: string, value: unknown, keyPath: string[] = []): string => {
    if (!isRecord(value)) {
      const edits = modify(input, keyPath, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } })
      return applyEdits(input, edits)
    }
    return Object.entries(value).reduce((result, [key, child]) => applyPatch(result, child, [...keyPath, key]), input)
  }
  const next = applyPatch(safe, patch)
  await Bun.write(file, next)
}
async function readGatewayStore(dir: string) {
  const parsed = await readJson<GatewayTurnsStore>(runtimeFile(dir, "gateway/turns.json"), defaultGatewayStore())
  if (!isRecord(parsed.turns)) return defaultGatewayStore()
  return parsed
}
async function writeGatewayStore(dir: string, store: GatewayTurnsStore) {
  await writeJson(runtimeFile(dir, "gateway/turns.json"), store)
}
async function patchGatewayTurn(dir: string, turnID: string, patch: Partial<GatewayTurnState>) {
  const store = await readGatewayStore(dir)
  const turn = store.turns[turnID]
  if (!turn) return
  store.turns[turnID] = { ...turn, ...patch, updated_at: nowIso() }
  await writeGatewayStore(dir, store)
}
async function readSessionSpawnStore(dir: string) {
  const parsed = await readJson<SessionSpawnStore>(
    runtimeFile(dir, "sessions/spawn-runs.json"),
    defaultSessionSpawnStore(),
  )
  if (!isRecord(parsed.runs)) return defaultSessionSpawnStore()
  const now = Date.now()
  let changed = false
  for (const [id, run] of Object.entries(parsed.runs)) {
    const expiresAt = run.expires_at ? Date.parse(run.expires_at) : Date.parse(run.updated_at) + SPAWN_RUN_TTL_MS
    if (Number.isFinite(expiresAt) && expiresAt <= now) {
      delete parsed.runs[id]
      changed = true
    }
  }
  if (changed) await writeJson(runtimeFile(dir, "sessions/spawn-runs.json"), parsed)
  return parsed
}
async function writeSessionSpawnStore(dir: string, store: SessionSpawnStore) {
  await writeJson(runtimeFile(dir, "sessions/spawn-runs.json"), store)
}
async function patchSessionSpawnRun(
  dir: string,
  runID: string,
  patch: Partial<SessionSpawnRun>,
) {
  const store = await readSessionSpawnStore(dir)
  const run = store.runs[runID]
  if (!run) return
  store.runs[runID] = {
    ...run,
    ...patch,
    updated_at: nowIso(),
    expires_at: patch.expires_at ?? run.expires_at ?? new Date(Date.now() + SPAWN_RUN_TTL_MS).toISOString(),
  }
  await writeSessionSpawnStore(dir, store)
}
async function waitForSessionSpawnCompletion(dir: string, runID: string, timeoutMs: number) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const store = await readSessionSpawnStore(dir)
    const run = store.runs[runID]
    if (!run) return null
    if (run.status !== "running") return run
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return null
}
async function readMemoryStore(dir: string) {
  return readJson<Record<string, unknown>>(runtimeFile(dir, "memory.json"), {})
}
async function writeMemoryStore(dir: string, value: Record<string, unknown>) {
  await writeJson(runtimeFile(dir, "memory.json"), value)
}
async function readConnectorsStore(dir: string) {
  const parsed = await readJson<ConnectorsStore>(runtimeFile(dir, "connectors.json"), defaultConnectors())
  return {
    webhook: { ...defaultConnectors().webhook, ...(parsed.webhook ?? {}) },
    slack: { ...defaultConnectors().slack, ...(parsed.slack ?? {}) },
    telegram: { ...defaultConnectors().telegram, ...(parsed.telegram ?? {}) },
  }
}
function sanitizeConnectorConfig(name: "webhook" | "slack" | "telegram", connector: ConnectorConfig) {
  void name
  return {
    enabled: connector.enabled,
    webhook_url: connector.webhook_url,
    slack_channel: connector.slack_channel,
    telegram_chat_id: connector.telegram_chat_id,
    last_test_at: connector.last_test_at,
    last_test_ok: connector.last_test_ok,
    last_test_error: connector.last_test_error,
  }
}
async function sanitizeConnectorsResponse(store: ConnectorsStore) {
  const [webhookConfigured, slackConfigured, telegramConfigured] = await Promise.all([
    SecretStore.has(secretKeyForProvider("webhook")),
    SecretStore.has(secretKeyForProvider("slack")),
    SecretStore.has(secretKeyForProvider("telegram")),
  ])
  return {
    webhook: {
      ...sanitizeConnectorConfig("webhook", store.webhook),
      webhook_secret_configured:
        webhookConfigured || !!(store.webhook.webhook_secret && store.webhook.webhook_secret.trim()),
    },
    slack: {
      ...sanitizeConnectorConfig("slack", store.slack),
      slack_bot_token_configured:
        slackConfigured || !!(store.slack.slack_bot_token && store.slack.slack_bot_token.trim()),
    },
    telegram: {
      ...sanitizeConnectorConfig("telegram", store.telegram),
      telegram_bot_token_configured:
        telegramConfigured || !!(store.telegram.telegram_bot_token && store.telegram.telegram_bot_token.trim()),
    },
  }
}
async function writeConnectorsStore(dir: string, value: ConnectorsStore) {
  await writeJson(runtimeFile(dir, "connectors.json"), value)
}
function secretKeyForProvider(provider: "fal" | "elevenlabs" | "slack" | "telegram" | "webhook") {
  if (provider === "fal") return "miya.fal.api_key"
  if (provider === "elevenlabs") return "miya.elevenlabs.api_key"
  if (provider === "slack") return "miya.slack.bot_token"
  if (provider === "telegram") return "miya.telegram.bot_token"
  return "miya.webhook.secret"
}
async function readSecretStatus() {
  const providers = ["fal", "elevenlabs", "slack", "telegram", "webhook"] as const
  const entries = await Promise.all(
    providers.map(async (provider) => [provider, await SecretStore.has(secretKeyForProvider(provider))] as const),
  )
  return {
    backend: SecretStore.backend(),
    providers: Object.fromEntries(entries) as Record<(typeof providers)[number], boolean>,
  }
}
async function ensureLegacySecretsMigrated(dir: string) {
  if (!secretMigrationPromise) {
    secretMigrationPromise = migrateLegacySecrets(dir).catch(() => ({ migrated: [], profile_updated: false }))
  }
  return secretMigrationPromise
}
function clawraOnboardingStateFile(dir: string) {
  return runtimeFile(dir, "clawra/onboarding.json")
}
async function readClawraOnboardingState(dir: string): Promise<ClawraOnboardingState> {
  const parsed = await readJson<ClawraOnboardingState>(clawraOnboardingStateFile(dir), defaultClawraOnboardingState())
  if (!Array.isArray(parsed.history)) parsed.history = []
  return {
    ...defaultClawraOnboardingState(),
    ...parsed,
    updated_at: parsed.updated_at || nowIso(),
  }
}
async function writeClawraOnboardingState(dir: string, state: ClawraOnboardingState) {
  await writeJson(clawraOnboardingStateFile(dir), state)
}
async function migrateLegacySecrets(dir: string) {
  const migrated: string[] = []
  const legacyProfile = await readJson<Record<string, unknown>>(clawraProfileFile(dir), {})
  if (typeof legacyProfile.fal_key === "string" && legacyProfile.fal_key.trim()) {
    await SecretStore.set(secretKeyForProvider("fal"), legacyProfile.fal_key.trim())
    migrated.push("fal")
  }
  if (typeof legacyProfile.elevenlabs_api_key === "string" && legacyProfile.elevenlabs_api_key.trim()) {
    await SecretStore.set(secretKeyForProvider("elevenlabs"), legacyProfile.elevenlabs_api_key.trim())
    migrated.push("elevenlabs")
  }
  const cleanedProfile = { ...legacyProfile }
  delete cleanedProfile.fal_key
  delete cleanedProfile.elevenlabs_api_key
  await writeJson(clawraProfileFile(dir), {
    ...defaultClawraProfile(),
    ...cleanedProfile,
  })

  const connectors = await readConnectorsStore(dir)
  let changed = false
  if (typeof connectors.webhook.webhook_secret === "string" && connectors.webhook.webhook_secret.trim()) {
    await SecretStore.set(secretKeyForProvider("webhook"), connectors.webhook.webhook_secret.trim())
    delete connectors.webhook.webhook_secret
    migrated.push("webhook")
    changed = true
  }
  if (typeof connectors.slack.slack_bot_token === "string" && connectors.slack.slack_bot_token.trim()) {
    await SecretStore.set(secretKeyForProvider("slack"), connectors.slack.slack_bot_token.trim())
    delete connectors.slack.slack_bot_token
    migrated.push("slack")
    changed = true
  }
  if (typeof connectors.telegram.telegram_bot_token === "string" && connectors.telegram.telegram_bot_token.trim()) {
    await SecretStore.set(secretKeyForProvider("telegram"), connectors.telegram.telegram_bot_token.trim())
    delete connectors.telegram.telegram_bot_token
    migrated.push("telegram")
    changed = true
  }
  if (changed) await writeConnectorsStore(dir, connectors)
  return {
    migrated: [...new Set(migrated)],
    profile_updated: migrated.includes("fal") || migrated.includes("elevenlabs"),
  }
}
async function testConnector(name: "webhook" | "slack" | "telegram", connector: ConnectorConfig, message: string) {
  if (!connector.enabled) return { ok: false, error: "connector disabled" }

  if (name === "webhook") {
    if (!connector.webhook_url) return { ok: false, error: "missing webhook_url" }
    const webhookSecret =
      connector.webhook_secret?.trim() || (await SecretStore.get(secretKeyForProvider("webhook")))
    const response = await fetch(connector.webhook_url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(webhookSecret ? { "x-miya-secret": webhookSecret } : {}),
      },
      body: JSON.stringify({ source: "miya", message }),
    })
    if (!response.ok) return { ok: false, error: `webhook status ${response.status}` }
    return { ok: true }
  }

  if (name === "slack") {
    const token = connector.slack_bot_token?.trim() || (await SecretStore.get(secretKeyForProvider("slack")))
    if (!token || !connector.slack_channel) {
      return { ok: false, error: "missing slack token or slack_channel" }
    }
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ channel: connector.slack_channel, text: message }),
    })
    if (!response.ok) return { ok: false, error: `slack status ${response.status}` }
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (payload.ok !== true) return { ok: false, error: `slack error ${payload.error ?? "unknown"}` }
    return { ok: true }
  }

  const telegramToken =
    connector.telegram_bot_token?.trim() || (await SecretStore.get(secretKeyForProvider("telegram")))
  if (!telegramToken || !connector.telegram_chat_id) {
    return { ok: false, error: "missing telegram token or telegram_chat_id" }
  }
  const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: connector.telegram_chat_id, text: message }),
  })
  if (!response.ok) return { ok: false, error: `telegram status ${response.status}` }
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string }
  if (payload.ok !== true) return { ok: false, error: `telegram error ${payload.description ?? "unknown"}` }
  return { ok: true }
}
async function readProviderSecret(provider: "fal" | "elevenlabs" | "slack" | "telegram" | "webhook", envName?: string) {
  const secret = await SecretStore.get(secretKeyForProvider(provider))
  if (secret?.trim()) return secret.trim()
  const envValue = envName ? process.env[envName] : undefined
  return envValue?.trim() || undefined
}
function resolveSelfieMode(
  requested: "mirror" | "direct" | "auto" | undefined,
  profile: ClawraProfile,
  userContext?: string,
): "mirror" | "direct" {
  const mode = requested ?? profile.selfie_mode_default
  if (mode === "mirror" || mode === "direct") return mode
  const hint = `${userContext ?? ""} ${profile.personality_prompt ?? ""}`.toLowerCase()
  if (/(mirror|phone|selfie|front camera|bathroom)/.test(hint)) return "mirror"
  return "direct"
}
function buildSelfiePrompt(basePrompt: string, mode: "mirror" | "direct", profile: ClawraProfile, userContext?: string) {
  const modePrompt =
    mode === "mirror"
      ? "Mirror selfie framing, realistic phone-camera perspective, natural hand-held composition."
      : "Direct portrait framing, eye-level camera, clean focus and natural lighting."
  const personaPrompt = profile.personality_prompt?.trim()
  const persona = profile.auto_persona && personaPrompt ? `Persona style: ${personaPrompt}` : ""
  const context = userContext?.trim() ? `User context: ${userContext.trim()}` : ""
  return [modePrompt, context, basePrompt.trim(), persona].filter(Boolean).join("\n\n")
}
async function fetchAudioBytesFromUrl(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`audio download failed (${response.status})`)
  return Buffer.from(await response.arrayBuffer())
}
function resolveLocalProviderBase(provider: "coqui" | "rvc") {
  if (provider === "coqui") return process.env.MIYA_COQUI_ENDPOINT?.trim() || "http://127.0.0.1:5002"
  return process.env.MIYA_RVC_ENDPOINT?.trim() || "http://127.0.0.1:5003"
}
async function speakWithLocalProvider(
  provider: "coqui" | "rvc",
  text: string,
  voiceID?: string,
  modelID?: string,
) {
  const base = resolveLocalProviderBase(provider).replace(/\/+$/, "")
  const response = await fetch(`${base}/v1/speak`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      voice_id: voiceID,
      model_id: modelID,
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`${provider} speak failed (${response.status}) ${detail}`.trim())
  }
  const payload = (await response.json().catch(() => ({}))) as {
    audio_base64?: string
    audio_url?: string
    voice_id?: string
  }
  if (payload.audio_base64?.trim()) {
    return {
      provider,
      voice_id: payload.voice_id ?? voiceID ?? provider,
      audio_base64: payload.audio_base64,
    }
  }
  if (payload.audio_url?.trim()) {
    const bytes = await fetchAudioBytesFromUrl(payload.audio_url.trim())
    return {
      provider,
      voice_id: payload.voice_id ?? voiceID ?? provider,
      audio_base64: bytes.toString("base64"),
    }
  }
  throw new Error(`${provider} speak returned no audio payload`)
}
async function speakWithElevenLabs(text: string, voiceID: string, modelID: string) {
  const apiKey = await readProviderSecret("elevenlabs", "ELEVENLABS_API_KEY")
  if (!apiKey) throw new Error("missing ElevenLabs key")
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceID)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "xi-api-key": apiKey,
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelID,
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`elevenlabs failed (${response.status}) ${detail}`.trim())
  }
  const audioBuffer = Buffer.from(await response.arrayBuffer())
  return {
    provider: "elevenlabs" as const,
    voice_id: voiceID,
    audio_base64: audioBuffer.toString("base64"),
  }
}
async function cloneVoiceWithProvider(
  provider: "elevenlabs" | "coqui" | "rvc",
  sampleUrl: string,
  voiceName: string,
) {
  if (provider === "elevenlabs") {
    const apiKey = await readProviderSecret("elevenlabs", "ELEVENLABS_API_KEY")
    if (!apiKey) throw new Error("missing ElevenLabs key")
    const bytes = await fetchAudioBytesFromUrl(sampleUrl)
    const form = new FormData()
    form.set("name", voiceName)
    form.append("files", new Blob([bytes], { type: "audio/mpeg" }), "sample.mp3")
    const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      throw new Error(`elevenlabs clone failed (${response.status}) ${detail}`.trim())
    }
    const payload = (await response.json().catch(() => ({}))) as { voice_id?: string }
    return { provider, voice_id: payload.voice_id ?? "" }
  }
  const base = resolveLocalProviderBase(provider).replace(/\/+$/, "")
  const response = await fetch(`${base}/v1/clone`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sample_url: sampleUrl, voice_name: voiceName }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`${provider} clone failed (${response.status}) ${detail}`.trim())
  }
  const payload = (await response.json().catch(() => ({}))) as { voice_id?: string }
  return { provider, voice_id: payload.voice_id ?? "" }
}
async function probeHttpHealth(url: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
async function getVoiceProviderHealth() {
  const elevenlabs = await SecretStore.has(secretKeyForProvider("elevenlabs")) || !!process.env.ELEVENLABS_API_KEY?.trim()
  const coquiBase = resolveLocalProviderBase("coqui").replace(/\/+$/, "")
  const rvcBase = resolveLocalProviderBase("rvc").replace(/\/+$/, "")
  const [coqui, rvc] = await Promise.all([probeHttpHealth(`${coquiBase}/health`), probeHttpHealth(`${rvcBase}/health`)])
  return {
    elevenlabs: { available: elevenlabs },
    coqui: { available: coqui, endpoint: coquiBase },
    rvc: { available: rvc, endpoint: rvcBase },
  }
}
async function readBrowserStore(dir: string) {
  const parsed = await readJson<BrowserStore>(runtimeFile(dir, "browser/state.json"), defaultBrowserStore())
  if (!isRecord(parsed.sessions)) return defaultBrowserStore()
  return parsed
}
async function writeBrowserStore(dir: string, value: BrowserStore) {
  await writeJson(runtimeFile(dir, "browser/state.json"), value)
}
async function resolveChromium() {
  if (!chromiumPromise) {
    chromiumPromise = (async () => {
      const candidates = ["playwright", "@playwright/test"] as const
      for (const pkg of candidates) {
        try {
          const moduleName = pkg as string
          const mod = (await import(moduleName)) as Record<string, unknown>
          const chromium =
            (mod.chromium as unknown) ??
            ((mod.playwright as { chromium?: unknown } | undefined)?.chromium as unknown)
          if (chromium) return chromium
        } catch {
          continue
        }
      }
      throw new Error(
        "Playwright runtime not found. Install with `npm install -w opencode @playwright/test`.",
      )
    })()
  }
  return chromiumPromise
}
async function getOrCreateBrowserSession(dir: string, sessionID: string) {
  const store = await readBrowserStore(dir)
  const session = store.sessions[sessionID]
  if (!session) return null
  if (typeof session.event_seq !== "number" || !Number.isFinite(session.event_seq)) {
    session.event_seq = session.events.length
  }
  return { store, session }
}
async function recordBrowserEvent(
  dir: string,
  sessionID: string,
  type: string,
  data?: Record<string, unknown>,
) {
  const found = await getOrCreateBrowserSession(dir, sessionID)
  if (!found) return
  found.session.event_seq = (found.session.event_seq ?? 0) + 1
  found.session.updated_at = nowIso()
  found.session.events.push({
    id: randomUUID(),
    seq: found.session.event_seq,
    type,
    created_at: nowIso(),
    data,
  })
  if (found.session.events.length > 200) {
    found.session.events = found.session.events.slice(found.session.events.length - 200)
  }
  await writeBrowserStore(dir, found.store)
}
async function syncBrowserSessionMeta(dir: string, sessionID: string) {
  const found = await getOrCreateBrowserSession(dir, sessionID)
  if (!found) return null
  const runtime = browserRuntime.get(sessionID)
  if (!runtime) {
    found.session.live = false
    await writeBrowserStore(dir, found.store)
    return found.session
  }
  found.session.url = runtime.page.url()
  found.session.title = await runtime.page.title().catch(() => found.session.title)
  found.session.live = true
  found.session.updated_at = nowIso()
  runtime.lastActiveAt = Date.now()
  await writeBrowserStore(dir, found.store)
  return found.session
}
function startBrowserRuntimeSweep() {
  if (browserRuntimeSweepTimer) return
  browserRuntimeSweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [sessionID, runtime] of browserRuntime.entries()) {
      if (now - runtime.lastActiveAt < BROWSER_IDLE_TTL_MS) continue
      void closeBrowserRuntime(sessionID)
    }
  }, 60_000)
}
function browserTabList(runtime: BrowserRuntimeSession) {
  return runtime.context.pages().map((page: any, index: number) => ({
    tab_id: `tab-${index}`,
    index,
    url: page.url(),
    title: "",
    active: page === runtime.page,
  }))
}
async function browserTabListWithTitle(runtime: BrowserRuntimeSession) {
  const tabs = browserTabList(runtime)
  for (const tab of tabs) {
    const page = runtime.context.pages()[tab.index]
    tab.title = await page.title().catch(() => "")
  }
  return tabs
}
async function resolveBrowserTab(
  runtime: BrowserRuntimeSession,
  input: { tab_id?: string; index?: number; url?: string },
) {
  const pages = runtime.context.pages()
  if (typeof input.index === "number" && pages[input.index]) return pages[input.index]
  if (input.tab_id?.startsWith("tab-")) {
    const idx = Number(input.tab_id.slice(4))
    if (Number.isFinite(idx) && pages[idx]) return pages[idx]
  }
  if (input.url?.trim()) {
    const needle = input.url.trim()
    return pages.find((page: any) => page.url() === needle || page.url().includes(needle))
  }
  return runtime.page
}
function attachBrowserPageListeners(dir: string, sessionID: string, page: any) {
  const marker = "__miya_event_bound__"
  if (page?.[marker]) return
  page[marker] = true
  page.on("console", (msg: { type(): string; text(): string }) => {
    void recordBrowserEvent(dir, sessionID, "console", { level: msg.type(), text: msg.text() })
  })
  page.on("pageerror", (error: Error) => {
    void recordBrowserEvent(dir, sessionID, "pageerror", { message: error.message })
  })
  page.on("framenavigated", (frame: { parentFrame(): unknown; url(): string }) => {
    if (frame.parentFrame()) return
    void recordBrowserEvent(dir, sessionID, "navigated", { url: frame.url() })
    void syncBrowserSessionMeta(dir, sessionID)
  })
}
async function launchBrowserRuntime(dir: string, sessionID: string, startUrl?: string) {
  startBrowserRuntimeSweep()
  const chromium = await resolveChromium()
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent: "MiyaBrowser/1.0 (+opencode)",
  })
  context.on("page", (page: any) => {
    attachBrowserPageListeners(dir, sessionID, page)
  })
  const page = await context.newPage()
  attachBrowserPageListeners(dir, sessionID, page)
  if (startUrl) {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45_000 })
  }
  browserRuntime.set(sessionID, { browser, context, page, lastActiveAt: Date.now() })
  await syncBrowserSessionMeta(dir, sessionID)
  return browserRuntime.get(sessionID)!
}
async function ensureBrowserRuntime(dir: string, sessionID: string) {
  const existing = browserRuntime.get(sessionID)
  if (existing) return existing
  const found = await getOrCreateBrowserSession(dir, sessionID)
  if (!found) return null
  try {
    return await launchBrowserRuntime(dir, sessionID, found.session.url)
  } catch (error) {
    if (found.session.url) {
      await recordBrowserEvent(dir, sessionID, "runtime:recover", {
        message: error instanceof Error ? error.message : String(error),
      })
    }
    return launchBrowserRuntime(dir, sessionID)
  }
}
async function closeBrowserRuntime(sessionID: string) {
  const runtime = browserRuntime.get(sessionID)
  if (!runtime) return
  browserRuntime.delete(sessionID)
  browserSnapshotRefs.delete(sessionID)
  await runtime.page.close().catch(() => {})
  await runtime.context.close().catch(() => {})
  await runtime.browser.close().catch(() => {})
}
function toNumberOrDefault(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
async function executeBrowserAction(
  dir: string,
  sessionID: string,
  input: z.infer<typeof BrowserActionInput>,
) {
  const runtime = await ensureBrowserRuntime(dir, sessionID)
  if (!runtime) throw new Error("browser session not found")
  runtime.lastActiveAt = Date.now()
  const action = input.action.trim().toLowerCase()
  const page = runtime.page
  const metadata = isRecord(input.metadata) ? input.metadata : {}
  const resolvedTarget = (() => {
    if (!input.target?.startsWith("ref:")) return input.target
    const refID = input.target.slice(4)
    const refs = browserSnapshotRefs.get(sessionID)?.refs ?? {}
    return refs[refID] || input.target
  })()
  const result: Record<string, unknown> = {}

  if (action === "click") {
    if (!resolvedTarget) throw new Error("target selector required for click")
    await page.click(resolvedTarget, { timeout: toNumberOrDefault(metadata.timeout, 15_000) })
  } else if (action === "type") {
    if (!resolvedTarget) throw new Error("target selector required for type")
    const value = input.value ?? ""
    if (metadata.append === true) {
      await page.type(resolvedTarget, value, { timeout: toNumberOrDefault(metadata.timeout, 15_000) })
    } else {
      await page.fill(resolvedTarget, value, { timeout: toNumberOrDefault(metadata.timeout, 15_000) })
    }
  } else if (action === "scroll") {
    const delta = toNumberOrDefault(input.value ?? metadata.delta ?? metadata.deltaY, 600)
    if (resolvedTarget) {
      await page.evaluate(
        (payload: { selector: string; delta: number }) => {
          const globalRef = globalThis as Record<string, unknown>
          const doc = globalRef.document as { querySelector?: (q: string) => unknown } | undefined
          const element = doc?.querySelector?.(payload.selector) as { scrollBy?: (opts: unknown) => void } | undefined
          if (typeof element?.scrollBy === "function") {
            element.scrollBy({ top: payload.delta, behavior: "smooth" })
          }
        },
        { selector: resolvedTarget, delta },
      )
    } else {
      await page.mouse.wheel(0, delta)
    }
    result.delta = delta
  } else if (action === "wait") {
    const ms = Math.max(0, toNumberOrDefault(input.value ?? metadata.ms, 1000))
    await page.waitForTimeout(ms)
    result.waited_ms = ms
  } else if (action === "press") {
    const key = String(input.value ?? metadata.key ?? "Enter")
    await page.keyboard.press(key)
    result.key = key
  } else if (action === "hover") {
    if (!resolvedTarget) throw new Error("target selector required for hover")
    await page.hover(resolvedTarget, { timeout: toNumberOrDefault(metadata.timeout, 15_000) })
  } else if (action === "scrollintoview") {
    if (!resolvedTarget) throw new Error("target selector required for scrollintoview")
    await page.locator(resolvedTarget).first().scrollIntoViewIfNeeded({
      timeout: toNumberOrDefault(metadata.timeout, 15_000),
    })
  } else if (action === "check") {
    if (!resolvedTarget) throw new Error("target selector required for check")
    await page.check(resolvedTarget, { timeout: toNumberOrDefault(metadata.timeout, 15_000) })
  } else if (action === "uncheck") {
    if (!resolvedTarget) throw new Error("target selector required for uncheck")
    await page.uncheck(resolvedTarget, { timeout: toNumberOrDefault(metadata.timeout, 15_000) })
  } else if (action === "select") {
    if (!resolvedTarget) throw new Error("target selector required for select")
    const raw = input.value ?? ""
    const values = raw.split(",").map((x) => x.trim()).filter(Boolean)
    if (values.length === 0) throw new Error("value required for select")
    result.selected = await page.selectOption(resolvedTarget, values)
  } else if (action === "extract") {
    const selector = resolvedTarget ?? "body"
    const text = await page.textContent(selector)
    result.selector = selector
    result.text = text ?? ""
  } else if (action === "html") {
    result.html = await page.content()
  } else if (action === "screenshot") {
    const screenshotDir = runtimeFile(dir, "browser/screenshots")
    mkdirSync(screenshotDir, { recursive: true })
    const filePath = path.join(screenshotDir, `${sessionID}-${Date.now()}.png`)
    await page.screenshot({
      path: filePath,
      fullPage: metadata.fullPage !== false,
    })
    result.screenshot_path = filePath
  } else {
    throw new Error(`unsupported browser action: ${action}`)
  }

  await recordBrowserEvent(dir, sessionID, `action:${action}`, {
    target: resolvedTarget,
    value: input.value,
    ...metadata,
    ...result,
  })
  await syncBrowserSessionMeta(dir, sessionID)
  return result
}
function clawraProfileFile(dir: string) {
  return runtimeFile(dir, "clawra/profile.json")
}
async function readClawraProfile(dir: string): Promise<ClawraProfile> {
  const parsed = await readJson<ClawraProfile>(clawraProfileFile(dir), defaultClawraProfile())
  return { ...defaultClawraProfile(), ...parsed }
}
async function writeClawraProfile(dir: string, profile: ClawraProfile) {
  await writeJson(clawraProfileFile(dir), profile)
}
function applyPersonaText(text: string, profile: ClawraProfile) {
  if (!profile.auto_persona) return text
  const persona = profile.personality_prompt?.trim()
  if (!persona) return text
  return [
    "[CLAWRA PERSONA MODE]",
    persona,
    "",
    "User request:",
    text,
  ].join("\n")
}
async function buildSessionRouteContext(sessionID: string, limit: number) {
  const messages = await Session.messages({ sessionID, limit: Math.max(1, limit) })
  const lines = messages
    .map((message) => {
      const info = message.info as { role: string }
      const text = extractMessageText(
        message.parts as { type: string; text?: string; output?: string; state?: unknown }[],
      )
      if (!text) return ""
      return `[${info.role}] ${text}`
    })
    .filter(Boolean)
  if (lines.length === 0) return ""
  return ["<session_context>", ...lines, "</session_context>"].join("\n")
}

export const MiyaRoutes = lazy(() =>
  new Hono()
    .get("/", async () => {
      const response = await serveMiyaUiFile(Instance.directory, "index.html")
      if (response) return response
      return new Response("Miya UI assets not found. Build and place files under ~/.opencode/state/miya/ui-dist", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    })
    .get("/assets/*", async (c) => {
      const rel = String(c.req.param("*") ?? "").trim()
      const response = await serveMiyaUiFile(Instance.directory, `assets/${rel}`)
      if (response) return response
      return c.json({ error: "asset_not_found" }, 404)
    })
    .all("/api/*", async (c) => {
      let endpoint: GatewayEndpoint
      try {
        endpoint = await resolveGatewayEndpoint(Instance.directory)
      } catch (error) {
        return c.json(
          {
            error: "gateway_unavailable",
            detail: error instanceof Error ? error.message : String(error),
          },
          503,
        )
      }
      const suffix = String(c.req.param("*") ?? "").replace(/^\/+/, "")
      const upstream = new URL(endpoint.http)
      upstream.pathname = `${upstream.pathname.replace(/\/+$/, "")}/${suffix}`.replace(/\/{2,}/g, "/")
      upstream.search = new URL(c.req.url).search

      const headers = new Headers(c.req.raw.headers)
      headers.delete("host")
      if (endpoint.token) {
        headers.set("x-miya-token", endpoint.token)
        headers.set("authorization", `Bearer ${endpoint.token}`)
      }

      const init: RequestInit = {
        method: c.req.method,
        headers,
        redirect: "manual",
      }
      if (!["GET", "HEAD"].includes(c.req.method.toUpperCase())) {
        init.body = await c.req.raw.arrayBuffer()
      }

      try {
        const response = await fetch(upstream.toString(), init)
        return new Response(response.body, {
          status: response.status,
          headers: response.headers,
        })
      } catch (error) {
        return c.json(
          {
            error: "gateway_proxy_failed",
            detail: error instanceof Error ? error.message : String(error),
            upstream: upstream.toString(),
          },
          502,
        )
      }
    })
    .get("/ws", upgradeWebSocket(() => {
      let upstream: WebSocket | null = null
      let gatewayToken = ""
      const pendingClientFrames: string[] = []

      const patchHelloFrame = (raw: string): string => {
        let parsed: Record<string, unknown> | null = null
        try {
          const candidate = JSON.parse(raw) as unknown
          if (isRecord(candidate)) parsed = candidate
        } catch {
          return raw
        }
        if (!parsed || parsed.type !== "hello") return raw
        const currentAuth = isRecord(parsed.auth) ? parsed.auth : {}
        return JSON.stringify({
          ...parsed,
          protocolVersion: typeof parsed.protocolVersion === "string" ? parsed.protocolVersion : "1.1",
          auth: {
            ...currentAuth,
            ...(gatewayToken ? { token: gatewayToken } : {}),
          },
        })
      }

      const flushPending = () => {
        if (!upstream || upstream.readyState !== WebSocket.OPEN) return
        while (pendingClientFrames.length > 0) {
          const raw = pendingClientFrames.shift()
          if (!raw) continue
          upstream.send(patchHelloFrame(raw))
        }
      }

      return {
        async onOpen(_event, ws) {
          let endpoint: GatewayEndpoint
          try {
            endpoint = await resolveGatewayEndpoint(Instance.directory)
          } catch {
            ws.close(1011, "gateway_unavailable")
            return
          }
          gatewayToken = endpoint.token ?? ""
          upstream = new WebSocket(endpoint.ws)
          upstream.onopen = () => flushPending()
          upstream.onmessage = (event) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(typeof event.data === "string" ? event.data : String(event.data))
            }
          }
          upstream.onerror = () => {
            if (ws.readyState === WebSocket.OPEN) ws.close(1011, "gateway_ws_error")
          }
          upstream.onclose = (event) => {
            if (ws.readyState === WebSocket.OPEN) ws.close(event.code || 1011, event.reason || "gateway_closed")
          }
        },
        onMessage(event) {
          const raw = String(event.data ?? "")
          if (!raw) return
          if (!upstream || upstream.readyState !== WebSocket.OPEN) {
            pendingClientFrames.push(raw)
            return
          }
          upstream.send(patchHelloFrame(raw))
        },
        onClose() {
          if (upstream && upstream.readyState < WebSocket.CLOSING) {
            upstream.close(1000, "client_closed")
          }
          upstream = null
        },
      }
    }))
    .use("*", async (_c, next) => {
      await ensureLegacySecretsMigrated(Instance.directory)
      await next()
    })
    .use("*", async (c, next) => {
      const method = c.req.method.toUpperCase()
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
        await next()
        return
      }
      const pathname = new URL(c.req.url).pathname
      const started = Date.now()
      const action = `${method} ${pathname}`
      const kill = await readKillSwitchState(Instance.directory)
      const releasePath = pathname.endsWith("/kill-switch/release")
      if (kill.active && !releasePath) {
        await appendSelfApprovalRecord(Instance.directory, {
          id: randomUUID(),
          action,
          executor: {
            agent: "executor",
            plan: "execute side-effect request",
            expected: "mutation completed without violating kill switch state",
          },
          verifier: {
            agent: "architect-verifier",
            verdict: "deny",
            checks: ["kill_switch_active == false", "safety interlock"],
            evidence: [`kill_switch_active=true`, `reason=${kill.reason ?? "manual-stop"}`],
          },
          rollback: {
            strategy: "no-op (request blocked before execution)",
          },
          status: "blocked",
          created_at: nowIso(),
          duration_ms: Date.now() - started,
          error: "MIYA_KILL_SWITCH_ACTIVE",
        })
        return c.json({ error: "MIYA_KILL_SWITCH_ACTIVE", reason: kill.reason ?? "manual-stop" }, 423)
      }
      try {
        await next()
        await appendSelfApprovalRecord(Instance.directory, {
          id: randomUUID(),
          action,
          executor: {
            agent: "executor",
            plan: "execute side-effect request",
            expected: "successful mutation with verifiable response",
          },
          verifier: {
            agent: "architect-verifier",
            verdict: c.res.status < 400 ? "allow" : "deny",
            checks: ["input validation", "response status", "runtime interlocks"],
            evidence: [`http_status=${c.res.status}`, `path=${pathname}`],
          },
          rollback: {
            strategy: "revert via git checkpoint or runtime state restore",
          },
          status: c.res.status < 400 ? "executed" : "failed",
          created_at: nowIso(),
          duration_ms: Date.now() - started,
          ...(c.res.status < 400 ? {} : { error: `HTTP_${c.res.status}` }),
        })
      } catch (error) {
        await appendSelfApprovalRecord(Instance.directory, {
          id: randomUUID(),
          action,
          executor: {
            agent: "executor",
            plan: "execute side-effect request",
            expected: "successful mutation with verifiable response",
          },
          verifier: {
            agent: "architect-verifier",
            verdict: "deny",
            checks: ["runtime execution", "exception check"],
            evidence: [error instanceof Error ? error.message : String(error)],
          },
          rollback: {
            strategy: "revert via git checkpoint or runtime state restore",
          },
          status: "failed",
          created_at: nowIso(),
          duration_ms: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    })
    .get("/status", async (c) => {
      const svc = new MiyaAutomationService(Instance.directory)
      const jobs = svc.listJobs()
      const loop = await readLoopState(Instance.directory)
      const features = await readFeatureFlags(Instance.directory)
      const kill = await readKillSwitchState(Instance.directory)
      const approvals = await readSelfApprovalStore(Instance.directory)
      const paused = Object.values(loop.sessions).filter((s) => isRecord(s) && s.awaitingConfirmation === true).length
      const connectors = await readConnectorsStore(Instance.directory)
      return c.json({
        autopilot_mode: "full",
        loop_cycle_limit: 3,
        jobs_total: jobs.length,
        jobs_enabled: jobs.filter((j) => j.enabled).length,
        approvals_pending: 0,
        self_approval_records: approvals.records.length,
        loop_paused_sessions: paused,
        connectors_enabled: Object.values(connectors).filter((x) => x.enabled).length,
        kill_switch_active: kill.active,
        features,
      })
    })
    .get("/features", async (c) => c.json(await readFeatureFlags(Instance.directory)))
    .patch("/features", validator("json", FeatureFlagsPatchInput), async (c) => {
      const body = c.req.valid("json")
      const current = await readFeatureFlags(Instance.directory)
      const next: MiyaFeatureFlags = {
        ...current,
        ...body,
      }
      await writeFeatureFlags(Instance.directory, next)
      return c.json(next)
    })
    .get("/self-approval", validator("query", SelfApprovalQueryInput), async (c) => {
      const { limit } = c.req.valid("query")
      const store = await readSelfApprovalStore(Instance.directory)
      return c.json(store.records.slice(0, limit ?? 120))
    })
    .post("/self-approval/clear", async (c) => {
      await writeSelfApprovalStore(Instance.directory, { records: [] })
      return c.json({ cleared: true })
    })
    .get("/runtime", async (c) => {
      const kill = await readKillSwitchState(Instance.directory)
      const connectors = await readConnectorsStore(Instance.directory)
      const browser = await readBrowserStore(Instance.directory)
      const runtime = {
        gateway: {
          transport: "http+sse+websocket",
          same_port_control_plane: true,
          active_turns: Object.keys((await readGatewayStore(Instance.directory)).turns).length,
        },
        nodes: {
          voice: {
            connected: voiceSession.size > 0,
            connection_count: voiceSession.size,
          },
          browser: {
            connected: browserRuntime.size > 0,
            live_sessions: browserRuntime.size,
            known_sessions: Object.keys(browser.sessions).length,
          },
          desktop: {
            connected: true,
            accessibility: process.platform === "darwin" ? "unknown" : "n/a",
            screen_recording: process.platform === "darwin" ? "unknown" : "n/a",
          },
        },
        connectors,
        kill_switch: kill,
      }
      return c.json(runtime)
    })
    .get("/skills", async (c) => {
      const store = await readSkillPackStore(Instance.directory)
      return c.json(store.skills)
    })
    .patch("/skills/:id", validator("param", z.object({ id: z.string() })), validator("json", SkillPatchInput), async (c) => {
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")
      const store = await readSkillPackStore(Instance.directory)
      const found = store.skills.find((item) => item.id === id)
      if (found) {
        found.enabled = typeof body.enabled === "boolean" ? body.enabled : found.enabled
        found.locked_version = body.locked_version?.trim() ? body.locked_version.trim() : found.locked_version
        found.updated_at = nowIso()
      } else {
        store.skills.push({
          id,
          enabled: body.enabled ?? true,
          locked_version: body.locked_version?.trim() || undefined,
          source: "project",
          updated_at: nowIso(),
        })
      }
      await writeSkillPackStore(Instance.directory, store)
      return c.json(store.skills.find((item) => item.id === id))
    })
    .get("/kill-switch", async (c) => c.json(await readKillSwitchState(Instance.directory)))
    .post("/kill-switch/activate", validator("json", KillSwitchActivateInput.optional()), async (c) => {
      const body = c.req.valid("json") ?? {}
      const next: KillSwitchState = {
        active: true,
        reason: body.reason?.trim() || "manual-stop",
        activated_at: nowIso(),
        released_at: undefined,
        updated_at: nowIso(),
      }
      for (const [id, state] of voiceSession.entries()) {
        if (state.sessionID) SessionPrompt.cancel(state.sessionID)
        voiceSession.delete(id)
      }
      for (const sessionID of Array.from(browserRuntime.keys())) {
        await closeBrowserRuntime(sessionID)
      }
      await writeKillSwitchState(Instance.directory, next)
      return c.json(next)
    })
    .post("/kill-switch/release", async (c) => {
      const current = await readKillSwitchState(Instance.directory)
      const next: KillSwitchState = {
        ...current,
        active: false,
        released_at: nowIso(),
        updated_at: nowIso(),
      }
      await writeKillSwitchState(Instance.directory, next)
      return c.json(next)
    })
    .get("/agents", async (c) => c.json(await Agent.list()))
    .patch("/agents/:name", validator("param", z.object({ name: z.string() })), validator("json", z.object({ model: ModelRef.optional(), temperature: z.number().min(0).max(2).optional(), variant: z.string().optional() })), async (c) => {
      const { name } = c.req.valid("param")
      const body = c.req.valid("json")
      await patchMiyaConfig(Instance.directory, { agents: { [name]: { ...(body.model ? { model: body.model } : {}), ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}), ...(body.variant ? { variant: body.variant } : {}) } } })
      await Instance.dispose()
      return c.json(true)
    })
    .get("/sessions", validator("query", SessionListQueryInput), async (c) => {
      const query = c.req.valid("query")
      const search = query.search?.trim().toLowerCase()
      const status = SessionStatus.list()
      const sessions: MiyaSessionSummary[] = []

      for await (const session of Session.list()) {
        if (!query.include_archived && session.time.archived) continue
        if (search && !session.title.toLowerCase().includes(search)) continue

        sessions.push({
          id: session.id,
          title: session.title,
          parent_id: session.parentID,
          archived: !!session.time.archived,
          created_at: new Date(session.time.created).toISOString(),
          updated_at: new Date(session.time.updated).toISOString(),
          status: status[session.id] ?? { type: "idle" },
        })
      }

      sessions.sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at))
      return c.json(typeof query.limit === "number" ? sessions.slice(0, query.limit) : sessions)
    })
    .get("/sessions/list", validator("query", SessionListQueryInput), async (c) => {
      const query = c.req.valid("query")
      const search = query.search?.trim().toLowerCase()
      const status = SessionStatus.list()
      const sessions: MiyaSessionSummary[] = []
      for await (const session of Session.list()) {
        if (!query.include_archived && session.time.archived) continue
        if (search && !session.title.toLowerCase().includes(search)) continue
        sessions.push({
          id: session.id,
          title: session.title,
          parent_id: session.parentID,
          archived: !!session.time.archived,
          created_at: new Date(session.time.created).toISOString(),
          updated_at: new Date(session.time.updated).toISOString(),
          status: status[session.id] ?? { type: "idle" },
        })
      }
      sessions.sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at))
      return c.json(typeof query.limit === "number" ? sessions.slice(0, query.limit) : sessions)
    })
    .get("/sessions/history", validator("query", SessionHistoryQueryInput), async (c) => {
      const query = c.req.valid("query")
      const includeTools = query.include_tools === true
      const limit = query.limit ?? 80
      const rows: Array<{
        session_id: string
        message_id: string
        role: string
        agent?: string
        created_at: string
        text: string
      }> = []
      const sessionIDs: string[] = []
      if (query.session_id?.trim()) {
        sessionIDs.push(query.session_id.trim())
      } else {
        for await (const session of Session.list()) {
          if (session.time.archived) continue
          sessionIDs.push(session.id)
          if (sessionIDs.length >= 40) break
        }
      }
      for (const sessionID of sessionIDs) {
        if (rows.length >= limit) break
        const messages = await Session.messages({
          sessionID,
          limit: Math.max(10, Math.min(100, limit)),
        }).catch(() => [])
        for (const message of messages) {
          const info = message.info as { id: string; role: string; time: { created: number }; agent?: string }
          const text = extractMessageText(
            message.parts as { type: string; text?: string; output?: string; state?: unknown }[],
            { includeTools },
          )
          if (!text) continue
          rows.push({
            session_id: sessionID,
            message_id: info.id,
            role: info.role,
            agent: info.agent,
            created_at: new Date(info.time.created).toISOString(),
            text,
          })
          if (rows.length >= limit) break
        }
      }
      rows.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      return c.json(rows.slice(0, limit))
    })
    .post("/sessions", validator("json", SessionCreateInput.optional()), async (c) => {
      const body = c.req.valid("json") ?? {}
      return c.json(await Session.create({ title: body.title, parentID: body.parent_id }))
    })
    .patch("/sessions/:id", validator("param", z.object({ id: z.string() })), validator("json", SessionPatchInput), async (c) => {
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")
      const updated = await Session.update(id, (draft) => {
        if (body.title !== undefined) draft.title = body.title
        if (body.archived !== undefined) draft.time.archived = body.archived ? Date.now() : undefined
      })
      return c.json(updated)
    })
    .delete("/sessions/:id", validator("param", z.object({ id: z.string() })), async (c) => {
      const { id } = c.req.valid("param")
      await Session.remove(id)
      return c.json({ deleted: true })
    })
    .get("/sessions/:id/messages", validator("param", z.object({ id: z.string() })), validator("query", SessionMessagesQueryInput), async (c) => {
      const { id } = c.req.valid("param")
      const { limit } = c.req.valid("query")
      const messages = await Session.messages({ sessionID: id, limit: limit ?? 50 })
      const output: MiyaSessionMessage[] = messages.map((message) => {
        const info = message.info as { id: string; role: string; time: { created: number }; agent?: string }
        return {
          id: info.id,
          role: info.role,
          agent: info.agent,
          created_at: new Date(info.time.created).toISOString(),
          text: extractMessageText(message.parts as { type: string; text?: string; output?: string; state?: unknown }[]),
        }
      })
      return c.json(output)
    })
    .post("/sessions/:id/send", validator("param", z.object({ id: z.string() })), validator("json", SessionSendTimeoutInput), async (c) => {
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")
      const session = await Session.get(id).catch(() => null)
      if (!session) return c.json({ error: "session not found" }, 404)
      const profile = await readClawraProfile(Instance.directory)
      const text = applyPersonaText(body.text.trim(), profile)
      const runID = randomUUID()
      sessionInteropRuns.set(runID, {
        id: runID,
        mode: "send",
        to_session_id: id,
        status: "accepted",
        created_at: nowIso(),
        updated_at: nowIso(),
      })
      try {
        const resultPromise = SessionPrompt.prompt({
          sessionID: session.id,
          agent: body.agent ?? "1-task-manager",
          model: parseModelRef(body.model),
          parts: [{ type: "text", text }],
        })
        const timeoutSeconds = body.timeout_seconds ?? 0
        const timed = await withTimeout(resultPromise, timeoutSeconds > 0 ? timeoutSeconds * 1000 : 0)
        if (timed.status === "timeout") {
          SessionPrompt.cancel(session.id)
          sessionInteropRuns.set(runID, {
            ...sessionInteropRuns.get(runID)!,
            status: "timeout",
            error: `send timeout after ${timeoutSeconds}s`,
            updated_at: nowIso(),
          })
          return c.json({
            status: "timeout",
            run_id: runID,
            session_id: id,
            error: `send timeout after ${timeoutSeconds}s`,
          })
        }
        const result = timed.value
        const output = extractAssistantText(
          result.parts as { type: string; text?: string; output?: string; state?: unknown }[],
        )
        sessionInteropRuns.set(runID, {
          ...sessionInteropRuns.get(runID)!,
          status: "ok",
          output,
          updated_at: nowIso(),
        })
        return c.json({
          status: "ok",
          run_id: runID,
          session_id: id,
          message_id: result.info.id,
          output,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sessionInteropRuns.set(runID, {
          ...sessionInteropRuns.get(runID)!,
          status: "error",
          error: message,
          updated_at: nowIso(),
        })
        return c.json(
          {
            status: "error",
            run_id: runID,
            session_id: id,
            error: message,
          },
          502,
        )
      }
    })
    .post("/sessions/route", validator("json", SessionRouteTimeoutInput), async (c) => {
      const body = c.req.valid("json")
      const toSession = await Session.get(body.to_session_id).catch(() => null)
      if (!toSession) return c.json({ error: "to_session not found" }, 404)
      if (body.from_session_id) {
        const fromSession = await Session.get(body.from_session_id).catch(() => null)
        if (!fromSession) return c.json({ error: "from_session not found" }, 404)
      }
      const profile = await readClawraProfile(Instance.directory)
      const includeContext = body.include_context !== false
      const contextLimit = body.context_limit ?? 10
      const context = includeContext && body.from_session_id
        ? await buildSessionRouteContext(body.from_session_id, contextLimit)
        : ""
      const routedText = [context, body.text.trim()].filter(Boolean).join("\n\n")
      const text = applyPersonaText(routedText, profile)
      const runID = randomUUID()
      sessionInteropRuns.set(runID, {
        id: runID,
        mode: "route",
        from_session_id: body.from_session_id,
        to_session_id: body.to_session_id,
        status: "accepted",
        created_at: nowIso(),
        updated_at: nowIso(),
      })
      try {
        const resultPromise = SessionPrompt.prompt({
          sessionID: toSession.id,
          agent: body.agent ?? "1-task-manager",
          model: parseModelRef(body.model),
          parts: [{ type: "text", text }],
        })
        const timeoutSeconds = body.timeout_seconds ?? 0
        const timed = await withTimeout(resultPromise, timeoutSeconds > 0 ? timeoutSeconds * 1000 : 0)
        if (timed.status === "timeout") {
          SessionPrompt.cancel(toSession.id)
          sessionInteropRuns.set(runID, {
            ...sessionInteropRuns.get(runID)!,
            status: "timeout",
            error: `route timeout after ${timeoutSeconds}s`,
            updated_at: nowIso(),
          })
          return c.json({
            status: "timeout",
            run_id: runID,
            from_session_id: body.from_session_id,
            to_session_id: body.to_session_id,
            error: `route timeout after ${timeoutSeconds}s`,
          })
        }
        const result = timed.value
        const output = extractAssistantText(
          result.parts as { type: string; text?: string; output?: string; state?: unknown }[],
        )
        sessionInteropRuns.set(runID, {
          ...sessionInteropRuns.get(runID)!,
          status: "ok",
          output,
          updated_at: nowIso(),
        })
        return c.json({
          status: "ok",
          run_id: runID,
          from_session_id: body.from_session_id,
          to_session_id: body.to_session_id,
          message_id: result.info.id,
          output,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sessionInteropRuns.set(runID, {
          ...sessionInteropRuns.get(runID)!,
          status: "error",
          error: message,
          updated_at: nowIso(),
        })
        return c.json({
          status: "error",
          run_id: runID,
          from_session_id: body.from_session_id,
          to_session_id: body.to_session_id,
          error: message,
        }, 502)
      }
    })
    .post("/sessions/spawn", validator("json", SessionSpawnInput), async (c) => {
      const body = c.req.valid("json")
      if (body.parent_session_id) {
        const parent = await Session.get(body.parent_session_id).catch(() => null)
        if (!parent) return c.json({ error: "parent session not found" }, 404)
      }

      const child = await Session.create({
        title: body.label?.trim() || "Miya Sub Agent",
        parentID: body.parent_session_id,
      })
      const runID = randomUUID()
      const now = nowIso()
      const run: SessionSpawnRun = {
        id: runID,
        parent_session_id: body.parent_session_id,
        child_session_id: child.id,
        label: body.label?.trim() || undefined,
        task: body.task.trim(),
        agent: body.agent ?? "1-task-manager",
        status: "running",
        expires_at: new Date(Date.now() + SPAWN_RUN_TTL_MS).toISOString(),
        created_at: now,
        updated_at: now,
      }
      const store = await readSessionSpawnStore(Instance.directory)
      store.runs[runID] = run
      await writeSessionSpawnStore(Instance.directory, store)

      const profile = await readClawraProfile(Instance.directory)
      const text = applyPersonaText(body.task.trim(), profile)
      void SessionPrompt.prompt({
        sessionID: child.id,
        agent: body.agent ?? "1-task-manager",
        model: parseModelRef(body.model),
        parts: [{ type: "text", text }],
      })
        .then(async (result) => {
          await patchSessionSpawnRun(Instance.directory, runID, {
            status: "completed",
            message_id: result.info.id,
            output: extractAssistantText(
              result.parts as { type: string; text?: string; output?: string; state?: unknown }[],
            ),
          })
          if (body.cleanup === "delete") {
            await Session.remove(child.id).catch(() => {})
          }
        })
        .catch(async (error: unknown) => {
          await patchSessionSpawnRun(Instance.directory, runID, {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          })
          if (body.cleanup === "delete") {
            await Session.remove(child.id).catch(() => {})
          }
        })

      const timeoutSeconds = body.timeout_seconds ?? 0
      if (timeoutSeconds > 0) {
        const finished = await waitForSessionSpawnCompletion(Instance.directory, runID, timeoutSeconds * 1000)
        if (!finished) {
          await patchSessionSpawnRun(Instance.directory, runID, {
            status: "timeout",
            error: `spawn wait timed out after ${timeoutSeconds}s`,
          })
          return c.json({
            run_id: runID,
            status: "timeout",
            child_session_id: child.id,
            error: `spawn wait timed out after ${timeoutSeconds}s`,
          })
        }
        return c.json(finished)
      }

      return c.json({
        run_id: runID,
        status: "accepted",
        child_session_id: child.id,
      })
    })
    .get("/sessions/spawn/:id", validator("param", z.object({ id: z.string() })), async (c) => {
      const { id } = c.req.valid("param")
      const store = await readSessionSpawnStore(Instance.directory)
      const run = store.runs[id]
      if (!run) return c.json({ error: "spawn run not found" }, 404)
      return c.json(run)
    })
    .get("/secrets/status", async (c) => c.json(await readSecretStatus()))
    .put("/secrets/:provider", validator("param", SecretProviderParam), validator("json", SecretPutInput), async (c) => {
      const { provider } = c.req.valid("param")
      const body = c.req.valid("json")
      await SecretStore.set(secretKeyForProvider(provider), body.value.trim())
      return c.json({
        provider,
        configured: true,
      })
    })
    .delete("/secrets/:provider", validator("param", SecretProviderParam), async (c) => {
      const { provider } = c.req.valid("param")
      const deleted = await SecretStore.remove(secretKeyForProvider(provider))
      return c.json({ provider, deleted })
    })
    .post("/secrets/migrate", async (c) => {
      secretMigrationPromise = undefined
      const result = await ensureLegacySecretsMigrated(Instance.directory)
      return c.json(result)
    })
    .post("/clawra/onboarding/start", validator("json", ClawraOnboardingStartInput.optional()), async (c) => {
      const body = c.req.valid("json") ?? {}
      if (body.reset) {
        await writeClawraProfile(Instance.directory, defaultClawraProfile())
      }
      const state: ClawraOnboardingState = {
        stage: "photo",
        history: [],
        updated_at: nowIso(),
      }
      await writeClawraOnboardingState(Instance.directory, state)
      return c.json(state)
    })
    .post("/clawra/onboarding/step", validator("json", ClawraOnboardingStepInput), async (c) => {
      const body = c.req.valid("json")
      const profile = await readClawraProfile(Instance.directory)
      const onboarding = await readClawraOnboardingState(Instance.directory)
      const value = body.value.trim()
      if (body.step === "photo") {
        profile.reference_photo = value
        onboarding.stage = "voice"
      }
      if (body.step === "voice") {
        profile.voice_sample = value
        if (body.provider) profile.voice_backend_default = body.provider
        onboarding.stage = "persona"
      }
      if (body.step === "persona") {
        profile.personality_prompt = value
        onboarding.stage = "ready"
      }
      onboarding.updated_at = nowIso()
      onboarding.history = [...onboarding.history, {
        step: body.step,
        value_preview: clipText(value, 64),
        at: nowIso(),
      }].slice(-20)
      await writeClawraProfile(Instance.directory, profile)
      await writeClawraOnboardingState(Instance.directory, onboarding)
      return c.json({
        status: "ok",
        state: onboarding,
        profile,
      })
    })
    .get("/clawra/onboarding/state", async (c) => c.json(await readClawraOnboardingState(Instance.directory)))
    .get("/clawra/profile", async (c) => c.json(await readClawraProfile(Instance.directory)))
    .put("/clawra/profile", validator("json", ClawraProfileInput), async (c) => {
      const body = c.req.valid("json")
      const next = { ...(await readClawraProfile(Instance.directory)), ...body }
      await writeClawraProfile(Instance.directory, next)
      return c.json(next)
    })
    .post("/clawra/selfie", validator("json", ClawraSelfieInput), async (c) => {
      const body = c.req.valid("json")
      const profile = await readClawraProfile(Instance.directory)
      const falKey = await readProviderSecret("fal", "FAL_KEY")
      if (!falKey) return c.json({ error: "missing FAL key" }, 400)
      const mode = resolveSelfieMode(body.mode, profile, body.user_context)
      const prompt = buildSelfiePrompt(
        body.include_persona === false ? body.prompt : applyPersonaText(body.prompt, profile),
        mode,
        profile,
        body.user_context,
      )
      const referencePhoto = profile.reference_photo?.trim()
      const endpoint = referencePhoto
        ? "https://fal.run/xai/grok-imagine-image/edit"
        : "https://fal.run/xai/grok-imagine-image"
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Key ${falKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          ...(referencePhoto ? { image_url: referencePhoto } : {}),
          num_images: body.num_images ?? 1,
          aspect_ratio: body.aspect_ratio ?? "1:1",
          output_format: body.output_format ?? "jpeg",
        }),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => "")
        return c.json({ error: `grok imagine failed (${response.status})`, detail }, 502)
      }
      const payload = (await response.json()) as {
        images?: { url?: string }[]
        revised_prompt?: string
      }
      const imageUrl = payload.images?.[0]?.url
      if (!imageUrl) return c.json({ error: "image generation returned no image url" }, 502)
      return c.json({
        image_url: imageUrl,
        revised_prompt: payload.revised_prompt,
        mode,
        used_reference_photo: !!referencePhoto,
      })
    })
    .post("/clawra/voice/clone", validator("json", ClawraVoiceCloneInput), async (c) => {
      const body = c.req.valid("json")
      const profile = await readClawraProfile(Instance.directory)
      const provider = body.provider ?? profile.voice_backend_default ?? "elevenlabs"
      const sampleUrl = body.voice_sample_url?.trim() || profile.voice_sample?.trim()
      if (!sampleUrl) return c.json({ error: "missing voice sample url" }, 400)
      const voiceName = body.voice_name?.trim() || `miya-${Date.now()}`
      try {
        if (provider !== "elevenlabs") {
          await ensureLocalVoiceProviderReady(provider)
        }
        const clone = await cloneVoiceWithProvider(provider, sampleUrl, voiceName)
        if (body.persist_as_default !== false) {
          if (clone.voice_id) profile.elevenlabs_voice_id = clone.voice_id
          profile.voice_backend_default = provider
          await writeClawraProfile(Instance.directory, profile)
        }
        return c.json({
          status: "ok",
          provider,
          voice_id: clone.voice_id,
        })
      } catch (error) {
        return c.json({
          status: "error",
          provider,
          error: error instanceof Error ? error.message : String(error),
        }, 502)
      }
    })
    .get("/clawra/voice/providers", async (c) => c.json(await getVoiceProviderHealth()))
    .post("/clawra/voice/speak", validator("json", ClawraVoiceInput), async (c) => {
      const body = c.req.valid("json")
      const profile = await readClawraProfile(Instance.directory)
      const preferred = body.provider ?? profile.voice_backend_default ?? "elevenlabs"
      const text = applyPersonaText(body.text, profile)
      const voiceID = body.voice_id?.trim() || profile.elevenlabs_voice_id?.trim() || "21m00Tcm4TlvDq8ikWAM"
      const modelID = body.model_id ?? "eleven_multilingual_v2"
      const allowFallback = body.fallback_to_cloud !== false
      try {
        if (preferred === "elevenlabs") {
          const eleven = await speakWithElevenLabs(text, voiceID, modelID)
          return c.json(eleven)
        }
        await ensureLocalVoiceProviderReady(preferred)
        const local = await speakWithLocalProvider(preferred, text, voiceID, modelID)
        return c.json(local)
      } catch (error) {
        if (!allowFallback || preferred === "elevenlabs") {
          return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
        }
        try {
          const fallback = await speakWithElevenLabs(text, voiceID, modelID)
          return c.json({
            ...fallback,
            fallback_from: preferred,
          })
        } catch (fallbackError) {
          return c.json({
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            fallback_from: preferred,
          }, 502)
        }
      }
    })
    .get("/jobs", async (c) => c.json(new MiyaAutomationService(Instance.directory).listJobs()))
    .post("/jobs", validator("json", JobCreateInput), async (c) => {
      const body = c.req.valid("json")
      const svc = new MiyaAutomationService(Instance.directory)
      return c.json(svc.scheduleDailyCommand({ name: body.name, time: body.time, command: body.command, cwd: body.cwd, timeoutMs: body.timeout_ms, requireApproval: false }))
    })
    .patch("/jobs/:id", validator("param", z.object({ id: z.string() })), validator("json", JobEnableInput), async (c) => {
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")
      return c.json(new MiyaAutomationService(Instance.directory).setJobEnabled(id, body.enabled))
    })
    .delete("/jobs/:id", validator("param", z.object({ id: z.string() })), async (c) => {
      const { id } = c.req.valid("param")
      return c.json({ deleted: new MiyaAutomationService(Instance.directory).deleteJob(id) })
    })
    .post("/jobs/:id/run", validator("param", z.object({ id: z.string() })), async (c) => {
      const { id } = c.req.valid("param")
      return c.json(await new MiyaAutomationService(Instance.directory).runJobNow(id))
    })
    .get("/approvals", async (c) => c.json([]))
    .post("/approvals/:id/approve", validator("param", z.object({ id: z.string() })), async (c) => {
      void c.req.valid("param")
      return c.json({ error: "manual approvals disabled in full-autopilot mode" }, 410)
    })
    .post("/approvals/:id/reject", validator("param", z.object({ id: z.string() })), async (c) => {
      void c.req.valid("param")
      return c.json({ error: "manual approvals disabled in full-autopilot mode" }, 410)
    })
    .get("/history", validator("query", z.object({ limit: z.coerce.number().min(1).max(200).optional() })), async (c) => {
      const { limit } = c.req.valid("query")
      return c.json(new MiyaAutomationService(Instance.directory).listHistory(limit ?? 50))
    })
    .get("/tools", async (c) => c.json(await listMiyaTools()))
    .post("/tools/invoke", validator("json", ToolInvokeInput), async (c) => {
      const body = c.req.valid("json")
      if (!safeToolAllowed(body.tool)) return c.json({ output: `Tool not allowed: ${body.tool}` }, 403)
      const tool = await findMiyaTool(body.tool)
      if (!tool) return c.json({ output: `Tool not found: ${body.tool}` }, 404)
      const parser = z.object(tool.args)
      const output = await tool.execute(parser.parse(body.args ?? {}), {
        sessionID: body.session_id ?? "miya-control",
        messageID: `miya-${randomUUID()}`,
        agent: body.agent ?? "1-task-manager",
        directory: Instance.directory,
        worktree: Instance.worktree,
        abort: new AbortController().signal,
        metadata() {},
        async ask() {},
      })
      return c.json({ output })
    })
    .get("/loop", validator("query", z.object({ session_id: z.string().optional() })), async (c) => {
      const { session_id } = c.req.valid("query")
      const loop = await readLoopState(Instance.directory)
      if (session_id) {
        const state = loop.sessions[session_id]
        if (!isRecord(state)) return c.json({ session_id, state: null }, 404)
        return c.json({ session_id, state })
      }
      return c.json(loop.sessions)
    })
    .patch("/loop/:session_id", validator("param", z.object({ session_id: z.string() })), validator("json", LoopStatePatchInput), async (c) => {
      const { session_id } = c.req.valid("param")
      const body = c.req.valid("json")
      const file = runtimeFile(Instance.directory, "loop-state.json")
      const loop = await readLoopState(Instance.directory)
      const current = isRecord(loop.sessions[session_id]) ? loop.sessions[session_id] : {}
      const next = { ...current, ...body, updatedAt: nowIso() }
      loop.sessions[session_id] = next
      await writeJson(file, loop)
      return c.json({ session_id, state: next })
    })
    .post("/gateway/turn", validator("json", GatewayTurnInput), async (c) => {
      const body = c.req.valid("json")
      const session = body.session_id
        ? await Session.get(body.session_id).catch(() => null)
        : await Session.create({ title: "Miya Gateway" })
      if (!session) return c.json({ error: "session not found" }, 404)
      const turnID = randomUUID()
      const store = await readGatewayStore(Instance.directory)
      store.turns[turnID] = {
        id: turnID,
        session_id: session.id,
        agent: body.agent ?? "1-task-manager",
        request: body.text?.trim() ?? "",
        status: "running",
        output: "",
        created_at: nowIso(),
        updated_at: nowIso(),
      }
      await writeGatewayStore(Instance.directory, store)

      const profile = await readClawraProfile(Instance.directory)
      const rawText = body.text?.trim() ?? ""
      const normalizedText = rawText.toLowerCase()
      const onboarding = await readClawraOnboardingState(Instance.directory)
      const startCommand = normalizedText === "/start" || normalizedText === "/start reset"
      const startReset = normalizedText === "/start reset"
      const onboardingActive =
        onboarding.stage === "photo" ||
        onboarding.stage === "voice" ||
        onboarding.stage === "persona" ||
        (!clawraProfileReady(profile) && onboarding.stage !== "ready")

      if (startCommand) {
        if (!startReset && clawraProfileReady(profile) && onboarding.stage === "ready") {
          await patchGatewayTurn(Instance.directory, turnID, {
            status: "completed",
            output:
              "我已经完成设置了。直接和我聊天即可。\n如果你想重新走向导，请输入 /start reset。",
          })
          return c.json({ turn_id: turnID, session_id: session.id, status: "completed" })
        }
        const next: ClawraOnboardingState = {
          stage: "photo",
          updated_at: nowIso(),
          history: [],
        }
        await writeClawraOnboardingState(Instance.directory, next)
        await patchGatewayTurn(Instance.directory, turnID, {
          status: "completed",
          output:
            "欢迎回来。我们开始设置我吧。\n\n给我展示我应该是什么样子。请发送 1 到 5 张照片（直接拖拽图片即可）。",
        })
        return c.json({ turn_id: turnID, session_id: session.id, status: "completed" })
      }

      if (onboardingActive) {
        if (onboarding.stage === "idle") onboarding.stage = "photo"

        if (onboarding.stage === "photo") {
          if ((body.images?.length ?? 0) === 0) {
            await patchGatewayTurn(Instance.directory, turnID, {
              status: "completed",
              output:
                "第一步还没完成。请发送 1 到 5 张照片（拖拽上传即可），我会自动创建面部嵌入/LoRA hook。",
            })
            return c.json({ turn_id: turnID, session_id: session.id, status: "completed" })
          }
          profile.reference_photo = body.images?.[0]?.url
          onboarding.stage = "voice"
          pushOnboardingHistory(onboarding, "photo", `photos=${body.images?.length ?? 0}`)
          await writeJson(runtimeFile(Instance.directory, "clawra/vision-hook.json"), {
            hook_id: `face-${randomUUID().slice(0, 8)}`,
            status: "ready",
            source_count: body.images?.length ?? 0,
            reference_photo: profile.reference_photo,
            updated_at: nowIso(),
          })
          await writeClawraProfile(Instance.directory, profile)
          await writeClawraOnboardingState(Instance.directory, onboarding)
          await patchGatewayTurn(Instance.directory, turnID, {
            status: "completed",
            output:
              "收到照片。我已经建立视觉身份。\n\n我应该用什么声音？录音或发送音频文件（mp3/wav/m4a）。",
          })
          return c.json({ turn_id: turnID, session_id: session.id, status: "completed" })
        }

        if (onboarding.stage === "voice") {
          const textLooksLikeUrl = /^https?:\/\//i.test(rawText) || /^data:audio\//i.test(rawText)
          const voiceSample = body.audios?.[0]?.url || (textLooksLikeUrl ? rawText : "")
          if (!voiceSample) {
            await patchGatewayTurn(Instance.directory, turnID, {
              status: "completed",
              output:
                "第二步还没完成。请录音或上传音频文件（mp3/wav/m4a），我会克隆音色和音准。",
            })
            return c.json({ turn_id: turnID, session_id: session.id, status: "completed" })
          }
          profile.voice_sample = voiceSample
          const provider = profile.voice_backend_default ?? "elevenlabs"
          let voiceNote = ""
          try {
            if (provider !== "elevenlabs") {
              await ensureLocalVoiceProviderReady(provider)
            }
            const cloned = await cloneVoiceWithProvider(provider, voiceSample, `miya-${Date.now()}`)
            if (cloned.voice_id) profile.elevenlabs_voice_id = cloned.voice_id
            voiceNote = cloned.voice_id
              ? `声音克隆完成（provider=${provider}, voice_id=${cloned.voice_id}）。`
              : `声音样本已保存（provider=${provider}）。`
          } catch (error) {
            voiceNote = `声音样本已保存，但克隆失败：${error instanceof Error ? error.message : String(error)}`
          }
          onboarding.stage = "persona"
          pushOnboardingHistory(onboarding, "voice", provider)
          await writeClawraProfile(Instance.directory, profile)
          await writeClawraOnboardingState(Instance.directory, onboarding)
          await patchGatewayTurn(Instance.directory, turnID, {
            status: "completed",
            output: `${voiceNote}\n\n我是谁？告诉我我的性格、习惯和我们的关系。`,
          })
          return c.json({ turn_id: turnID, session_id: session.id, status: "completed" })
        }

        if (onboarding.stage === "persona") {
          if (!rawText) {
            await patchGatewayTurn(Instance.directory, turnID, {
              status: "completed",
              output:
                "第三步还没完成。请用文字描述我的性格、习惯和我们之间的关系。",
            })
            return c.json({ turn_id: turnID, session_id: session.id, status: "completed" })
          }
          profile.personality_prompt = rawText
          profile.auto_persona = true
          onboarding.stage = "ready"
          pushOnboardingHistory(onboarding, "persona", rawText)
          await writeClawraProfile(Instance.directory, profile)
          await writeClawraOnboardingState(Instance.directory, onboarding)
          await patchGatewayTurn(Instance.directory, turnID, {
            status: "completed",
            output:
              "设置完成。你好，亲爱的！\n\n现在可以正常聊天了，也可以让我自拍（/clawra/selfie）和语音回复。",
          })
          return c.json({ turn_id: turnID, session_id: session.id, status: "completed" })
        }
      }

      const text = rawText
        ? applyPersonaText(rawText, profile)
        : profile.auto_persona && profile.personality_prompt?.trim()
          ? applyPersonaText("Please analyze the attached image(s).", profile)
          : ""
      const textParts = text ? [{ type: "text" as const, text }] : []
      const imageParts = (body.images ?? []).map((item) => ({
        type: "file" as const,
        url: item.url,
        filename: item.filename ?? "image",
        mime: item.mime ?? "image/png",
      }))
      const audioParts = (body.audios ?? []).map((item) => ({
        type: "file" as const,
        url: item.url,
        filename: item.filename ?? "audio",
        mime: item.mime ?? "audio/mpeg",
      }))

      void SessionPrompt.prompt({
        sessionID: session.id,
        agent: body.agent ?? "1-task-manager",
        model: parseModelRef(body.model),
        parts: [...textParts, ...imageParts, ...audioParts],
      })
        .then(async (message) => {
          await patchGatewayTurn(Instance.directory, turnID, {
            status: "completed",
            output: extractAssistantText(message.parts as { type: string; text?: string; output?: string; state?: unknown }[]),
          })
        })
        .catch(async (error: unknown) => {
          await patchGatewayTurn(Instance.directory, turnID, {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          })
        })

      return c.json({ turn_id: turnID, session_id: session.id, status: "running" })
    })
    .get("/gateway/turn/:id", validator("param", z.object({ id: z.string() })), async (c) => {
      const { id } = c.req.valid("param")
      const store = await readGatewayStore(Instance.directory)
      return c.json(store.turns[id] ?? null)
    })
    .get("/gateway/stream/:id", validator("param", z.object({ id: z.string() })), async (c) => {
      const { id } = c.req.valid("param")
      return streamSSE(c, async (stream) => {
        let last = ""
        const send = async () => {
          const store = await readGatewayStore(Instance.directory)
          const turn = store.turns[id]
          if (!turn) {
            await stream.writeSSE({ data: JSON.stringify({ turn_id: id, status: "missing" }) })
            stream.close()
            return
          }
          const data = JSON.stringify(turn)
          if (data !== last) {
            last = data
            await stream.writeSSE({ data })
          }
          if (turn.status !== "running") stream.close()
        }

        await send()
        const interval = setInterval(() => void send(), 1000)
        await new Promise<void>((resolve) => {
          stream.onAbort(() => {
            clearInterval(interval)
            resolve()
          })
        })
      })
    })
    .get("/memory", async (c) => c.json(await readMemoryStore(Instance.directory)))
    .put("/memory", validator("json", z.record(z.string(), z.unknown())), async (c) => {
      const body = c.req.valid("json")
      await writeMemoryStore(Instance.directory, body)
      return c.json(body)
    })
    .patch("/memory", validator("json", z.record(z.string(), z.unknown())), async (c) => {
      const body = c.req.valid("json")
      const next = { ...(await readMemoryStore(Instance.directory)), ...body }
      await writeMemoryStore(Instance.directory, next)
      return c.json(next)
    })
    .delete("/memory/:key", validator("param", z.object({ key: z.string() })), async (c) => {
      const { key } = c.req.valid("param")
      const current = await readMemoryStore(Instance.directory)
      const deleted = key in current
      if (deleted) {
        delete current[key]
        await writeMemoryStore(Instance.directory, current)
      }
      return c.json({ deleted })
    })
    .get("/connectors", async (c) => {
      const store = await readConnectorsStore(Instance.directory)
      return c.json(await sanitizeConnectorsResponse(store))
    })
    .patch("/connectors/:name", validator("param", z.object({ name: z.enum(["webhook", "slack", "telegram"]) })), validator("json", ConnectorPatchInput), async (c) => {
      const { name } = c.req.valid("param")
      const body = c.req.valid("json")
      const store = await readConnectorsStore(Instance.directory)
      const next = { ...store[name], ...body }
      if (name === "webhook" && typeof body.webhook_secret === "string" && body.webhook_secret.trim()) {
        await SecretStore.set(secretKeyForProvider("webhook"), body.webhook_secret.trim())
        delete next.webhook_secret
      }
      if (name === "slack" && typeof body.slack_bot_token === "string" && body.slack_bot_token.trim()) {
        await SecretStore.set(secretKeyForProvider("slack"), body.slack_bot_token.trim())
        delete next.slack_bot_token
      }
      if (name === "telegram" && typeof body.telegram_bot_token === "string" && body.telegram_bot_token.trim()) {
        await SecretStore.set(secretKeyForProvider("telegram"), body.telegram_bot_token.trim())
        delete next.telegram_bot_token
      }
      store[name] = next
      await writeConnectorsStore(Instance.directory, store)
      const sanitized = await sanitizeConnectorsResponse(store)
      return c.json(sanitized[name])
    })
    .post("/connectors/:name/test", validator("param", z.object({ name: z.enum(["webhook", "slack", "telegram"]) })), validator("json", z.object({ message: z.string().optional() }).optional()), async (c) => {
      const { name } = c.req.valid("param")
      const body = c.req.valid("json") ?? {}
      const store = await readConnectorsStore(Instance.directory)
      const result = await testConnector(name, store[name], body.message ?? `[Miya connector test] ${nowIso()}`)
      store[name] = {
        ...store[name],
        last_test_at: nowIso(),
        last_test_ok: result.ok,
        last_test_error: result.ok ? undefined : result.error,
      }
      await writeConnectorsStore(Instance.directory, store)
      return c.json({ connector: name, ...result })
    })
    .get("/voice/ws", upgradeWebSocket(() => {
      const id = randomUUID()
      return {
        onOpen(_event, ws) {
          ws.send(JSON.stringify({ type: "voice.ready", connection_id: id, ts: nowIso() }))
        },
        async onMessage(event, ws) {
          const raw = String(event.data ?? "")
          const payload = (() => {
            try {
              return JSON.parse(raw) as { type?: string; text?: string; session_id?: string; agent?: string }
            } catch {
              return { type: "raw", text: raw }
            }
          })()
          const type = payload.type ?? "raw"
          if (type === "ping") {
            ws.send(JSON.stringify({ type: "pong", ts: nowIso() }))
            return
          }
          if (type === "interrupt") {
            const state = voiceSession.get(id)
            if (state?.sessionID) SessionPrompt.cancel(state.sessionID)
            ws.send(JSON.stringify({ type: "voice.interrupted", session_id: state?.sessionID ?? null, ts: nowIso() }))
            return
          }
          if (type === "audio.chunk") {
            const bytes = Buffer.byteLength(payload.text ?? "", "base64")
            const state = voiceSession.get(id) ?? { sessionID: "", audioBytes: 0 }
            state.audioBytes += Number.isFinite(bytes) ? bytes : 0
            voiceSession.set(id, state)
            ws.send(JSON.stringify({ type: "stt.partial", text: `[audio buffered ${state.audioBytes} bytes]`, ts: nowIso() }))
            return
          }
          if (type === "audio.commit") {
            const state = voiceSession.get(id) ?? { sessionID: "", audioBytes: 0 }
            const text = state.audioBytes > 0 ? `[voice audio ${state.audioBytes} bytes]` : ""
            if (!text) {
              ws.send(JSON.stringify({ type: "voice.error", error: "missing audio chunk or text" }))
              return
            }
            payload.text = text
            state.audioBytes = 0
            voiceSession.set(id, state)
          }

          const inputText = String(payload.text ?? "").trim()
          if (!inputText) {
            ws.send(JSON.stringify({ type: "voice.error", error: "missing text" }))
            return
          }
          const profile = await readClawraProfile(Instance.directory)
          const text = applyPersonaText(inputText, profile)
          const session =
            payload.session_id && payload.session_id.length > 0
              ? await Session.get(payload.session_id).catch(() => null)
              : await Session.create({ title: "Miya Voice" })
          if (!session) {
            ws.send(JSON.stringify({ type: "voice.error", error: "session not found", ts: nowIso() }))
            return
          }
          const previous = voiceSession.get(id)
          voiceSession.set(id, { sessionID: session.id, audioBytes: previous?.audioBytes ?? 0 })
          ws.send(JSON.stringify({ type: "stt.final", session_id: session.id, text: inputText, ts: nowIso() }))
          try {
            const response = await SessionPrompt.prompt({
              sessionID: session.id,
              agent: payload.agent ?? "1-task-manager",
              parts: [{ type: "text", text }],
            })
            const assistant = extractAssistantText(response.parts as { type: string; text?: string; output?: string; state?: unknown }[])
            for (const chunk of assistant.split(/\s+/).filter(Boolean)) {
              ws.send(JSON.stringify({ type: "assistant.text.delta", session_id: session.id, text: `${chunk} `, ts: nowIso() }))
            }
            ws.send(
              JSON.stringify({
                type: "assistant.text",
                session_id: session.id,
                text: assistant,
                ts: nowIso(),
              }),
            )
          } catch (error) {
            ws.send(
              JSON.stringify({
                type: "voice.error",
                session_id: session.id,
                error: error instanceof Error ? error.message : String(error),
                ts: nowIso(),
              }),
            )
          }
        },
        onClose() {
          const state = voiceSession.get(id)
          if (state?.sessionID) SessionPrompt.cancel(state.sessionID)
          voiceSession.delete(id)
        },
      }
    }))
    .get("/browser/status", validator("query", z.object({ session_id: z.string().optional() })), async (c) => {
      const query = c.req.valid("query")
      const store = await readBrowserStore(Instance.directory)
      if (!query.session_id) {
        return c.json({
          sessions_total: Object.keys(store.sessions).length,
          sessions_live: Object.keys(store.sessions).filter((id) => browserRuntime.has(id)).length,
          runtime_live_ids: Object.keys(store.sessions).filter((id) => browserRuntime.has(id)),
        })
      }
      const session = store.sessions[query.session_id]
      if (!session) return c.json({ error: "browser session not found" }, 404)
      const runtime = browserRuntime.get(query.session_id)
      return c.json({
        session_id: query.session_id,
        live: !!runtime,
        url: session.url,
        title: session.title,
        updated_at: session.updated_at,
        events: session.events.length,
      })
    })
    .post("/browser/start", validator("json", BrowserSessionRefInput), async (c) => {
      const body = c.req.valid("json")
      const runtime = await ensureBrowserRuntime(Instance.directory, body.session_id)
      if (!runtime) return c.json({ error: "browser session not found" }, 404)
      await recordBrowserEvent(Instance.directory, body.session_id, "runtime:start")
      const session = await syncBrowserSessionMeta(Instance.directory, body.session_id)
      return c.json({ status: "ok", session, tabs: await browserTabListWithTitle(runtime) })
    })
    .post("/browser/stop", validator("json", BrowserSessionRefInput), async (c) => {
      const body = c.req.valid("json")
      await closeBrowserRuntime(body.session_id)
      await recordBrowserEvent(Instance.directory, body.session_id, "runtime:stop")
      const session = await syncBrowserSessionMeta(Instance.directory, body.session_id)
      return c.json({ status: "ok", session })
    })
    .get("/browser/tabs", validator("query", BrowserSessionRefInput), async (c) => {
      const query = c.req.valid("query")
      const runtime = await ensureBrowserRuntime(Instance.directory, query.session_id)
      if (!runtime) return c.json({ error: "browser session not found" }, 404)
      return c.json(await browserTabListWithTitle(runtime))
    })
    .post("/browser/open", validator("json", BrowserOpenInput), async (c) => {
      const body = c.req.valid("json")
      const runtime = await ensureBrowserRuntime(Instance.directory, body.session_id)
      if (!runtime) return c.json({ error: "browser session not found" }, 404)
      const page = await runtime.context.newPage()
      attachBrowserPageListeners(Instance.directory, body.session_id, page)
      await page.goto(body.url, { waitUntil: "domcontentloaded", timeout: 45_000 })
      runtime.page = page
      runtime.lastActiveAt = Date.now()
      await recordBrowserEvent(Instance.directory, body.session_id, "tab:open", { url: body.url })
      const session = await syncBrowserSessionMeta(Instance.directory, body.session_id)
      return c.json({ status: "ok", session, tabs: await browserTabListWithTitle(runtime) })
    })
    .post("/browser/focus", validator("json", BrowserFocusInput), async (c) => {
      const body = c.req.valid("json")
      const runtime = await ensureBrowserRuntime(Instance.directory, body.session_id)
      if (!runtime) return c.json({ error: "browser session not found" }, 404)
      const page = await resolveBrowserTab(runtime, body)
      if (!page) return c.json({ error: "tab not found" }, 404)
      runtime.page = page
      await page.bringToFront().catch(() => {})
      runtime.lastActiveAt = Date.now()
      await recordBrowserEvent(Instance.directory, body.session_id, "tab:focus", { url: page.url() })
      const session = await syncBrowserSessionMeta(Instance.directory, body.session_id)
      return c.json({ status: "ok", session, tabs: await browserTabListWithTitle(runtime) })
    })
    .post("/browser/close", validator("json", BrowserCloseInput), async (c) => {
      const body = c.req.valid("json")
      const runtime = await ensureBrowserRuntime(Instance.directory, body.session_id)
      if (!runtime) return c.json({ error: "browser session not found" }, 404)
      const page = await resolveBrowserTab(runtime, body)
      if (!page) return c.json({ error: "tab not found" }, 404)
      await page.close().catch(() => {})
      let pages = runtime.context.pages()
      if (pages.length === 0) {
        const next = await runtime.context.newPage()
        attachBrowserPageListeners(Instance.directory, body.session_id, next)
        pages = runtime.context.pages()
      }
      runtime.page = pages[0]
      runtime.lastActiveAt = Date.now()
      await recordBrowserEvent(Instance.directory, body.session_id, "tab:close")
      const session = await syncBrowserSessionMeta(Instance.directory, body.session_id)
      return c.json({ status: "ok", session, tabs: await browserTabListWithTitle(runtime) })
    })
    .post("/browser/snapshot", validator("json", BrowserSnapshotInput), async (c) => {
      const body = c.req.valid("json")
      const runtime = await ensureBrowserRuntime(Instance.directory, body.session_id)
      if (!runtime) return c.json({ error: "browser session not found" }, 404)
      const maxChars = body.max_chars ?? 6000
      const snapshot = await runtime.page.evaluate((maxLength: number) => {
        const doc = document
        const title = doc.title
        const url = location.href
        const text = (doc.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength)
        const elements = Array.from(doc.querySelectorAll("a,button,input,textarea,select,[role='button']")).slice(0, 80)
        const refs: Record<string, string> = {}
        const lines: string[] = []
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i] as HTMLElement
          const ref = `e${i + 1}`
          const id = el.id ? `#${el.id}` : ""
          const name = el.getAttribute("name")
          const role = el.getAttribute("role")
          const tag = el.tagName.toLowerCase()
          const selector = id || (name ? `${tag}[name='${name}']` : `${tag}:nth-of-type(${i + 1})`)
          refs[ref] = selector
          const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim()
          if (label) lines.push(`[ref:${ref}] ${selector} :: ${label.slice(0, 120)}`)
        }
        return { title, url, text, refs, summary: lines.join("\n") }
      }, maxChars)
      const refs = snapshot.refs ?? {}
      browserSnapshotRefs.set(body.session_id, { createdAt: Date.now(), refs })
      await recordBrowserEvent(Instance.directory, body.session_id, "snapshot", {
        refs: Object.keys(refs).length,
        summary: clipText(snapshot.summary || "", 400),
      })
      return c.json({
        session_id: body.session_id,
        title: snapshot.title,
        url: snapshot.url,
        text: snapshot.text,
        summary: snapshot.summary,
        refs,
        ...(body.include_html ? { html: await runtime.page.content() } : {}),
      })
    })
    .get("/browser/console", validator("query", BrowserConsoleQueryInput), async (c) => {
      const query = c.req.valid("query")
      const store = await readBrowserStore(Instance.directory)
      const session = store.sessions[query.session_id]
      if (!session) return c.json({ error: "browser session not found" }, 404)
      const records = session.events
        .filter((event) => event.type === "console" || event.type === "pageerror")
        .slice(-(query.limit ?? 50))
      return c.json(records)
    })
    .get("/browser/session", async (c) => {
      const first = await readBrowserStore(Instance.directory)
      const liveIDs = Object.keys(first.sessions).filter((id) => browserRuntime.has(id))
      for (const id of liveIDs) {
        await syncBrowserSessionMeta(Instance.directory, id)
      }
      const store = await readBrowserStore(Instance.directory)
      return c.json(Object.values(store.sessions))
    })
    .post("/browser/session", validator("json", BrowserCreateInput.optional()), async (c) => {
      const body = c.req.valid("json") ?? {}
      const id = randomUUID()
      const store = await readBrowserStore(Instance.directory)
      store.sessions[id] = {
        id,
        url: body.url,
        title: body.title,
        created_at: nowIso(),
        updated_at: nowIso(),
        events: [
          {
            id: randomUUID(),
            seq: 1,
            type: "created",
            created_at: nowIso(),
            data: { url: body.url, title: body.title },
          },
        ],
        live: false,
        event_seq: 1,
      }
      await writeBrowserStore(Instance.directory, store)
      try {
        await launchBrowserRuntime(Instance.directory, id, body.url)
        await recordBrowserEvent(Instance.directory, id, "runtime:ready", {
          url: body.url,
          title: body.title,
        })
        const session = await syncBrowserSessionMeta(Instance.directory, id)
        return c.json(session ?? store.sessions[id])
      } catch (error) {
        await recordBrowserEvent(Instance.directory, id, "runtime:error", {
          message: error instanceof Error ? error.message : String(error),
        })
        return c.json(
          {
            error: error instanceof Error ? error.message : String(error),
            session_id: id,
          },
          500,
        )
      }
    })
    .delete("/browser/session/:id", validator("param", z.object({ id: z.string() })), async (c) => {
      const { id } = c.req.valid("param")
      await closeBrowserRuntime(id)
      const store = await readBrowserStore(Instance.directory)
      const deleted = !!store.sessions[id]
      if (deleted) {
        delete store.sessions[id]
        await writeBrowserStore(Instance.directory, store)
      }
      return c.json({ deleted })
    })
    .post("/browser/session/:id/navigate", validator("param", z.object({ id: z.string() })), validator("json", BrowserNavigateInput), async (c) => {
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")
      const runtime = await ensureBrowserRuntime(Instance.directory, id)
      if (!runtime) return c.json({ error: "browser session not found" }, 404)
      try {
        await runtime.page.goto(body.url, { waitUntil: "domcontentloaded", timeout: 45_000 })
        await recordBrowserEvent(Instance.directory, id, "navigate", { url: body.url })
        const session = await syncBrowserSessionMeta(Instance.directory, id)
        return c.json(session)
      } catch (error) {
        await recordBrowserEvent(Instance.directory, id, "navigate:error", {
          url: body.url,
          message: error instanceof Error ? error.message : String(error),
        })
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
      }
    })
    .post("/browser/session/:id/action", validator("param", z.object({ id: z.string() })), validator("json", BrowserActionInput), async (c) => {
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")
      try {
        const result = await executeBrowserAction(Instance.directory, id, body)
        const session = await syncBrowserSessionMeta(Instance.directory, id)
        return c.json({ session, result })
      } catch (error) {
        await recordBrowserEvent(Instance.directory, id, `action:${body.action}:error`, {
          target: body.target,
          value: body.value,
          message: error instanceof Error ? error.message : String(error),
        })
        const msg = error instanceof Error ? error.message : String(error)
        const status = /not found/i.test(msg) ? 404 : 502
        return c.json({ error: msg }, status)
      }
    })
    .get("/browser/session/:id/stream", validator("param", z.object({ id: z.string() })), async (c) => {
      const { id } = c.req.valid("param")
      return streamSSE(c, async (stream) => {
        let sent = 0
        const push = async () => {
          const store = await readBrowserStore(Instance.directory)
          const session = store.sessions[id]
          if (!session) {
            await stream.writeSSE({ data: JSON.stringify({ session_id: id, status: "missing" }) })
            stream.close()
            return
          }
          const next = session.events.slice(sent)
          for (const event of next) {
            await stream.writeSSE({ data: JSON.stringify({ session_id: id, event }) })
          }
          sent = session.events.length
        }
        await push()
        const interval = setInterval(() => void push(), 1000)
        await new Promise<void>((resolve) => {
          stream.onAbort(() => {
            clearInterval(interval)
            resolve()
          })
        })
      })
    }),
)
