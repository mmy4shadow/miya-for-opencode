import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"

type MiyaStatus = {
  autopilot_mode?: string
  loop_cycle_limit?: number
  jobs_total: number
  jobs_enabled: number
  approvals_pending: number
  self_approval_records?: number
  loop_paused_sessions: number
  connectors_enabled: number
  kill_switch_active?: boolean
}

type AgentInfo = {
  name: string
  description?: string
  model?: { providerID: string; modelID: string }
  temperature?: number
  variant?: string
}

type MiyaJob = {
  id: string
  name: string
  enabled: boolean
  requireApproval: boolean
  schedule: { time: string }
  action: { command: string }
  nextRunAt: string
}

type MiyaApproval = {
  id: string
  jobId: string
  status: "pending" | "approved" | "rejected"
  requestedAt: string
}

type MiyaHistory = {
  id: string
  jobName: string
  status: string
  startedAt: string
  exitCode: number | null
}

type ConnectorConfig = {
  enabled: boolean
  webhook_url?: string
  slack_channel?: string
  telegram_chat_id?: string
  last_test_at?: string
  last_test_ok?: boolean
  last_test_error?: string
  webhook_secret_configured?: boolean
  slack_bot_token_configured?: boolean
  telegram_bot_token_configured?: boolean
}

type ConnectorsState = {
  webhook: ConnectorConfig
  slack: ConnectorConfig
  telegram: ConnectorConfig
}

type GatewayTurn = {
  id: string
  status: "running" | "completed" | "failed"
  output: string
  error?: string
}

type LoopState = {
  loopEnabled?: boolean
  autoContinue?: boolean
  maxIterationsPerWindow?: number
  iterationCompleted?: number
  windowStartIteration?: number
  awaitingConfirmation?: boolean
  strictQualityGate?: boolean
  lastDone?: string[]
  lastMissing?: string[]
  lastUnresolved?: string[]
  updatedAt?: string
}

type ToolInfo = {
  name: string
  description: string
  args: string[]
  safe: boolean
}

type GatewayImage = {
  url: string
  filename?: string
  mime?: string
  size: number
}
type GatewayAudio = {
  url: string
  filename?: string
  mime?: string
  size: number
}

type BrowserSession = {
  id: string
  url?: string
  title?: string
  updated_at: string
  live?: boolean
}
type MiyaSessionItem = {
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
type SessionSpawnRun = {
  id: string
  parent_session_id?: string
  child_session_id: string
  label?: string
  task: string
  agent: string
  status: "running" | "completed" | "failed"
  message_id?: string
  output?: string
  error?: string
  created_at: string
  updated_at: string
}
type ClawraProfile = {
  reference_photo?: string
  voice_sample?: string
  personality_prompt?: string
  nsfw_enabled: boolean
  auto_persona: boolean
  elevenlabs_voice_id?: string
  voice_backend_default?: "elevenlabs" | "coqui" | "rvc"
  selfie_mode_default?: "mirror" | "direct" | "auto"
}
type SecretStatus = {
  backend: string
  providers: {
    fal: boolean
    elevenlabs: boolean
    slack: boolean
    telegram: boolean
    webhook: boolean
  }
}
type SelfApprovalRecord = {
  id: string
  action: string
  status: "executed" | "failed" | "blocked"
  created_at: string
  duration_ms: number
  verifier: { verdict: "allow" | "deny"; checks: string[]; evidence: string[] }
  rollback: { strategy: string }
  error?: string
}
type RuntimeState = {
  gateway: { transport: string; same_port_control_plane: boolean; active_turns: number }
  nodes: {
    voice: { connected: boolean; connection_count: number }
    browser: { connected: boolean; live_sessions: number; known_sessions: number }
    desktop: { connected: boolean; accessibility: string; screen_recording: string }
  }
  kill_switch: { active: boolean; reason?: string; updated_at: string }
}
type SkillPackState = {
  id: string
  enabled: boolean
  locked_version?: string
  source: "project"
  updated_at: string
}
type KillSwitchState = {
  active: boolean
  reason?: string
  activated_at?: string
  released_at?: string
  updated_at: string
}

const miyaAgents = (a: AgentInfo) => /^([1-6])-[a-z0-9-]+$/i.test(a.name)

export const MiyaPanel: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const sdk = useSDK()

  const url = (p: string) => {
    const u = new URL(p, sdk.url)
    u.searchParams.set("directory", sdk.directory)
    return u.toString()
  }

  const req = async <T,>(p: string, init?: RequestInit) => {
    const f = platform.fetch ?? fetch
    const res = await f(url(p), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const raw = await res.text().catch(() => "")
      let detail = raw
      try {
        const parsed = JSON.parse(raw) as { error?: string; detail?: string }
        detail = parsed.error || parsed.detail || raw
      } catch {}
      throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`)
    }
    return (await res.json()) as T
  }

  const [refresh, setRefresh] = createSignal(0)
  const [sessionControl, setSessionControl] = createStore({
    selected: "",
    titleDraft: "",
    search: "",
    includeArchived: false,
  })
  const [status, { refetch: refetchStatus }] = createResource(refresh, () => req<MiyaStatus>("/miya/status"))
  const [agents, { refetch: refetchAgents }] = createResource(refresh, () => req<AgentInfo[]>("/miya/agents"))
  const [jobs, { refetch: refetchJobs }] = createResource(refresh, () => req<MiyaJob[]>("/miya/jobs"))
  const [approvals, { refetch: refetchApprovals }] = createResource(refresh, () => req<MiyaApproval[]>("/miya/approvals"))
  const [history, { refetch: refetchHistory }] = createResource(refresh, () => req<MiyaHistory[]>("/miya/history?limit=20"))
  const [tools, { refetch: refetchTools }] = createResource(refresh, () => req<ToolInfo[]>("/miya/tools"))
  const [connectors, { refetch: refetchConnectors }] = createResource(refresh, () => req<ConnectorsState>("/miya/connectors"))
  const [selfApproval, { refetch: refetchSelfApproval }] = createResource(refresh, () =>
    req<SelfApprovalRecord[]>("/miya/self-approval?limit=120"),
  )
  const [runtimeState, { refetch: refetchRuntimeState }] = createResource(refresh, () => req<RuntimeState>("/miya/runtime"))
  const [skillPacks, { refetch: refetchSkillPacks }] = createResource(refresh, () => req<SkillPackState[]>("/miya/skills"))
  const [killSwitch, { refetch: refetchKillSwitch }] = createResource(refresh, () => req<KillSwitchState>("/miya/kill-switch"))
  const [secretStatus, { refetch: refetchSecretStatus }] = createResource(refresh, () => req<SecretStatus>("/miya/secrets/status"))
  const [memory, { refetch: refetchMemory }] = createResource(refresh, () => req<Record<string, unknown>>("/miya/memory"))
  const [loop, { refetch: refetchLoop }] = createResource(refresh, () => req<Record<string, LoopState>>("/miya/loop"))
  const [browserSessions, { refetch: refetchBrowserSessions }] = createResource(refresh, () => req<BrowserSession[]>("/miya/browser/session"))
  const [sessions, { refetch: refetchSessions }] = createResource(refresh, () =>
    req<MiyaSessionItem[]>(`/miya/sessions?limit=80${sessionControl.includeArchived ? "&include_archived=true" : ""}`),
  )
  const [sessionMessages, { refetch: refetchSessionMessages }] = createResource(
    () => ({ refresh: refresh(), sessionID: sessionControl.selected }),
    (input) =>
      input.sessionID
        ? req<MiyaSessionMessage[]>(`/miya/sessions/${encodeURIComponent(input.sessionID)}/messages?limit=60`)
        : Promise.resolve([] as MiyaSessionMessage[]),
  )
  const [clawraProfileRes, { refetch: refetchClawraProfile }] = createResource(refresh, () =>
    req<ClawraProfile>("/miya/clawra/profile"),
  )

  const list = createMemo(() => (agents() ?? []).filter(miyaAgents))
  const [edit, setEdit] = createStore<Record<string, { model?: string; temperature?: string; variant?: string }>>({})
  const [jobForm, setJobForm] = createStore({
    name: "",
    time: "09:00",
    command: "",
    requireApproval: false,
  })
  const [gateway, setGateway] = createStore({
    sessionID: "",
    agent: "1-task-manager",
    model: "",
    input: "",
    images: [] as GatewayImage[],
    audios: [] as GatewayAudio[],
    turnID: "",
    turn: undefined as GatewayTurn | undefined,
    running: false,
    eventSource: undefined as EventSource | undefined,
  })
  const [voice, setVoice] = createStore({
    input: "",
    connected: false,
    sessionID: "",
    transcript: "",
    reply: "",
    socket: undefined as WebSocket | undefined,
  })
  const [browser, setBrowser] = createStore({
    selected: "",
    url: "",
    action: "click",
    target: "",
    value: "",
    events: [] as string[],
    tabs: [] as Array<{ tab_id: string; index: number; url: string; title: string; active: boolean }>,
    snapshotText: "",
    stream: undefined as EventSource | undefined,
  })
  const [collab, setCollab] = createStore({
    fromSessionID: "",
    toSessionID: "",
    agent: "1-task-manager",
    model: "",
    input: "",
    includeContext: true,
    contextLimit: "10",
    output: "",
    running: false,
    spawnTask: "",
    spawnLabel: "",
    spawnTimeout: "0",
    spawnCleanup: false,
    spawnRunID: "",
    spawnStatus: "",
  })
  const [clawra, setClawra] = createStore({
    profile: {
      reference_photo: "",
      voice_sample: "",
      personality_prompt: "",
      nsfw_enabled: true,
      auto_persona: false,
      elevenlabs_voice_id: "",
      voice_backend_default: "elevenlabs" as "elevenlabs" | "coqui" | "rvc",
      selfie_mode_default: "auto" as "mirror" | "direct" | "auto",
    },
    secretDrafts: {
      fal: "",
      elevenlabs: "",
      webhook: "",
      slack: "",
      telegram: "",
    },
    selfiePrompt: "",
    selfieAspectRatio: "1:1",
    selfieMode: "auto" as "mirror" | "direct" | "auto",
    selfieImageURL: "",
    selfieRevisedPrompt: "",
    selfieBusy: false,
    voiceText: "",
    voiceID: "",
    voiceModel: "eleven_multilingual_v2",
    voiceProvider: "elevenlabs" as "elevenlabs" | "coqui" | "rvc",
    voiceFallbackCloud: true,
    voiceBusy: false,
    audioURL: "",
    runtimeBusy: false,
    runtimeReport: "",
  })
  let spawnPollTimer: ReturnType<typeof setInterval> | undefined
  const [toolInvoke, setToolInvoke] = createStore({
    name: "miya_status_panel",
    args: "{}",
    output: "",
    running: false,
    sessionID: "",
  })
  const [loopControl, setLoopControl] = createStore({
    sessionID: "",
    loopEnabled: true,
    autoContinue: true,
    maxIterationsPerWindow: "3",
    strictQualityGate: true,
  })
  const [memoryText, setMemoryText] = createSignal("{}")
  const filteredSessions = createMemo(() => {
    const keyword = sessionControl.search.trim().toLowerCase()
    return (sessions() ?? []).filter((item) => {
      if (!keyword) return true
      return item.title.toLowerCase().includes(keyword) || item.id.toLowerCase().includes(keyword)
    })
  })
  const selectedSession = createMemo(() =>
    (sessions() ?? []).find((item) => item.id === sessionControl.selected),
  )
  const latestMessages = createMemo(() => [...(sessionMessages() ?? [])].reverse())

  const refetchAll = async () => {
    setRefresh((x) => x + 1)
    await Promise.all([
      refetchStatus(),
      refetchAgents(),
      refetchJobs(),
      refetchApprovals(),
      refetchHistory(),
      refetchTools(),
      refetchConnectors(),
      refetchSelfApproval(),
      refetchRuntimeState(),
      refetchSkillPacks(),
      refetchKillSwitch(),
      refetchSecretStatus(),
      refetchMemory(),
      refetchLoop(),
      refetchBrowserSessions(),
      refetchSessions(),
      refetchSessionMessages(),
      refetchClawraProfile(),
    ])
  }

  const save = async (name: string) => {
    const current = edit[name] ?? {}
    const model = current.model?.trim()
    const temperature = current.temperature?.trim()
    const variant = current.variant?.trim()

    const body: Record<string, unknown> = {}
    if (model) body.model = model
    if (variant) body.variant = variant
    if (temperature) body.temperature = Number(temperature)

    await req<boolean>(`/miya/agents/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })
      .then(() => {
        showToast({ variant: "success", icon: "circle-check", title: "Saved", description: name })
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: msg })
      })

    await Promise.all([refetchAgents(), refetchStatus()])
  }

  const runJob = async (id: string) => {
    await req(`/miya/jobs/${encodeURIComponent(id)}/run`, { method: "POST" })
    await refetchAll()
  }

  const toggleJob = async (id: string, enabled: boolean) => {
    await req(`/miya/jobs/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ enabled }) })
    await refetchAll()
  }

  const deleteJob = async (id: string) => {
    await req(`/miya/jobs/${encodeURIComponent(id)}`, { method: "DELETE" })
    await refetchAll()
  }

  const createJob = async () => {
    if (!jobForm.name.trim() || !jobForm.command.trim()) return
    await req("/miya/jobs", {
      method: "POST",
      body: JSON.stringify({
        name: jobForm.name.trim(),
        time: jobForm.time.trim(),
        command: jobForm.command.trim(),
        require_approval: false,
      }),
    })
    setJobForm("name", "")
    setJobForm("command", "")
    await refetchAll()
  }

  const approve = async (id: string) => {
    await req(`/miya/approvals/${encodeURIComponent(id)}/approve`, { method: "POST" })
    await refetchAll()
  }

  const reject = async (id: string) => {
    await req(`/miya/approvals/${encodeURIComponent(id)}/reject`, { method: "POST" })
    await refetchAll()
  }

  const patchConnector = async (name: "webhook" | "slack" | "telegram", patch: Record<string, unknown>) => {
    await req(`/miya/connectors/${name}`, { method: "PATCH", body: JSON.stringify(patch) })
    await refetchConnectors()
    await refetchStatus()
  }

  const testConnector = async (name: "webhook" | "slack" | "telegram") => {
    await req(`/miya/connectors/${name}/test`, { method: "POST", body: JSON.stringify({}) })
    await refetchConnectors()
  }
  const setSkillEnabled = async (id: string, enabled: boolean) => {
    await req(`/miya/skills/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    })
    await refetchSkillPacks()
  }
  const setSkillLockVersion = async (id: string, lockedVersion: string) => {
    await req(`/miya/skills/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ locked_version: lockedVersion.trim() || undefined }),
    })
    await refetchSkillPacks()
  }
  const activateKillSwitch = async () => {
    await req("/miya/kill-switch/activate", {
      method: "POST",
      body: JSON.stringify({ reason: "manual emergency stop from cockpit" }),
    })
    await Promise.all([refetchKillSwitch(), refetchStatus(), refetchRuntimeState()])
  }
  const releaseKillSwitch = async () => {
    await req("/miya/kill-switch/release", { method: "POST" })
    await Promise.all([refetchKillSwitch(), refetchStatus(), refetchRuntimeState()])
  }

  const saveMemory = async () => {
    let current: Record<string, unknown>
    try {
      current = JSON.parse(memoryText()) as Record<string, unknown>
    } catch {
      showToast({ title: language.t("common.requestFailed"), description: "Invalid JSON" })
      return
    }
    await req("/miya/memory", {
      method: "PUT",
      body: JSON.stringify(current),
    })
    await refetchMemory()
  }

  const onGatewayImageChange = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const readDataUrl = (file: File) =>
      new Promise<GatewayImage>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () =>
          resolve({
            url: String(reader.result ?? ""),
            filename: file.name,
            mime: file.type || "image/png",
            size: file.size,
          })
        reader.onerror = () => reject(reader.error ?? new Error("failed to read file"))
        reader.readAsDataURL(file)
      })
    try {
      const next = await Promise.all(Array.from(files).map((f) => readDataUrl(f)))
      setGateway("images", (list) => [...list, ...next])
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const onGatewayAudioChange = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const readDataUrl = (file: File) =>
      new Promise<GatewayAudio>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () =>
          resolve({
            url: String(reader.result ?? ""),
            filename: file.name,
            mime: file.type || "audio/mpeg",
            size: file.size,
          })
        reader.onerror = () => reject(reader.error ?? new Error("failed to read file"))
        reader.readAsDataURL(file)
      })
    try {
      const next = await Promise.all(Array.from(files).map((f) => readDataUrl(f)))
      setGateway("audios", (list) => [...list, ...next])
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const runGateway = async () => {
    if (!gateway.input.trim() && gateway.images.length === 0 && gateway.audios.length === 0) return
    try {
      const result = await req<{ turn_id: string; session_id: string }>("/miya/gateway/turn", {
        method: "POST",
        body: JSON.stringify({
          session_id: gateway.sessionID.trim() || undefined,
          agent: gateway.agent.trim() || undefined,
          model: gateway.model.trim() || undefined,
          text: gateway.input.trim() || undefined,
          images: gateway.images.map((item) => ({
            url: item.url,
            filename: item.filename,
            mime: item.mime,
          })),
          audios: gateway.audios.map((item) => ({
            url: item.url,
            filename: item.filename,
            mime: item.mime,
          })),
        }),
      })
      gateway.eventSource?.close()
      const source = new EventSource(url(`/miya/gateway/stream/${encodeURIComponent(result.turn_id)}`))
      setGateway("eventSource", source)
      setGateway("turnID", result.turn_id)
      setGateway("sessionID", result.session_id)
      setGateway("running", true)
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as GatewayTurn
          setGateway("turn", payload)
          if (payload.status !== "running") {
            setGateway("running", false)
            setGateway("images", [])
            setGateway("audios", [])
            source.close()
          }
        } catch {}
      }
      source.onerror = () => {
        setGateway("running", false)
        source.close()
      }
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const startClawraWizard = async () => {
    setGateway("input", "/start")
    await runGateway()
  }

  const createSession = async () => {
    const created = await req<{ id: string; title: string }>("/miya/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "Miya Session" }),
    })
    setSessionControl("selected", created.id)
    setSessionControl("titleDraft", created.title)
    setGateway("sessionID", created.id)
    setCollab("toSessionID", created.id)
    await Promise.all([refetchSessions(), refetchSessionMessages(), refetchStatus()])
  }

  const saveSessionTitle = async () => {
    const sessionID = sessionControl.selected.trim()
    const title = sessionControl.titleDraft.trim()
    if (!sessionID || !title) return
    await req(`/miya/sessions/${encodeURIComponent(sessionID)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    })
    await refetchSessions()
  }

  const setSessionArchived = async (session: MiyaSessionItem, archived: boolean) => {
    await req(`/miya/sessions/${encodeURIComponent(session.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ archived }),
    })
    await refetchSessions()
  }

  const deleteSession = async (sessionID: string) => {
    await req(`/miya/sessions/${encodeURIComponent(sessionID)}`, { method: "DELETE" })
    if (sessionControl.selected === sessionID) {
      setSessionControl("selected", "")
      setSessionControl("titleDraft", "")
      setGateway("sessionID", "")
    }
    await Promise.all([refetchSessions(), refetchSessionMessages(), refetchStatus()])
  }

  const sendToSession = async () => {
    const toSessionID = collab.toSessionID.trim()
    const text = collab.input.trim()
    if (!toSessionID || !text) return
    setCollab("running", true)
    try {
      const result = await req<{ status: string; output?: string; error?: string }>(`/miya/sessions/${encodeURIComponent(toSessionID)}/send`, {
        method: "POST",
        body: JSON.stringify({
          text,
          agent: collab.agent.trim() || undefined,
          model: collab.model.trim() || undefined,
        }),
      })
      setCollab("output", result.output ?? result.error ?? result.status)
      setSessionControl("selected", toSessionID)
      await Promise.all([refetchSessions(), refetchSessionMessages(), refetchStatus()])
    } catch (error) {
      setCollab("output", error instanceof Error ? error.message : String(error))
    } finally {
      setCollab("running", false)
    }
  }

  const routeSessionMessage = async () => {
    const toSessionID = collab.toSessionID.trim()
    const text = collab.input.trim()
    if (!toSessionID || !text) return
    const contextLimit = Number(collab.contextLimit.trim())
    setCollab("running", true)
    try {
      const result = await req<{ status: string; output?: string; error?: string }>("/miya/sessions/route", {
        method: "POST",
        body: JSON.stringify({
          from_session_id: collab.fromSessionID.trim() || undefined,
          to_session_id: toSessionID,
          text,
          include_context: collab.includeContext,
          context_limit: Number.isFinite(contextLimit) && contextLimit > 0 ? Math.floor(contextLimit) : 10,
          agent: collab.agent.trim() || undefined,
          model: collab.model.trim() || undefined,
        }),
      })
      setCollab("output", result.output ?? result.error ?? result.status)
      setSessionControl("selected", toSessionID)
      await Promise.all([refetchSessions(), refetchSessionMessages(), refetchStatus()])
    } catch (error) {
      setCollab("output", error instanceof Error ? error.message : String(error))
    } finally {
      setCollab("running", false)
    }
  }

  const pollSpawnRun = (runID: string) => {
    if (spawnPollTimer) clearInterval(spawnPollTimer)
    let timer: ReturnType<typeof setInterval> | undefined
    const poll = async () => {
      try {
        const run = await req<SessionSpawnRun>(`/miya/sessions/spawn/${encodeURIComponent(runID)}`)
        setCollab("spawnStatus", run.status)
        if (run.output) setCollab("output", run.output)
        if (run.error) setCollab("output", run.error)
        if (run.status !== "running") {
          if (timer) clearInterval(timer)
          spawnPollTimer = undefined
          setCollab("spawnRunID", run.id)
          if (run.child_session_id) {
            setSessionControl("selected", run.child_session_id)
            setCollab("toSessionID", run.child_session_id)
          }
          await Promise.all([refetchSessions(), refetchSessionMessages(), refetchStatus()])
        }
      } catch {
        if (timer) clearInterval(timer)
        spawnPollTimer = undefined
      }
    }
    timer = setInterval(() => void poll(), 1000)
    spawnPollTimer = timer
    void poll()
  }

  const spawnSessionTask = async () => {
    const task = collab.spawnTask.trim()
    if (!task) return
    const timeout = Number(collab.spawnTimeout.trim())
    setCollab("running", true)
    try {
      const result = await req<
        | { run_id: string; status: string; child_session_id: string; error?: string }
        | SessionSpawnRun
      >("/miya/sessions/spawn", {
        method: "POST",
        body: JSON.stringify({
          task,
          label: collab.spawnLabel.trim() || undefined,
          parent_session_id: collab.fromSessionID.trim() || undefined,
          agent: collab.agent.trim() || undefined,
          model: collab.model.trim() || undefined,
          timeout_seconds: Number.isFinite(timeout) && timeout >= 0 ? Math.floor(timeout) : 0,
          cleanup: collab.spawnCleanup ? "delete" : "keep",
        }),
      })
      if ("id" in result) {
        setCollab("spawnRunID", result.id)
        setCollab("spawnStatus", result.status)
        setCollab("toSessionID", result.child_session_id)
        setCollab("output", result.output ?? result.error ?? "")
      } else {
        setCollab("spawnRunID", result.run_id)
        setCollab("spawnStatus", result.status)
        setCollab("toSessionID", result.child_session_id)
        if (result.error) setCollab("output", result.error)
        if (result.status === "accepted") pollSpawnRun(result.run_id)
      }
      await refetchSessions()
    } catch (error) {
      setCollab("output", error instanceof Error ? error.message : String(error))
    } finally {
      setCollab("running", false)
    }
  }

  const saveClawraProfile = async () => {
    const payload = {
      reference_photo: clawra.profile.reference_photo.trim() || undefined,
      voice_sample: clawra.profile.voice_sample.trim() || undefined,
      personality_prompt: clawra.profile.personality_prompt.trim() || undefined,
      nsfw_enabled: clawra.profile.nsfw_enabled,
      auto_persona: clawra.profile.auto_persona,
      elevenlabs_voice_id: clawra.profile.elevenlabs_voice_id.trim() || undefined,
      voice_backend_default: clawra.profile.voice_backend_default,
      selfie_mode_default: clawra.profile.selfie_mode_default,
    }
    await req<ClawraProfile>("/miya/clawra/profile", {
      method: "PUT",
      body: JSON.stringify(payload),
    })
    await refetchClawraProfile()
    showToast({ variant: "success", icon: "circle-check", title: "Saved", description: "Clawra profile updated" })
  }

  const saveSecret = async (provider: "fal" | "elevenlabs" | "webhook" | "slack" | "telegram") => {
    const value = clawra.secretDrafts[provider].trim()
    if (!value) return
    await req(`/miya/secrets/${provider}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    })
    setClawra("secretDrafts", provider, "")
    await refetchSecretStatus()
    showToast({ variant: "success", icon: "circle-check", title: "Saved", description: `${provider} secret updated` })
  }
  const runVoiceRuntimeTool = async (
    toolName: "miya_voice_status" | "miya_voice_install" | "miya_voice_up" | "miya_voice_down" | "miya_voice_doctor",
    args?: Record<string, unknown>,
  ) => {
    setClawra("runtimeBusy", true)
    try {
      const result = await req<{ output: string }>("/miya/tools/invoke", {
        method: "POST",
        body: JSON.stringify({
          tool: toolName,
          args: args ?? {},
        }),
      })
      setClawra("runtimeReport", result.output ?? "")
      showToast({ variant: "success", icon: "circle-check", title: "Voice Runtime", description: toolName })
    } catch (error) {
      setClawra("runtimeReport", error instanceof Error ? error.message : String(error))
    } finally {
      setClawra("runtimeBusy", false)
      await refetchSecretStatus()
    }
  }

  const generateClawraSelfie = async () => {
    if (!clawra.selfiePrompt.trim()) return
    setClawra("selfieBusy", true)
    try {
      const result = await req<{ image_url: string; revised_prompt?: string }>("/miya/clawra/selfie", {
        method: "POST",
        body: JSON.stringify({
          prompt: clawra.selfiePrompt.trim(),
          mode: clawra.selfieMode,
          aspect_ratio: clawra.selfieAspectRatio.trim() || undefined,
          include_persona: true,
        }),
      })
      setClawra("selfieImageURL", result.image_url)
      setClawra("selfieRevisedPrompt", result.revised_prompt ?? "")
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setClawra("selfieBusy", false)
    }
  }

  const speakClawraVoice = async () => {
    if (!clawra.voiceText.trim()) return
    setClawra("voiceBusy", true)
    try {
      const result = await req<{ voice_id?: string; audio_base64: string; provider?: string; fallback_from?: string }>("/miya/clawra/voice/speak", {
        method: "POST",
        body: JSON.stringify({
          text: clawra.voiceText.trim(),
          provider: clawra.voiceProvider,
          voice_id: clawra.voiceID.trim() || undefined,
          model_id: clawra.voiceModel.trim() || undefined,
          fallback_to_cloud: clawra.voiceFallbackCloud,
        }),
      })
      const bytes = Uint8Array.from(atob(result.audio_base64), (char) => char.charCodeAt(0))
      const blob = new Blob([bytes], { type: "audio/mpeg" })
      const nextUrl = URL.createObjectURL(blob)
      if (clawra.audioURL) URL.revokeObjectURL(clawra.audioURL)
      setClawra("audioURL", nextUrl)
      if (result.voice_id) setClawra("voiceID", result.voice_id)
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setClawra("voiceBusy", false)
    }
  }

  const invokeTool = async () => {
    if (!toolInvoke.name.trim()) return
    let args: Record<string, unknown>
    try {
      args = JSON.parse(toolInvoke.args || "{}") as Record<string, unknown>
    } catch {
      showToast({ title: language.t("common.requestFailed"), description: "Invalid JSON args" })
      return
    }
    setToolInvoke("running", true)
    try {
      const result = await req<{ output: string }>("/miya/tools/invoke", {
        method: "POST",
        body: JSON.stringify({
          tool: toolInvoke.name.trim(),
          args,
          session_id: toolInvoke.sessionID.trim() || undefined,
        }),
      })
      setToolInvoke("output", result.output ?? "")
    } catch (error) {
      setToolInvoke("output", error instanceof Error ? error.message : String(error))
    } finally {
      setToolInvoke("running", false)
      await Promise.all([refetchStatus(), refetchLoop()])
    }
  }

  const applyLoopControl = async () => {
    if (!loopControl.sessionID.trim()) return
    const maxValue = Number(loopControl.maxIterationsPerWindow.trim())
    if (!Number.isFinite(maxValue) || maxValue < 1) {
      showToast({ title: language.t("common.requestFailed"), description: "maxIterationsPerWindow must be >= 1" })
      return
    }
    await req(`/miya/loop/${encodeURIComponent(loopControl.sessionID.trim())}`, {
      method: "PATCH",
      body: JSON.stringify({
        loopEnabled: loopControl.loopEnabled,
        autoContinue: loopControl.autoContinue,
        maxIterationsPerWindow: Math.floor(maxValue),
        strictQualityGate: loopControl.strictQualityGate,
      }),
    })
    await refetchLoop()
  }

  const connectVoice = () => {
    if (voice.connected) return
    const endpoint = new URL(url("/miya/voice/ws"))
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:"
    const socket = new WebSocket(endpoint.toString())
    socket.onopen = () => setVoice("connected", true)
    socket.onclose = () => {
      setVoice("connected", false)
      setVoice("socket", undefined)
    }
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as { type?: string; text?: string; session_id?: string; error?: string }
        if (payload.type === "stt.final") {
          setVoice("transcript", payload.text ?? "")
          setVoice("sessionID", payload.session_id ?? "")
        }
        if (payload.type === "assistant.text.delta") {
          setVoice("reply", (current) => `${current}${payload.text ?? ""}`)
          setVoice("sessionID", payload.session_id ?? "")
        }
        if (payload.type === "assistant.text") {
          setVoice("reply", payload.text ?? "")
          setVoice("sessionID", payload.session_id ?? "")
          if (payload.text && typeof speechSynthesis !== "undefined") {
            const utterance = new SpeechSynthesisUtterance(payload.text)
            speechSynthesis.cancel()
            speechSynthesis.speak(utterance)
          }
        }
        if (payload.type === "voice.error") {
          setVoice("reply", payload.error ?? "voice error")
        }
      } catch {}
    }
    setVoice("socket", socket)
  }

  const sendVoiceText = () => {
    const text = voice.input.trim()
    if (!text || !voice.socket) return
    voice.socket.send(JSON.stringify({ type: "text", text, session_id: voice.sessionID || undefined }))
    setVoice("input", "")
  }

  const interruptVoice = () => {
    voice.socket?.send(JSON.stringify({ type: "interrupt" }))
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel()
  }

  const createBrowserSession = async () => {
    const created = await req<BrowserSession>("/miya/browser/session", {
      method: "POST",
      body: JSON.stringify({ url: browser.url || undefined }),
    })
    setBrowser("selected", created.id)
    await refetchBrowserSessions()
    await browserLoadTabs()
  }

  const browserStart = async () => {
    if (!browser.selected) return
    await req("/miya/browser/start", {
      method: "POST",
      body: JSON.stringify({ session_id: browser.selected }),
    })
    await Promise.all([refetchBrowserSessions(), browserLoadTabs()])
  }

  const browserStop = async () => {
    if (!browser.selected) return
    await req("/miya/browser/stop", {
      method: "POST",
      body: JSON.stringify({ session_id: browser.selected }),
    })
    await refetchBrowserSessions()
  }

  const browserLoadTabs = async () => {
    if (!browser.selected) return
    const tabs = await req<Array<{ tab_id: string; index: number; url: string; title: string; active: boolean }>>(
      `/miya/browser/tabs?session_id=${encodeURIComponent(browser.selected)}`,
    )
    setBrowser("tabs", tabs)
  }

  const browserOpenTab = async () => {
    if (!browser.selected || !browser.url.trim()) return
    await req("/miya/browser/open", {
      method: "POST",
      body: JSON.stringify({ session_id: browser.selected, url: browser.url.trim() }),
    })
    await Promise.all([refetchBrowserSessions(), browserLoadTabs()])
  }

  const browserFocusTab = async (tabID: string) => {
    if (!browser.selected) return
    await req("/miya/browser/focus", {
      method: "POST",
      body: JSON.stringify({ session_id: browser.selected, tab_id: tabID }),
    })
    await Promise.all([refetchBrowserSessions(), browserLoadTabs()])
  }

  const browserSnapshot = async () => {
    if (!browser.selected) return
    const snapshot = await req<{ text: string; summary?: string; refs?: Record<string, string> }>("/miya/browser/snapshot", {
      method: "POST",
      body: JSON.stringify({ session_id: browser.selected, max_chars: 6000 }),
    })
    const refs = snapshot.refs
      ? Object.entries(snapshot.refs)
          .map(([key, value]) => `ref:${key} -> ${value}`)
          .join("\n")
      : ""
    setBrowser("snapshotText", [snapshot.summary ?? "", snapshot.text ?? "", refs].filter(Boolean).join("\n\n"))
  }

  const browserLoadConsole = async () => {
    if (!browser.selected) return
    const rows = await req<Array<{ type: string; data?: { text?: string; message?: string } }>>(
      `/miya/browser/console?session_id=${encodeURIComponent(browser.selected)}&limit=50`,
    )
    setBrowser(
      "events",
      rows.map((row) => row.data?.text || row.data?.message || row.type),
    )
  }

  const openBrowserStream = (sessionID: string) => {
    browser.stream?.close()
    const source = new EventSource(url(`/miya/browser/session/${encodeURIComponent(sessionID)}/stream`))
    setBrowser("stream", source)
    setBrowser("events", [])
    source.onmessage = (event) => setBrowser("events", (list) => [event.data, ...list].slice(0, 50))
    source.onerror = () => source.close()
  }

  const browserNavigate = async () => {
    if (!browser.selected || !browser.url.trim()) return
    await req(`/miya/browser/session/${encodeURIComponent(browser.selected)}/navigate`, {
      method: "POST",
      body: JSON.stringify({ url: browser.url.trim() }),
    })
    await refetchBrowserSessions()
    await browserLoadTabs()
  }

  const browserAction = async () => {
    if (!browser.selected || !browser.action.trim()) return
    await req(`/miya/browser/session/${encodeURIComponent(browser.selected)}/action`, {
      method: "POST",
      body: JSON.stringify({
        action: browser.action.trim(),
        target: browser.target || undefined,
        value: browser.value || undefined,
      }),
    })
    await refetchBrowserSessions()
    await browserLoadConsole()
  }

  const deleteBrowserSession = async (id: string) => {
    await req(`/miya/browser/session/${encodeURIComponent(id)}`, { method: "DELETE" })
    if (browser.selected === id) {
      setBrowser("selected", "")
      browser.stream?.close()
      setBrowser("stream", undefined)
    }
    await refetchBrowserSessions()
    setBrowser("tabs", [])
    setBrowser("snapshotText", "")
  }

  const statusLine = (k: string, v: unknown) => (
    <div class="flex items-center justify-between gap-2 py-2 border-b border-border-weak-base last:border-none">
      <span class="text-12-regular text-text-weak">{k}</span>
      <span class="text-12-medium text-text-strong">{String(v)}</span>
    </div>
  )

  createEffect(() => {
    const current = memory()
    if (!current) return
    setMemoryText(JSON.stringify(current, null, 2))
  })

  createEffect(() => {
    const profile = clawraProfileRes()
    if (!profile) return
    setClawra("profile", {
      reference_photo: profile.reference_photo ?? "",
      voice_sample: profile.voice_sample ?? "",
      personality_prompt: profile.personality_prompt ?? "",
      nsfw_enabled: profile.nsfw_enabled ?? true,
      auto_persona: profile.auto_persona ?? false,
      elevenlabs_voice_id: profile.elevenlabs_voice_id ?? "",
      voice_backend_default: profile.voice_backend_default ?? "elevenlabs",
      selfie_mode_default: profile.selfie_mode_default ?? "auto",
    })
    if (!clawra.voiceID && profile.elevenlabs_voice_id) {
      setClawra("voiceID", profile.elevenlabs_voice_id)
    }
    setClawra("voiceProvider", profile.voice_backend_default ?? "elevenlabs")
    setClawra("selfieMode", profile.selfie_mode_default ?? "auto")
  })

  createEffect(() => {
    const sessions = loop()
    if (!sessions) return
    const firstID = Object.keys(sessions)[0]
    if (!firstID) return
    if (loopControl.sessionID) return
    const state = sessions[firstID]
    setLoopControl({
      sessionID: firstID,
      loopEnabled: state?.loopEnabled ?? true,
      autoContinue: state?.autoContinue ?? true,
      maxIterationsPerWindow: String(state?.maxIterationsPerWindow ?? 3),
      strictQualityGate: state?.strictQualityGate ?? true,
    })
  })

  createEffect(() => {
    const list = sessions()
    if (!list || list.length === 0) return
    if (!sessionControl.selected || !list.some((item) => item.id === sessionControl.selected)) {
      setSessionControl("selected", list[0].id)
      setSessionControl("titleDraft", list[0].title)
      if (!gateway.sessionID) setGateway("sessionID", list[0].id)
      if (!collab.toSessionID) setCollab("toSessionID", list[0].id)
      return
    }
    const selected = list.find((item) => item.id === sessionControl.selected)
    if (selected && sessionControl.titleDraft !== selected.title) {
      setSessionControl("titleDraft", selected.title)
    }
  })

  createEffect(() => {
    onCleanup(() => {
      gateway.eventSource?.close()
      voice.socket?.close()
      browser.stream?.close()
      if (spawnPollTimer) clearInterval(spawnPollTimer)
      if (clawra.audioURL) URL.revokeObjectURL(clawra.audioURL)
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel()
    })
  })

  return (
    <div data-component="miya-panel" class="flex flex-col h-full overflow-hidden">
      <Tabs orientation="vertical" variant="settings" defaultValue="autopilot" class="h-full">
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-3 w-full pt-3">
              <div class="flex flex-col gap-1.5">
                <Tabs.SectionTitle>{language.t("sidebar.miya")}</Tabs.SectionTitle>
                <div class="flex flex-col gap-1.5 w-full">
                  <Tabs.Trigger value="autopilot">
                    <Icon name="bullet-list" />
                    Autopilot
                  </Tabs.Trigger>
                  <Tabs.Trigger value="self-approval">
                    <Icon name="checklist" />
                    Self-Approval
                  </Tabs.Trigger>
                  <Tabs.Trigger value="runtime">
                    <Icon name="link" />
                    Runtime
                  </Tabs.Trigger>
                  <Tabs.Trigger value="jobs">
                    <Icon name="bullet-list" />
                    Jobs
                  </Tabs.Trigger>
                  <Tabs.Trigger value="skills">
                    <Icon name="models" />
                    Skills
                  </Tabs.Trigger>
                  <Tabs.Trigger value="killswitch">
                    <Icon name="selector" />
                    Kill Switch
                  </Tabs.Trigger>
                </div>
              </div>
            </div>
          </div>
        </Tabs.List>

        <Tabs.Content value="autopilot" class="no-scrollbar">
          <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
            <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
              <h2 class="text-16-medium text-text-strong">Autopilot 状态</h2>
              <Show
                when={status()}
                fallback={
                  <div class="text-12-regular text-text-weak">
                    {language.t("common.loading")}
                    {language.t("common.loading.ellipsis")}
                  </div>
                }
              >
                {(s) => (
                  <div class="bg-surface-raised-base px-4 rounded-lg">
                    {statusLine("autopilot_mode", s().autopilot_mode ?? "full")}
                    {statusLine("loop_cycle_limit", s().loop_cycle_limit ?? 3)}
                    {statusLine("jobs_total", s().jobs_total)}
                    {statusLine("jobs_enabled", s().jobs_enabled)}
                    {statusLine("self_approval_records", s().self_approval_records ?? 0)}
                    {statusLine("loop_paused_sessions", s().loop_paused_sessions)}
                    {statusLine("connectors_enabled", s().connectors_enabled)}
                    {statusLine("kill_switch_active", String(s().kill_switch_active ?? false))}
                  </div>
                )}
              </Show>
              <Show when={runtimeState()}>
                {(runtime) => (
                  <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-1">
                    <div class="text-12-medium text-text-strong">Gateway</div>
                    <div class="text-12-regular text-text-weak">transport={runtime().gateway.transport}</div>
                    <div class="text-12-regular text-text-weak">same_port_control_plane={String(runtime().gateway.same_port_control_plane)}</div>
                    <div class="text-12-regular text-text-weak">active_turns={runtime().gateway.active_turns}</div>
                  </div>
                )}
              </Show>
              <Button size="large" variant="secondary" onClick={() => refetchAll()}>
                Refresh
              </Button>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="jobs" class="no-scrollbar">
          <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
            <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
              <h2 class="text-16-medium text-text-strong">Jobs（自动化）</h2>
              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                <TextField variant="ghost" value={jobForm.name} placeholder="job name" onChange={(v) => setJobForm("name", v)} />
                <TextField variant="ghost" value={jobForm.time} placeholder="HH:mm" onChange={(v) => setJobForm("time", v)} />
                <TextField
                  variant="ghost"
                  value={jobForm.command}
                  placeholder="command"
                  onChange={(v) => setJobForm("command", v)}
                />
                <label class="text-12-regular text-text-weak flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked
                    disabled
                  />
                  manual approval disabled, always self-approved
                </label>
                <div class="flex items-center justify-end">
                  <Button size="large" variant="secondary" onClick={createJob}>
                    Create Job
                  </Button>
                </div>
              </div>
              <For each={jobs() ?? []}>
                {(job) => (
                  <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                    <div class="text-14-medium text-text-strong">{job.name}</div>
                    <div class="text-12-regular text-text-weak">
                      {job.id} | daily {job.schedule.time} | next {job.nextRunAt}
                    </div>
                    <div class="text-12-regular text-text-weak">{job.action.command}</div>
                    <div class="flex items-center gap-2">
                      <Button size="large" variant="secondary" onClick={() => runJob(job.id)}>
                        Run
                      </Button>
                      <Button size="large" variant="secondary" onClick={() => toggleJob(job.id, !job.enabled)}>
                        {job.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button size="large" variant="ghost" onClick={() => deleteJob(job.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
              </For>
              <div class="bg-surface-raised-base px-4 rounded-lg py-3">
                <div class="text-14-medium text-text-strong pb-2">Recent Runs</div>
                <For each={history() ?? []}>
                  {(item) => (
                    <div class="text-12-regular text-text-weak border-b border-border-weak-base py-1 last:border-none">
                      {item.startedAt} | {item.jobName} | {item.status} | {String(item.exitCode)}
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="self-approval" class="no-scrollbar">
          <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
            <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
              <h2 class="text-16-medium text-text-strong">Self-Approval（自我审批）</h2>
              <div class="text-12-regular text-text-weak">
                每个副作用动作都由 Executor + Verifier 记录证据，不需要你手动批准。
              </div>
              <For each={selfApproval() ?? []}>
                {(item) => (
                  <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                    <div class="text-14-medium text-text-strong">{item.action}</div>
                    <div class="text-12-regular text-text-weak">
                      status={item.status} | created={item.created_at} | duration_ms={item.duration_ms}
                    </div>
                    <div class="text-12-regular text-text-weak">
                      verifier={item.verifier.verdict} | checks={item.verifier.checks.join(", ")}
                    </div>
                    <Show when={item.verifier.evidence.length > 0}>
                      <div class="text-12-regular text-text-weak whitespace-pre-wrap">
                        evidence: {item.verifier.evidence.join(" | ")}
                      </div>
                    </Show>
                    <div class="text-12-regular text-text-weak">rollback: {item.rollback.strategy}</div>
                    <Show when={item.error}>
                      {(error) => <div class="text-12-regular text-danger-base whitespace-pre-wrap">{error()}</div>}
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="skills" class="no-scrollbar">
          <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
            <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
              <h2 class="text-16-medium text-text-strong">Skills（包管理）</h2>
              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                <div class="text-12-medium text-text-strong">Project Skill Packs</div>
                <For each={skillPacks() ?? []}>
                  {(skill) => (
                    <div class="border-b border-border-weak-base last:border-none py-2 flex flex-col gap-2">
                      <div class="text-12-regular text-text-weak">{skill.id}</div>
                      <div class="flex items-center gap-2">
                        <label class="text-12-regular text-text-weak flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={skill.enabled}
                            onChange={(event) => void setSkillEnabled(skill.id, event.currentTarget.checked)}
                          />
                          enabled
                        </label>
                        <TextField
                          variant="ghost"
                          value={skill.locked_version ?? ""}
                          placeholder="locked version (optional)"
                          onChange={(v) => void setSkillLockVersion(skill.id, v)}
                          class="flex-1"
                        />
                      </div>
                    </div>
                  )}
                </For>
              </div>
              <Show
                when={agents()}
                fallback={
                  <div class="text-12-regular text-text-weak">
                    {language.t("common.loading")}
                    {language.t("common.loading.ellipsis")}
                  </div>
                }
              >
                <div class="flex flex-col gap-3">
                  <div class="text-12-regular text-text-weak">Agent-level skill routing and model overrides</div>
                  <For each={list()}>
                    {(a) => {
                      const initial = `${a.model?.providerID ?? ""}/${a.model?.modelID ?? ""}`.replace(/^\/$/, "")
                      const name = a.name
                      return (
                        <div class="bg-surface-raised-base px-4 rounded-lg">
                          <div class="py-3 border-b border-border-weak-base">
                            <div class="text-14-medium text-text-strong">{name}</div>
                            <Show when={a.description}>
                              {(d) => <div class="text-12-regular text-text-weak">{d()}</div>}
                            </Show>
                          </div>
                          <div class="py-3 flex flex-col gap-2">
                            <div class="flex items-center gap-2">
                              <span class="text-12-regular text-text-weak w-16">model</span>
                              <TextField
                                variant="ghost"
                                value={edit[name]?.model ?? initial}
                                placeholder="provider/model"
                                onChange={(v) => setEdit(name, "model", v)}
                                class="flex-1"
                              />
                            </div>
                            <div class="flex items-center gap-2">
                              <span class="text-12-regular text-text-weak w-16">temp</span>
                              <TextField
                                variant="ghost"
                                value={edit[name]?.temperature ?? (a.temperature !== undefined ? String(a.temperature) : "")}
                                placeholder="0.1"
                                onChange={(v) => setEdit(name, "temperature", v)}
                                class="flex-1"
                              />
                            </div>
                            <div class="flex items-center gap-2">
                              <span class="text-12-regular text-text-weak w-16">variant</span>
                              <TextField
                                variant="ghost"
                                value={edit[name]?.variant ?? (a.variant ?? "")}
                                placeholder="(optional)"
                                onChange={(v) => setEdit(name, "variant", v)}
                                class="flex-1"
                              />
                            </div>
                            <div class="flex items-center justify-end pt-1">
                              <Button size="large" variant="secondary" onClick={() => save(name)}>
                                Save
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="sessions" class="no-scrollbar">
          <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
            <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
              <h2 class="text-16-medium text-text-strong">Sessions</h2>
              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                <TextField
                  variant="ghost"
                  value={sessionControl.search}
                  placeholder="search by title or id"
                  onChange={(v) => setSessionControl("search", v)}
                />
                <label class="text-12-regular text-text-weak flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={sessionControl.includeArchived}
                    onChange={(event) => {
                      setSessionControl("includeArchived", event.currentTarget.checked)
                      void refetchSessions()
                    }}
                  />
                  include archived
                </label>
                <div class="flex items-center gap-2">
                  <Button size="large" variant="secondary" onClick={createSession}>
                    New Session
                  </Button>
                  <Button size="large" variant="secondary" onClick={() => refetchSessions()}>
                    Refresh
                  </Button>
                </div>
              </div>

              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                <div class="text-12-medium text-text-strong">Session List</div>
                <For each={filteredSessions()}>
                  {(session) => (
                    <div class="border-b border-border-weak-base last:border-none py-2 flex flex-col gap-2">
                      <button
                        type="button"
                        class="text-left"
                        onClick={() => {
                          setSessionControl("selected", session.id)
                          setSessionControl("titleDraft", session.title)
                          setGateway("sessionID", session.id)
                          setCollab("toSessionID", session.id)
                        }}
                      >
                        <div class="text-12-medium text-text-strong">
                          {session.id === sessionControl.selected ? "● " : ""}
                          {session.title}
                        </div>
                        <div class="text-12-regular text-text-weak">
                          id={session.id} | status={session.status.type} | archived={String(session.archived)} | updated={session.updated_at}
                        </div>
                      </button>
                      <div class="flex items-center gap-2">
                        <Button
                          size="large"
                          variant="secondary"
                          onClick={() => setSessionArchived(session, !session.archived)}
                        >
                          {session.archived ? "Unarchive" : "Archive"}
                        </Button>
                        <Button size="large" variant="ghost" onClick={() => deleteSession(session.id)}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  )}
                </For>
              </div>

              <Show when={selectedSession()}>
                {(selected) => (
                  <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                    <div class="text-12-medium text-text-strong">Selected Session</div>
                    <div class="text-12-regular text-text-weak">id={selected().id}</div>
                    <TextField
                      variant="ghost"
                      value={sessionControl.titleDraft}
                      placeholder="session title"
                      onChange={(v) => setSessionControl("titleDraft", v)}
                    />
                    <div class="flex items-center gap-2">
                      <Button size="large" variant="secondary" onClick={saveSessionTitle}>
                        Save Title
                      </Button>
                      <Button
                        size="large"
                        variant="secondary"
                        onClick={() => {
                          setGateway("sessionID", selected().id)
                          setCollab("toSessionID", selected().id)
                          showToast({ variant: "success", icon: "circle-check", title: "Gateway session selected", description: selected().id })
                        }}
                      >
                        Use In Gateway
                      </Button>
                    </div>
                  </div>
                )}
              </Show>

              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                <div class="text-12-medium text-text-strong">Session Collaboration</div>
                <TextField
                  variant="ghost"
                  value={collab.fromSessionID}
                  placeholder="from session id (optional)"
                  onChange={(v) => setCollab("fromSessionID", v)}
                />
                <TextField
                  variant="ghost"
                  value={collab.toSessionID}
                  placeholder="to session id (required)"
                  onChange={(v) => setCollab("toSessionID", v)}
                />
                <TextField
                  variant="ghost"
                  value={collab.agent}
                  placeholder="agent (optional)"
                  onChange={(v) => setCollab("agent", v)}
                />
                <TextField
                  variant="ghost"
                  value={collab.model}
                  placeholder="provider/model (optional)"
                  onChange={(v) => setCollab("model", v)}
                />
                <textarea
                  class="w-full min-h-[96px] bg-surface-raised-base border border-border-weak-base rounded-md px-3 py-2 text-12-regular text-text-strong"
                  value={collab.input}
                  onInput={(event) => setCollab("input", event.currentTarget.value)}
                  placeholder="message text"
                />
                <div class="flex items-center gap-2">
                  <label class="text-12-regular text-text-weak flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={collab.includeContext}
                      onChange={(event) => setCollab("includeContext", event.currentTarget.checked)}
                    />
                    include context
                  </label>
                  <TextField
                    variant="ghost"
                    value={collab.contextLimit}
                    placeholder="context limit"
                    onChange={(v) => setCollab("contextLimit", v)}
                  />
                </div>
                <div class="flex items-center gap-2">
                  <Button size="large" variant="secondary" onClick={sendToSession}>
                    {collab.running ? "Running..." : "Send"}
                  </Button>
                  <Button size="large" variant="secondary" onClick={routeSessionMessage}>
                    {collab.running ? "Running..." : "Route"}
                  </Button>
                </div>
                <div class="text-12-regular text-text-weak whitespace-pre-wrap">{collab.output || "(no output)"}</div>
              </div>

              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                <div class="text-12-medium text-text-strong">Spawn Sub Session</div>
                <TextField
                  variant="ghost"
                  value={collab.spawnLabel}
                  placeholder="label (optional)"
                  onChange={(v) => setCollab("spawnLabel", v)}
                />
                <textarea
                  class="w-full min-h-[96px] bg-surface-raised-base border border-border-weak-base rounded-md px-3 py-2 text-12-regular text-text-strong"
                  value={collab.spawnTask}
                  onInput={(event) => setCollab("spawnTask", event.currentTarget.value)}
                  placeholder="sub-agent task"
                />
                <div class="flex items-center gap-2">
                  <TextField
                    variant="ghost"
                    value={collab.spawnTimeout}
                    placeholder="wait timeout seconds (0=async)"
                    onChange={(v) => setCollab("spawnTimeout", v)}
                  />
                  <label class="text-12-regular text-text-weak flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={collab.spawnCleanup}
                      onChange={(event) => setCollab("spawnCleanup", event.currentTarget.checked)}
                    />
                    delete child after run
                  </label>
                </div>
                <div class="flex items-center gap-2">
                  <Button size="large" variant="secondary" onClick={spawnSessionTask}>
                    {collab.running ? "Running..." : "Spawn"}
                  </Button>
                  <div class="text-12-regular text-text-weak">
                    run={collab.spawnRunID || "(none)"} | status={collab.spawnStatus || "(none)"}
                  </div>
                </div>
              </div>

              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-1">
                <div class="text-12-medium text-text-strong">Recent Messages</div>
                <For each={latestMessages()}>
                  {(message) => (
                    <div class="text-12-regular text-text-weak border-b border-border-weak-base last:border-none py-1 whitespace-pre-wrap">
                      [{message.role}] {message.agent ? `${message.agent} | ` : ""}{message.created_at}
                      {"\n"}
                      {message.text || "(empty)"}
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="gateway" class="no-scrollbar">
          <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
            <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
              <h2 class="text-16-medium text-text-strong">Gateway</h2>
              <TextField
                variant="ghost"
                value={gateway.sessionID}
                placeholder="session id (optional)"
                onChange={(v) => setGateway("sessionID", v)}
              />
              <TextField
                variant="ghost"
                value={gateway.agent}
                placeholder="agent (optional)"
                onChange={(v) => setGateway("agent", v)}
              />
              <TextField
                variant="ghost"
                value={gateway.model}
                placeholder="provider/model (optional)"
                onChange={(v) => setGateway("model", v)}
              />
              <TextField
                variant="ghost"
                value={gateway.input}
                placeholder="turn input（输入 /start 启动向导）"
                onChange={(v) => setGateway("input", v)}
              />
              <div class="text-12-regular text-text-weak">Optional images (local upload, sent as data URL)</div>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => {
                  void onGatewayImageChange(event.currentTarget.files)
                  event.currentTarget.value = ""
                }}
              />
              <div class="text-12-regular text-text-weak">Optional audio (local upload, sent as data URL)</div>
              <input
                type="file"
                accept="audio/*"
                multiple
                onChange={(event) => {
                  void onGatewayAudioChange(event.currentTarget.files)
                  event.currentTarget.value = ""
                }}
              />
              <Show when={gateway.images.length > 0}>
                <div class="bg-surface-raised-base px-4 rounded-lg py-2 flex flex-col gap-2">
                  <For each={gateway.images}>
                    {(image, index) => (
                      <div class="flex items-center justify-between gap-2 border-b border-border-weak-base last:border-none py-1">
                        <div class="text-12-regular text-text-weak truncate">
                          {image.filename ?? "image"} | {Math.ceil(image.size / 1024)} KB
                        </div>
                        <Button size="large" variant="ghost" onClick={() => setGateway("images", (list) => list.filter((_, i) => i !== index()))}>
                          Remove
                        </Button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={gateway.audios.length > 0}>
                <div class="bg-surface-raised-base px-4 rounded-lg py-2 flex flex-col gap-2">
                  <For each={gateway.audios}>
                    {(audio, index) => (
                      <div class="flex items-center justify-between gap-2 border-b border-border-weak-base last:border-none py-1">
                        <div class="text-12-regular text-text-weak truncate">
                          {audio.filename ?? "audio"} | {Math.ceil(audio.size / 1024)} KB
                        </div>
                        <Button size="large" variant="ghost" onClick={() => setGateway("audios", (list) => list.filter((_, i) => i !== index()))}>
                          Remove
                        </Button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <div class="flex items-center gap-2">
                <Button size="large" variant="secondary" onClick={startClawraWizard}>
                  /start
                </Button>
                <Button size="large" variant="secondary" onClick={runGateway}>
                  Run Turn
                </Button>
                <Show when={gateway.running}>
                  <div class="text-12-regular text-text-weak">running...</div>
                </Show>
              </div>
              <Show when={gateway.turn}>
                {(turn) => (
                  <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                    <div class="text-12-regular text-text-weak">turn={gateway.turnID}</div>
                    <div class="text-12-regular text-text-weak">session={gateway.sessionID || "(auto)"}</div>
                    <div class="text-12-medium text-text-strong">status={turn().status}</div>
                    <Show when={turn().error}>
                      {(err) => <div class="text-12-regular text-red-500">{err()}</div>}
                    </Show>
                    <div class="text-12-regular text-text-weak whitespace-pre-wrap">{turn().output}</div>
                  </div>
                )}
              </Show>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="tools" class="no-scrollbar">
          <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
            <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
              <h2 class="text-16-medium text-text-strong">Tools</h2>
              <TextField
                variant="ghost"
                value={toolInvoke.name}
                placeholder="tool name"
                onChange={(v) => setToolInvoke("name", v)}
              />
              <TextField
                variant="ghost"
                value={toolInvoke.sessionID}
                placeholder="session id (optional)"
                onChange={(v) => setToolInvoke("sessionID", v)}
              />
              <textarea
                class="w-full min-h-[160px] bg-surface-raised-base border border-border-weak-base rounded-md px-3 py-2 text-12-regular text-text-strong"
                value={toolInvoke.args}
                onInput={(event) => setToolInvoke("args", event.currentTarget.value)}
              />
              <div class="flex items-center gap-2">
                <Button size="large" variant="secondary" onClick={invokeTool}>
                  {toolInvoke.running ? "Running..." : "Invoke"}
                </Button>
                <Button size="large" variant="secondary" onClick={() => refetchTools()}>
                  Refresh Tools
                </Button>
              </div>
              <div class="bg-surface-raised-base px-4 rounded-lg py-3">
                <div class="text-12-medium text-text-strong pb-2">Output</div>
                <div class="text-12-regular text-text-weak whitespace-pre-wrap">{toolInvoke.output || "(empty)"}</div>
              </div>
              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-1">
                <div class="text-12-medium text-text-strong">Allowed Tools</div>
                <For each={tools() ?? []}>
                  {(item) => (
                    <button
                      type="button"
                      class="text-left text-12-regular text-text-weak border-b border-border-weak-base last:border-none py-1"
                      onClick={() => setToolInvoke("name", item.name)}
                    >
                      {item.name} {item.args.length > 0 ? `(${item.args.join(", ")})` : ""}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="runtime" class="no-scrollbar">
          <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
            <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
              <h2 class="text-16-medium text-text-strong">Runtime</h2>
              <Show when={runtimeState()}>
                {(runtime) => (
                  <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-1">
                    <div class="text-12-medium text-text-strong">Nodes</div>
                    <div class="text-12-regular text-text-weak">
                      voice: connected={String(runtime().nodes.voice.connected)} | ws={runtime().nodes.voice.connection_count}
                    </div>
                    <div class="text-12-regular text-text-weak">
                      browser: connected={String(runtime().nodes.browser.connected)} | live={runtime().nodes.browser.live_sessions} | known={runtime().nodes.browser.known_sessions}
                    </div>
                    <div class="text-12-regular text-text-weak">
                      desktop: accessibility={runtime().nodes.desktop.accessibility} | screen_recording={runtime().nodes.desktop.screen_recording}
                    </div>
                  </div>
                )}
              </Show>
              <Show when={connectors()}>
                {(state) => (
                  <div class="flex flex-col gap-3">
                    <For each={(["webhook", "slack", "telegram"] as const)}>
                      {(name) => {
                        const item = state()[name]
                        return (
                          <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                            <div class="text-14-medium text-text-strong">{name}</div>
                            <label class="text-12-regular text-text-weak flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={item.enabled}
                                onChange={(event) => patchConnector(name, { enabled: event.currentTarget.checked })}
                              />
                              enabled
                            </label>
                            <Show when={name === "webhook"}>
                              <>
                                <TextField
                                  variant="ghost"
                                  value={item.webhook_url ?? ""}
                                  placeholder="webhook_url"
                                  onChange={(v) => patchConnector(name, { webhook_url: v })}
                                />
                                <div class="text-12-regular text-text-weak">
                                  secret configured: {String(item.webhook_secret_configured ?? false)}
                                </div>
                                <div class="flex items-center gap-2">
                                  <TextField
                                    variant="ghost"
                                    type="password"
                                    value={clawra.secretDrafts.webhook}
                                    placeholder="webhook_secret"
                                    onChange={(v) => setClawra("secretDrafts", "webhook", v)}
                                  />
                                  <Button size="large" variant="secondary" onClick={() => saveSecret("webhook")}>
                                    Save Secret
                                  </Button>
                                </div>
                              </>
                            </Show>
                            <Show when={name === "slack"}>
                              <>
                                <div class="text-12-regular text-text-weak">
                                  token configured: {String(item.slack_bot_token_configured ?? false)}
                                </div>
                                <div class="flex items-center gap-2">
                                  <TextField
                                    variant="ghost"
                                    type="password"
                                    value={clawra.secretDrafts.slack}
                                    placeholder="slack_bot_token"
                                    onChange={(v) => setClawra("secretDrafts", "slack", v)}
                                  />
                                  <Button size="large" variant="secondary" onClick={() => saveSecret("slack")}>
                                    Save Token
                                  </Button>
                                </div>
                                <TextField
                                  variant="ghost"
                                  value={item.slack_channel ?? ""}
                                  placeholder="slack_channel"
                                  onChange={(v) => patchConnector(name, { slack_channel: v })}
                                />
                              </>
                            </Show>
                            <Show when={name === "telegram"}>
                              <>
                                <div class="text-12-regular text-text-weak">
                                  token configured: {String(item.telegram_bot_token_configured ?? false)}
                                </div>
                                <div class="flex items-center gap-2">
                                  <TextField
                                    variant="ghost"
                                    type="password"
                                    value={clawra.secretDrafts.telegram}
                                    placeholder="telegram_bot_token"
                                    onChange={(v) => setClawra("secretDrafts", "telegram", v)}
                                  />
                                  <Button size="large" variant="secondary" onClick={() => saveSecret("telegram")}>
                                    Save Token
                                  </Button>
                                </div>
                                <TextField
                                  variant="ghost"
                                  value={item.telegram_chat_id ?? ""}
                                  placeholder="telegram_chat_id"
                                  onChange={(v) => patchConnector(name, { telegram_chat_id: v })}
                                />
                              </>
                            </Show>
                            <div class="flex items-center justify-between">
                              <div class="text-12-regular text-text-weak">
                                last_test={item.last_test_at ?? "(none)"} | ok={String(item.last_test_ok ?? false)}
                              </div>
                              <Button size="large" variant="secondary" onClick={() => testConnector(name)}>
                                Test
                              </Button>
                            </div>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                )}
              </Show>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="killswitch" class="no-scrollbar">
          <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
            <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
              <h2 class="text-16-medium text-text-strong">Kill Switch</h2>
              <Show when={killSwitch()}>
                {(state) => (
                  <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                    <div class="text-12-regular text-text-weak">active={String(state().active)}</div>
                    <div class="text-12-regular text-text-weak">reason={state().reason ?? "(none)"}</div>
                    <div class="text-12-regular text-text-weak">updated={state().updated_at}</div>
                    <div class="text-12-regular text-text-weak">
                      active 后会立即停止桌面输入、浏览器动作、exec 类变更动作和外发行为。
                    </div>
                  </div>
                )}
              </Show>
              <div class="flex items-center gap-2">
                <Button size="large" variant="secondary" onClick={activateKillSwitch}>
                  Activate
                </Button>
                <Button size="large" variant="secondary" onClick={releaseKillSwitch}>
                  Release
                </Button>
                <Button size="large" variant="secondary" onClick={() => refetchKillSwitch()}>
                  Reload
                </Button>
              </div>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="loop" class="no-scrollbar">
          <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
            <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
              <h2 class="text-16-medium text-text-strong">Loop</h2>
              <div class="text-12-regular text-text-weak">
                Loop is default-on. It pauses only when Miya marks 3 iterations as completed and still has missing work.
              </div>
              <Show when={status()} keyed>
                {(s) => <div class="bg-surface-raised-base px-4 rounded-lg">{statusLine("paused_sessions", s.loop_paused_sessions)}</div>}
              </Show>
              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                <div class="text-12-medium text-text-strong">Session Override</div>
                <TextField
                  variant="ghost"
                  value={loopControl.sessionID}
                  placeholder="session id"
                  onChange={(v) => setLoopControl("sessionID", v)}
                />
                <label class="text-12-regular text-text-weak flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={loopControl.loopEnabled}
                    onChange={(event) => setLoopControl("loopEnabled", event.currentTarget.checked)}
                  />
                  loopEnabled
                </label>
                <label class="text-12-regular text-text-weak flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={loopControl.autoContinue}
                    onChange={(event) => setLoopControl("autoContinue", event.currentTarget.checked)}
                  />
                  autoContinue
                </label>
                <label class="text-12-regular text-text-weak flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={loopControl.strictQualityGate}
                    onChange={(event) => setLoopControl("strictQualityGate", event.currentTarget.checked)}
                  />
                  strictQualityGate
                </label>
                <TextField
                  variant="ghost"
                  value={loopControl.maxIterationsPerWindow}
                  placeholder="maxIterationsPerWindow"
                  onChange={(v) => setLoopControl("maxIterationsPerWindow", v)}
                />
                <div class="flex items-center gap-2">
                  <Button size="large" variant="secondary" onClick={applyLoopControl}>
                    Apply
                  </Button>
                  <Button size="large" variant="secondary" onClick={() => refetchLoop()}>
                    Reload
                  </Button>
                </div>
              </div>
              <Show when={loop()}>
                {(sessions) => (
                  <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                    <div class="text-12-medium text-text-strong">Sessions</div>
                    <For each={Object.entries(sessions())}>
                      {([sessionID, state]) => (
                        <button
                          type="button"
                          class="text-left text-12-regular text-text-weak border-b border-border-weak-base last:border-none py-1"
                          onClick={() =>
                            setLoopControl({
                              sessionID,
                              loopEnabled: state.loopEnabled ?? true,
                              autoContinue: state.autoContinue ?? true,
                              maxIterationsPerWindow: String(state.maxIterationsPerWindow ?? 3),
                              strictQualityGate: state.strictQualityGate ?? true,
                            })
                          }
                        >
                          {sessionID} | iter={state.iterationCompleted ?? 0} | pause={String(state.awaitingConfirmation ?? false)} | missing=
                          {(state.lastMissing ?? []).length}
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </Show>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="voice" class="no-scrollbar">
          <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
            <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
              <h2 class="text-16-medium text-text-strong">Voice</h2>
              <div class="text-12-regular text-text-weak">
                websocket status: {voice.connected ? "connected" : "disconnected"}
              </div>
              <div class="flex items-center gap-2">
                <Button size="large" variant="secondary" onClick={connectVoice}>
                  Connect
                </Button>
                <Button size="large" variant="secondary" onClick={interruptVoice}>
                  Interrupt
                </Button>
              </div>
              <TextField variant="ghost" value={voice.input} placeholder="voice text fallback" onChange={(v) => setVoice("input", v)} />
              <Button size="large" variant="secondary" onClick={sendVoiceText}>
                Send
              </Button>
              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                <div class="text-12-regular text-text-weak">session={voice.sessionID || "(none)"}</div>
                <div class="text-12-medium text-text-strong">transcript</div>
                <div class="text-12-regular text-text-weak whitespace-pre-wrap">{voice.transcript || "(empty)"}</div>
                <div class="text-12-medium text-text-strong pt-2">assistant</div>
                <div class="text-12-regular text-text-weak whitespace-pre-wrap">{voice.reply || "(empty)"}</div>
              </div>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="clawra" class="no-scrollbar">
          <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
            <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
              <h2 class="text-16-medium text-text-strong">Clawra</h2>
              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                <div class="text-12-medium text-text-strong">Profile & Persona</div>
                <TextField
                  variant="ghost"
                  value={clawra.profile.reference_photo}
                  placeholder="reference photo URL"
                  onChange={(v) => setClawra("profile", "reference_photo", v)}
                />
                <TextField
                  variant="ghost"
                  value={clawra.profile.voice_sample}
                  placeholder="voice sample URL"
                  onChange={(v) => setClawra("profile", "voice_sample", v)}
                />
                <textarea
                  class="w-full min-h-[120px] bg-surface-raised-base border border-border-weak-base rounded-md px-3 py-2 text-12-regular text-text-strong"
                  value={clawra.profile.personality_prompt}
                  onInput={(event) => setClawra("profile", "personality_prompt", event.currentTarget.value)}
                  placeholder="personality prompt"
                />
                <label class="text-12-regular text-text-weak flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={clawra.profile.auto_persona}
                    onChange={(event) => setClawra("profile", "auto_persona", event.currentTarget.checked)}
                  />
                  auto persona injection
                </label>
                <label class="text-12-regular text-text-weak flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={clawra.profile.nsfw_enabled}
                    onChange={(event) => setClawra("profile", "nsfw_enabled", event.currentTarget.checked)}
                  />
                  nsfw enabled
                </label>
                <TextField
                  variant="ghost"
                  value={clawra.profile.elevenlabs_voice_id}
                  placeholder="default ElevenLabs voice id"
                  onChange={(v) => setClawra("profile", "elevenlabs_voice_id", v)}
                />
                <TextField
                  variant="ghost"
                  value={clawra.profile.voice_backend_default}
                  placeholder="voice backend: elevenlabs|coqui|rvc"
                  onChange={(v) =>
                    setClawra("profile", "voice_backend_default", (v || "elevenlabs") as "elevenlabs" | "coqui" | "rvc")
                  }
                />
                <TextField
                  variant="ghost"
                  value={clawra.profile.selfie_mode_default}
                  placeholder="selfie mode: auto|mirror|direct"
                  onChange={(v) =>
                    setClawra("profile", "selfie_mode_default", (v || "auto") as "mirror" | "direct" | "auto")
                  }
                />
                <div class="flex items-center gap-2">
                  <Button size="large" variant="secondary" onClick={saveClawraProfile}>
                    Save Profile
                  </Button>
                  <Button size="large" variant="secondary" onClick={() => refetchClawraProfile()}>
                    Reload
                  </Button>
                </div>
              </div>

              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                <div class="text-12-medium text-text-strong">Secrets (Keychain)</div>
                <div class="text-12-regular text-text-weak">
                  backend: {secretStatus()?.backend ?? "unknown"} | fal={String(secretStatus()?.providers.fal ?? false)} | elevenlabs={String(secretStatus()?.providers.elevenlabs ?? false)}
                </div>
                <div class="flex items-center gap-2">
                  <TextField
                    variant="ghost"
                    type="password"
                    value={clawra.secretDrafts.fal}
                    placeholder="FAL key"
                    onChange={(v) => setClawra("secretDrafts", "fal", v)}
                  />
                  <Button size="large" variant="secondary" onClick={() => saveSecret("fal")}>
                    Save FAL
                  </Button>
                </div>
                <div class="flex items-center gap-2">
                  <TextField
                    variant="ghost"
                    type="password"
                    value={clawra.secretDrafts.elevenlabs}
                    placeholder="ElevenLabs key"
                    onChange={(v) => setClawra("secretDrafts", "elevenlabs", v)}
                  />
                  <Button size="large" variant="secondary" onClick={() => saveSecret("elevenlabs")}>
                    Save ElevenLabs
                  </Button>
                </div>
              </div>

              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                <div class="text-12-medium text-text-strong">Selfie (Grok Imagine)</div>
                <TextField
                  variant="ghost"
                  value={clawra.selfiePrompt}
                  placeholder="selfie prompt"
                  onChange={(v) => setClawra("selfiePrompt", v)}
                />
                <TextField
                  variant="ghost"
                  value={clawra.selfieAspectRatio}
                  placeholder="aspect ratio (e.g. 1:1)"
                  onChange={(v) => setClawra("selfieAspectRatio", v)}
                />
                <TextField
                  variant="ghost"
                  value={clawra.selfieMode}
                  placeholder="mode: auto|mirror|direct"
                  onChange={(v) => setClawra("selfieMode", (v || "auto") as "mirror" | "direct" | "auto")}
                />
                <Button size="large" variant="secondary" onClick={generateClawraSelfie}>
                  {clawra.selfieBusy ? "Generating..." : "Generate Selfie"}
                </Button>
                <Show when={clawra.selfieImageURL}>
                  <img src={clawra.selfieImageURL} alt="clawra-selfie" class="w-full rounded-md border border-border-weak-base" />
                </Show>
                <Show when={clawra.selfieRevisedPrompt}>
                  {(text) => <div class="text-12-regular text-text-weak whitespace-pre-wrap">revised: {text()}</div>}
                </Show>
              </div>

              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                <div class="text-12-medium text-text-strong">Voice (ElevenLabs / Coqui / RVC)</div>
                <TextField
                  variant="ghost"
                  value={clawra.voiceProvider}
                  placeholder="provider: elevenlabs|coqui|rvc"
                  onChange={(v) => setClawra("voiceProvider", (v || "elevenlabs") as "elevenlabs" | "coqui" | "rvc")}
                />
                <TextField
                  variant="ghost"
                  value={clawra.voiceID}
                  placeholder="voice id (optional)"
                  onChange={(v) => setClawra("voiceID", v)}
                />
                <TextField
                  variant="ghost"
                  value={clawra.voiceModel}
                  placeholder="model id"
                  onChange={(v) => setClawra("voiceModel", v)}
                />
                <textarea
                  class="w-full min-h-[96px] bg-surface-raised-base border border-border-weak-base rounded-md px-3 py-2 text-12-regular text-text-strong"
                  value={clawra.voiceText}
                  onInput={(event) => setClawra("voiceText", event.currentTarget.value)}
                  placeholder="text to speak"
                />
                <label class="text-12-regular text-text-weak flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={clawra.voiceFallbackCloud}
                    onChange={(event) => setClawra("voiceFallbackCloud", event.currentTarget.checked)}
                  />
                  local failure fallback to ElevenLabs
                </label>
                <Button size="large" variant="secondary" onClick={speakClawraVoice}>
                  {clawra.voiceBusy ? "Synthesizing..." : "Speak"}
                </Button>
                <Show when={clawra.audioURL}>
                  <audio controls src={clawra.audioURL} />
                </Show>
                <div class="pt-2 border-t border-border-weak-base flex flex-col gap-2">
                  <div class="text-12-medium text-text-strong">Local Runtime</div>
                  <div class="flex flex-wrap items-center gap-2">
                    <Button
                      size="large"
                      variant="secondary"
                      disabled={clawra.runtimeBusy}
                      onClick={() => void runVoiceRuntimeTool("miya_voice_status")}
                    >
                      Status
                    </Button>
                    <Button
                      size="large"
                      variant="secondary"
                      disabled={clawra.runtimeBusy}
                      onClick={() => void runVoiceRuntimeTool("miya_voice_up", { providers: "coqui,rvc" })}
                    >
                      Up
                    </Button>
                    <Button
                      size="large"
                      variant="secondary"
                      disabled={clawra.runtimeBusy}
                      onClick={() => void runVoiceRuntimeTool("miya_voice_down", { providers: "coqui,rvc" })}
                    >
                      Down
                    </Button>
                    <Button
                      size="large"
                      variant="secondary"
                      disabled={clawra.runtimeBusy}
                      onClick={() => void runVoiceRuntimeTool("miya_voice_install")}
                    >
                      Install
                    </Button>
                    <Button
                      size="large"
                      variant="secondary"
                      disabled={clawra.runtimeBusy}
                      onClick={() => void runVoiceRuntimeTool("miya_voice_doctor")}
                    >
                      Doctor
                    </Button>
                  </div>
                  <Show when={clawra.runtimeReport}>
                    <div class="text-12-regular text-text-weak whitespace-pre-wrap">{clawra.runtimeReport}</div>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="browser" class="no-scrollbar">
          <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
            <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
              <h2 class="text-16-medium text-text-strong">Browser</h2>
              <TextField variant="ghost" value={browser.url} placeholder="https://example.com" onChange={(v) => setBrowser("url", v)} />
              <div class="flex items-center gap-2">
                <Button size="large" variant="secondary" onClick={createBrowserSession}>
                  New Session
                </Button>
                <Button size="large" variant="secondary" onClick={browserStart}>
                  Start
                </Button>
                <Button size="large" variant="secondary" onClick={browserStop}>
                  Stop
                </Button>
                <Button size="large" variant="secondary" onClick={browserNavigate}>
                  Navigate
                </Button>
                <Button size="large" variant="secondary" onClick={browserOpenTab}>
                  Open Tab
                </Button>
                <Button size="large" variant="secondary" onClick={browserSnapshot}>
                  Snapshot
                </Button>
              </div>
              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                <For each={browserSessions() ?? []}>
                  {(session) => (
                    <div class="flex items-center justify-between gap-2 border-b border-border-weak-base last:border-none py-2">
                      <button
                        type="button"
                        class="text-12-regular text-text-strong text-left flex-1"
                        onClick={() => {
                          setBrowser("selected", session.id)
                          openBrowserStream(session.id)
                          void browserLoadTabs()
                          void browserLoadConsole()
                        }}
                      >
                        {session.id} | {session.live ? "live" : "offline"} | {session.url ?? "(no url)"}
                      </button>
                      <Button size="large" variant="ghost" onClick={() => deleteBrowserSession(session.id)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </For>
              </div>
              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-2">
                <div class="text-12-medium text-text-strong">Action</div>
                <TextField
                  variant="ghost"
                  value={browser.action}
                  placeholder="click|type|scroll|hover|scrollintoview|check|uncheck|select|extract|html|screenshot"
                  onChange={(v) => setBrowser("action", v)}
                />
                <TextField variant="ghost" value={browser.target} placeholder="target selector" onChange={(v) => setBrowser("target", v)} />
                <TextField variant="ghost" value={browser.value} placeholder="value" onChange={(v) => setBrowser("value", v)} />
                <Button size="large" variant="secondary" onClick={browserAction}>
                  Send Action
                </Button>
              </div>
              <Show when={browser.tabs.length > 0}>
                <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-1">
                  <div class="text-12-medium text-text-strong">Tabs</div>
                  <For each={browser.tabs}>
                    {(tab) => (
                      <button
                        type="button"
                        class="text-left text-12-regular text-text-weak border-b border-border-weak-base last:border-none py-1"
                        onClick={() => void browserFocusTab(tab.tab_id)}
                      >
                        {tab.active ? "[active] " : ""}{tab.index}: {tab.title || "(untitled)"} | {tab.url}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={browser.snapshotText}>
                <div class="bg-surface-raised-base px-4 rounded-lg py-3">
                  <div class="text-12-medium text-text-strong pb-2">Snapshot</div>
                  <div class="text-12-regular text-text-weak whitespace-pre-wrap">{browser.snapshotText}</div>
                </div>
              </Show>
              <div class="bg-surface-raised-base px-4 rounded-lg py-3 flex flex-col gap-1">
                <div class="text-12-medium text-text-strong">Events</div>
                <For each={browser.events}>
                  {(line) => <div class="text-12-regular text-text-weak whitespace-pre-wrap">{line}</div>}
                </For>
              </div>
            </div>
          </div>
        </Tabs.Content>
      </Tabs>
    </div>
  )
}
