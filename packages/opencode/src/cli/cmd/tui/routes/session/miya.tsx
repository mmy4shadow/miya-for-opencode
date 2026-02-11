import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useKV } from "@tui/context/kv"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import path from "path"

type Job = {
  id: string
  name: string
  enabled: boolean
  requireApproval: boolean
  schedule: { type: string; time: string }
  nextRunAt: string
  lastRunAt?: string
  lastStatus?: string
  lastExitCode?: number | null
}

type Approval = {
  id: string
  jobId: string
  status: "pending" | "approved" | "rejected"
  requestedAt: string
}

type State = {
  jobs: Job[]
  approvals: Approval[]
}

type History = {
  id: string
  jobName: string
  status: string
  exitCode: number | null
  startedAt: string
}

type Session = {
  id: string
  title: string
  agent: string
  status: "active" | "idle" | "completed"
  lastActivity: string
  messageCount: number
}

type GatewayAgent = {
  id: string
  name: string
  type: "planner" | "coder" | "reviewer" | "debugger"
  status: "available" | "busy" | "offline"
  currentSession?: string
}

async function readJson(file: string) {
  try {
    return await Bun.file(file).json()
  } catch {
    return null
  }
}

async function readJsonl(file: string, limit: number): Promise<History[]> {
  try {
    const text = await Bun.file(file).text()
    const lines = text
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
    const slice = lines.slice(Math.max(0, lines.length - limit))
    return slice
      .map((x) => {
        try {
          return JSON.parse(x) as History
        } catch {
          return null
        }
      })
      .filter((x): x is History => !!x)
      .reverse()
  } catch {
    return []
  }
}

function useMiyaPanel() {
  const kv = useKV()
  const sync = useSync()
  const sdk = useSDK()
  const [open, setOpen] = kv.signal("miya_panel_open", false)
  const [activeTab, setActiveTab] = kv.signal<"jobs" | "gateway">("miya_tab", "jobs")
  const [loading, setLoading] = createSignal(false)

  const root = createMemo(() => sync.data.path.directory)
  const statePath = createMemo(() => path.join(root(), ".opencode", "miya", "automation", "state.json"))
  const historyPath = createMemo(() => path.join(root(), ".opencode", "miya", "automation", "history.jsonl"))

  const [data, { refetch }] = createResource(async () => {
    const [state, history, sessionListResult, sessionStatusResult] = await Promise.all([
      readJson(statePath()) as Promise<State | null>,
      readJsonl(historyPath(), 20),
      sdk.client.session.list({ limit: 40, roots: true }),
      sdk.client.session.status(),
    ])
    const sessionStatus = sessionStatusResult.data ?? {}
    const sessions: Session[] = (sessionListResult.data ?? [])
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .slice(0, 20)
      .map((item) => {
        const statusType = sessionStatus[item.id]?.type ?? "idle"
        return {
          id: item.id,
          title: item.title,
          agent: "main",
          status: statusType === "busy" ? "active" : "idle",
          lastActivity: new Date(item.time.updated).toISOString(),
          messageCount: 0,
        }
      })
    const agents: GatewayAgent[] = sync.data.agent
      .filter((item) => item.mode !== "subagent" && !item.hidden)
      .map((item) => ({
        id: item.name,
        name: item.name,
        type: item.name.includes("task")
          ? "planner"
          : item.name.includes("code")
            ? "coder"
            : item.name.includes("review")
              ? "reviewer"
              : "debugger",
        status: "available",
      }))
    return {
      state: state ?? { jobs: [], approvals: [] },
      history,
      sessions,
      agents,
    }
  })

  const pendingApprovals = createMemo(() => (data()?.state.approvals ?? []).filter((x) => x.status === "pending"))
  const enabledJobs = createMemo(() => (data()?.state.jobs ?? []).filter((x) => x.enabled))
  const activeSessions = createMemo(() => (data()?.sessions ?? []).filter((x) => x.status === "active"))
  const availableAgents = createMemo(() => (data()?.agents ?? []).filter((x) => x.status === "available"))

  const append = async (text: string) => {
    try {
      await sdk.client.tui.appendPrompt({ text })
    } catch {
      // ignore
    }
  }

  const refresh = async () => {
    setLoading(true)
    try {
      await refetch()
    } finally {
      setLoading(false)
    }
  }

  const handleOpen = async () => {
    setOpen(true)
    if (!data()) {
      await refresh()
      return
    }
    void refresh()
  }

  const handleClose = () => setOpen(false)

  return {
    open,
    setOpen,
    activeTab,
    setActiveTab,
    loading,
    data,
    pendingApprovals,
    enabledJobs,
    activeSessions,
    availableAgents,
    append,
    refresh,
    handleOpen,
    handleClose,
  }
}

export function MiyaHandle() {
  const { theme } = useTheme()
  const panel = useMiyaPanel()

  return (
    <box width={1} height="100%" backgroundColor={theme.backgroundPanel} onMouseUp={() => void panel.handleOpen()}>
      <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
        M
      </text>
    </box>
  )
}

export function MiyaPanel() {
  const { theme } = useTheme()
  const panel = useMiyaPanel()

  return (
    <Show
      when={panel.open()}
      fallback={
        <box
          width={2}
          height="100%"
          backgroundColor={theme.backgroundPanel}
          border={["left"]}
          borderColor={theme.border}
          onMouseUp={() => void panel.handleOpen()}
        >
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            M
          </text>
        </box>
      }
    >
      <box
        width={52}
        height="100%"
        backgroundColor={theme.backgroundPanel}
        border={["left"]}
        borderColor={theme.border}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Miya
          </text>
          <box flexDirection="row" gap={2}>
            <text fg={theme.textMuted} onMouseUp={() => void panel.refresh()}>
              {panel.loading() ? "…" : "refresh"}
            </text>
            <text fg={theme.textMuted} onMouseUp={panel.handleClose}>
              close
            </text>
          </box>
        </box>

        <box flexShrink={0} paddingTop={1}>
          <box flexDirection="row" gap={2}>
            <text fg={panel.activeTab() === "jobs" ? theme.accent : theme.textMuted} onMouseUp={() => panel.setActiveTab("jobs")}>
              jobs
            </text>
            <text fg={panel.activeTab() === "gateway" ? theme.accent : theme.textMuted} onMouseUp={() => panel.setActiveTab("gateway")}>
              gateway
            </text>
          </box>
        </box>

        <box flexGrow={1} paddingTop={1}>
          <scrollbox flexGrow={1}>
            <Show when={panel.activeTab() === "jobs"}>
              <box flexShrink={0}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Jobs
                </text>
                <text fg={theme.textMuted}>
                  enabled={panel.enabledJobs().length} total={(panel.data()?.state.jobs ?? []).length}
                </text>
                <For each={panel.data()?.state.jobs ?? []}>
                  {(job) => (
                    <text fg={job.enabled ? theme.text : theme.textMuted} wrapMode="word">
                      • {job.name} [{job.id}] daily {job.schedule.time} next {job.nextRunAt}
                      {job.requireApproval ? " (approval)" : ""}
                    </text>
                  )}
                </For>
              </box>

              <box flexShrink={0} paddingTop={1}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Pending approvals
                </text>
                <Show when={panel.pendingApprovals().length === 0}>
                  <text fg={theme.textMuted}>(none)</text>
                </Show>
                <For each={panel.pendingApprovals()}>
                  {(a) => (
                    <text fg={theme.warning} wrapMode="word">
                      • {a.id} job={a.jobId} requested={a.requestedAt}
                    </text>
                  )}
                </For>
              </box>

              <box flexShrink={0} paddingTop={1}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Recent runs
                </text>
                <Show when={(panel.data()?.history ?? []).length === 0}>
                  <text fg={theme.textMuted}>(none)</text>
                </Show>
                <For each={panel.data()?.history ?? []}>
                  {(h) => (
                    <text fg={theme.textMuted} wrapMode="word">
                      • {h.startedAt} {h.jobName} {h.status} exit={h.exitCode}
                    </text>
                  )}
                </For>
              </box>

              <box flexShrink={0} paddingTop={1}>
                <text fg={theme.textMuted}>Quick actions:</text>
                <box flexDirection="row" gap={2} flexWrap="wrap">
                  <text fg={theme.accent} onMouseUp={() => void panel.append("/miya")}>status</text>
                  <text fg={theme.accent} onMouseUp={() => void panel.append("/miya-jobs")}>jobs</text>
                  <text fg={theme.accent} onMouseUp={() => void panel.append("/miya-approvals")}>approvals</text>
                  <text fg={theme.accent} onMouseUp={() => void panel.append("/miya-history")}>history</text>
                </box>
              </box>
            </Show>

            <Show when={panel.activeTab() === "gateway"}>
              <box flexShrink={0}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Gateway
                </text>
                <text fg={theme.textMuted}>OpenClaw-style ACP routing</text>
              </box>

              <box flexShrink={0} paddingTop={1}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Active Sessions ({panel.activeSessions().length})
                </text>
                <Show when={panel.activeSessions().length === 0}>
                  <text fg={theme.textMuted}>(none)</text>
                </Show>
                <For each={panel.activeSessions()}>
                  {(s) => (
                    <box flexDirection="column">
                      <text fg={theme.text} wrapMode="word">
                        • {s.title.slice(0, 30)}
                      </text>
                      <text fg={theme.textMuted}>
                        {s.agent} · {s.messageCount} msgs · {s.lastActivity}
                      </text>
                    </box>
                  )}
                </For>
              </box>

              <box flexShrink={0} paddingTop={1}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Available Agents ({panel.availableAgents().length})
                </text>
                <Show when={panel.availableAgents().length === 0}>
                  <text fg={theme.textMuted}>(none)</text>
                </Show>
                <For each={panel.availableAgents()}>
                  {(a) => (
                    <text fg={theme.success} wrapMode="word">
                      • {a.name} [{a.type}]
                    </text>
                  )}
                </For>
                <For each={(panel.data()?.agents ?? []).filter((x) => x.status !== "available")}>
                  {(a) => (
                    <text fg={a.status === "busy" ? theme.warning : theme.textMuted} wrapMode="word">
                      • {a.name} [{a.type}] {a.status}
                    </text>
                  )}
                </For>
              </box>

              <box flexShrink={0} paddingTop={1}>
                <text fg={theme.textMuted}>Quick actions:</text>
                <box flexDirection="row" gap={2} flexWrap="wrap">
                  <text fg={theme.accent} onMouseUp={() => void panel.append("/miya-sessions")}>sessions</text>
                  <text fg={theme.accent} onMouseUp={() => void panel.append("/miya-agents")}>agents</text>
                  <text fg={theme.accent} onMouseUp={() => void panel.append("/miya-route <task>")}>route</text>
                </box>
              </box>
            </Show>
          </scrollbox>
        </box>

        <box flexShrink={0} paddingTop={1}>
          <text fg={theme.textMuted} wrapMode="word">
            Tip: schedule via /miya-schedule &lt;natural language&gt;.
          </text>
        </box>
      </box>
    </Show>
  )
}
