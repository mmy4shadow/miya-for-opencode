import { createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useKV } from "@tui/context/kv"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"

type Tab = "autopilot" | "self" | "runtime" | "jobs" | "skills" | "kill"

type Status = {
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

type SelfApproval = {
  id: string
  action: string
  status: "executed" | "failed" | "blocked"
  created_at: string
  duration_ms: number
  verifier: { verdict: "allow" | "deny"; checks: string[]; evidence: string[] }
  rollback: { strategy: string }
  error?: string
}

type Connector = {
  enabled: boolean
  last_test_at?: string
  last_test_ok?: boolean
  last_test_error?: string
}

type Runtime = {
  gateway: { transport: string; same_port_control_plane: boolean; active_turns: number }
  nodes: {
    voice: { connected: boolean; connection_count: number }
    browser: { connected: boolean; live_sessions: number; known_sessions: number }
    desktop: { connected: boolean; accessibility: string; screen_recording: string }
  }
  connectors: Record<"webhook" | "slack" | "telegram", Connector>
  kill_switch: KillSwitch
}

type Job = {
  id: string
  name: string
  enabled: boolean
  schedule: { type: string; time: string }
  action: { command: string }
  nextRunAt: string
  lastRunAt?: string
  lastStatus?: string
  lastExitCode?: number | null
}

type Skill = {
  id: string
  enabled: boolean
  locked_version?: string
  source: string
  updated_at: string
}

type KillSwitch = {
  active: boolean
  reason?: string
  activated_at?: string
  released_at?: string
  updated_at: string
}

type Data = {
  status: Status
  selfApproval: SelfApproval[]
  runtime: Runtime | null
  jobs: Job[]
  skills: Skill[]
  kill: KillSwitch | null
}

function emptyData(): Data {
  return {
    status: {
      autopilot_mode: "full",
      loop_cycle_limit: 3,
      jobs_total: 0,
      jobs_enabled: 0,
      approvals_pending: 0,
      self_approval_records: 0,
      loop_paused_sessions: 0,
      connectors_enabled: 0,
      kill_switch_active: false,
    },
    selfApproval: [],
    runtime: null,
    jobs: [],
    skills: [],
    kill: null,
  }
}

function useMiyaPanel() {
  const kv = useKV()
  const sync = useSync()
  const sdk = useSDK()
  const [open, setOpen] = kv.signal("miya_panel_open", true)
  const [tab, setTab] = kv.signal<Tab>("miya_tab", "autopilot")
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")
  const [tick, setTick] = createSignal(0)

  const req = async <T,>(route: string, init?: RequestInit) => {
    const url = new URL(route, sdk.url)
    const directory = sync.data.path.directory
    if (directory) url.searchParams.set("directory", directory)
    const response = await fetch(url.toString(), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
    if (!response.ok) {
      const message = await response.text().catch(() => "")
      throw new Error(message || `${response.status} ${response.statusText}`)
    }
    return (await response.json()) as T
  }

  const safe = async <T,>(run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run()
    } catch {
      return fallback
    }
  }

  const [data, { refetch }] = createResource(tick, async () => {
    const fallback = emptyData()
    const status = await safe(() => req<Status>("/miya/status"), fallback.status)
    const selfApproval = await safe(() => req<SelfApproval[]>("/miya/self-approval?limit=60"), fallback.selfApproval)
    const runtime = await safe(() => req<Runtime>("/miya/runtime"), fallback.runtime)
    const jobs = await safe(() => req<Job[]>("/miya/jobs"), fallback.jobs)
    const skills = await safe(() => req<Skill[]>("/miya/skills"), fallback.skills)
    const kill = await safe(() => req<KillSwitch>("/miya/kill-switch"), fallback.kill)
    return { status, selfApproval, runtime, jobs, skills, kill }
  })

  const refresh = async () => {
    setLoading(true)
    setError("")
    try {
      setTick((x) => x + 1)
      await refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleOpen = async () => {
    setOpen(true)
    if (!data()) await refresh()
  }
  const handleClose = () => setOpen(false)

  const toggleSkill = async (item: Skill) => {
    await req(`/miya/skills/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !item.enabled }),
    })
    await refresh()
  }

  const activateKill = async () => {
    await req("/miya/kill-switch/activate", {
      method: "POST",
      body: JSON.stringify({ reason: "manual emergency stop from tui cockpit" }),
    })
    await refresh()
  }

  const releaseKill = async () => {
    await req("/miya/kill-switch/release", {
      method: "POST",
      body: JSON.stringify({}),
    })
    await refresh()
  }

  return {
    open,
    tab,
    loading,
    error,
    data,
    setTab,
    handleOpen,
    handleClose,
    refresh,
    toggleSkill,
    activateKill,
    releaseKill,
  }
}

export function MiyaHandle() {
  const { theme } = useTheme()
  const panel = useMiyaPanel()
  return (
    <box
      width={6}
      height="100%"
      border={["right"]}
      borderColor={theme.border}
      backgroundColor={theme.backgroundPanel}
      justifyContent="center"
      alignItems="center"
      onMouseUp={() => void panel.handleOpen()}
    >
      <text fg={theme.accent} attributes={TextAttributes.BOLD}>
        MIYA
      </text>
    </box>
  )
}

export function MiyaPanel() {
  const { theme } = useTheme()
  const panel = useMiyaPanel()
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "autopilot", label: "autopilot" },
    { id: "self", label: "self-approval" },
    { id: "runtime", label: "runtime" },
    { id: "jobs", label: "jobs" },
    { id: "skills", label: "skills" },
    { id: "kill", label: "kill-switch" },
  ]

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
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            M
          </text>
        </box>
      }
    >
      <box width={60} height="100%" backgroundColor={theme.backgroundPanel} border={["left"]} borderColor={theme.border}>
        <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column" gap={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Miya Autopilot Cockpit
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

          <box flexDirection="row" gap={2} flexWrap="wrap">
            <For each={tabs}>
              {(item) => (
                <text fg={panel.tab() === item.id ? theme.accent : theme.textMuted} onMouseUp={() => panel.setTab(item.id)}>
                  {item.label}
                </text>
              )}
            </For>
          </box>

          <Show when={panel.error()}>
            {(err) => <text fg={theme.error}>{err()}</text>}
          </Show>

          <scrollbox flexGrow={1}>
            <Switch>
              <Match when={panel.tab() === "autopilot"}>
                <Show when={panel.data()} fallback={<text fg={theme.textMuted}>loading...</text>}>
                  {(d) => (
                    <box flexDirection="column" gap={1}>
                      <text fg={theme.text}>mode={d().status.autopilot_mode ?? "full"}</text>
                      <text fg={theme.text}>loop_cycle_limit={d().status.loop_cycle_limit ?? 3}</text>
                      <text fg={theme.text}>jobs_total={d().status.jobs_total}</text>
                      <text fg={theme.text}>jobs_enabled={d().status.jobs_enabled}</text>
                      <text fg={theme.text}>self_approval_records={d().status.self_approval_records ?? 0}</text>
                      <text fg={theme.text}>loop_paused_sessions={d().status.loop_paused_sessions}</text>
                      <text fg={theme.text}>connectors_enabled={d().status.connectors_enabled}</text>
                      <text fg={theme.text}>kill_switch_active={String(d().status.kill_switch_active ?? false)}</text>
                    </box>
                  )}
                </Show>
              </Match>

              <Match when={panel.tab() === "self"}>
                <Show when={panel.data()} fallback={<text fg={theme.textMuted}>loading...</text>}>
                  {(d) => (
                    <box flexDirection="column" gap={1}>
                      <Show when={d().selfApproval.length === 0}>
                        <text fg={theme.textMuted}>(no self-approval records yet)</text>
                      </Show>
                      <For each={d().selfApproval}>
                        {(item) => (
                          <box flexDirection="column" border={["left"]} borderColor={theme.border} paddingLeft={1}>
                            <text fg={theme.text}>{item.action}</text>
                            <text fg={theme.textMuted}>
                              {item.status} | {item.created_at} | {item.duration_ms}ms
                            </text>
                            <text fg={theme.textMuted}>verifier={item.verifier.verdict}</text>
                            <Show when={item.error}>
                              {(err) => <text fg={theme.error}>{err()}</text>}
                            </Show>
                          </box>
                        )}
                      </For>
                    </box>
                  )}
                </Show>
              </Match>

              <Match when={panel.tab() === "runtime"}>
                <Show when={panel.data()?.runtime} fallback={<text fg={theme.textMuted}>runtime unavailable</text>}>
                  {(r) => (
                    <box flexDirection="column" gap={1}>
                      <text fg={theme.text}>gateway_transport={r().gateway.transport}</text>
                      <text fg={theme.text}>gateway_same_port={String(r().gateway.same_port_control_plane)}</text>
                      <text fg={theme.text}>gateway_active_turns={r().gateway.active_turns}</text>
                      <text fg={theme.text}>voice_connected={String(r().nodes.voice.connected)}</text>
                      <text fg={theme.text}>voice_connections={r().nodes.voice.connection_count}</text>
                      <text fg={theme.text}>browser_live_sessions={r().nodes.browser.live_sessions}</text>
                      <text fg={theme.text}>browser_known_sessions={r().nodes.browser.known_sessions}</text>
                      <text fg={theme.text}>desktop_accessibility={r().nodes.desktop.accessibility}</text>
                      <text fg={theme.text}>desktop_screen_recording={r().nodes.desktop.screen_recording}</text>
                    </box>
                  )}
                </Show>
              </Match>

              <Match when={panel.tab() === "jobs"}>
                <Show when={panel.data()} fallback={<text fg={theme.textMuted}>loading...</text>}>
                  {(d) => (
                    <box flexDirection="column" gap={1}>
                      <Show when={d().jobs.length === 0}>
                        <text fg={theme.textMuted}>(no jobs)</text>
                      </Show>
                      <For each={d().jobs}>
                        {(job) => (
                          <box flexDirection="column" border={["left"]} borderColor={theme.border} paddingLeft={1}>
                            <text fg={theme.text}>
                              {job.name} [{job.id}]
                            </text>
                            <text fg={theme.textMuted}>
                              enabled={String(job.enabled)} daily={job.schedule.time}
                            </text>
                            <text fg={theme.textMuted}>next={job.nextRunAt}</text>
                            <text fg={theme.textMuted}>cmd={job.action.command}</text>
                          </box>
                        )}
                      </For>
                    </box>
                  )}
                </Show>
              </Match>

              <Match when={panel.tab() === "skills"}>
                <Show when={panel.data()} fallback={<text fg={theme.textMuted}>loading...</text>}>
                  {(d) => (
                    <box flexDirection="column" gap={1}>
                      <Show when={d().skills.length === 0}>
                        <text fg={theme.textMuted}>(no skills)</text>
                      </Show>
                      <For each={d().skills}>
                        {(skill) => (
                          <box flexDirection="column" border={["left"]} borderColor={theme.border} paddingLeft={1}>
                            <text fg={theme.text}>
                              {skill.id} | enabled={String(skill.enabled)} | source={skill.source}
                            </text>
                            <text fg={theme.textMuted}>
                              version={skill.locked_version ?? "(none)"} | updated={skill.updated_at}
                            </text>
                            <text fg={theme.accent} onMouseUp={() => void panel.toggleSkill(skill)}>
                              toggle
                            </text>
                          </box>
                        )}
                      </For>
                    </box>
                  )}
                </Show>
              </Match>

              <Match when={panel.tab() === "kill"}>
                <Show when={panel.data()?.kill} fallback={<text fg={theme.textMuted}>kill-switch unavailable</text>}>
                  {(k) => (
                    <box flexDirection="column" gap={1}>
                      <text fg={theme.text}>active={String(k().active)}</text>
                      <text fg={theme.text}>reason={k().reason ?? "(none)"}</text>
                      <text fg={theme.text}>updated={k().updated_at}</text>
                      <text fg={theme.accent} onMouseUp={() => void panel.activateKill()}>
                        activate
                      </text>
                      <text fg={theme.accent} onMouseUp={() => void panel.releaseKill()}>
                        release
                      </text>
                    </box>
                  )}
                </Show>
              </Match>
            </Switch>
          </scrollbox>
        </box>
      </box>
    </Show>
  )
}
