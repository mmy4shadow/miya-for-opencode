import { useCallback, useEffect, useMemo, useState } from 'react';

interface NexusTrustSnapshot {
  target: number;
  source: number;
  action: number;
  minScore: number;
  tier: 'high' | 'medium' | 'low';
}

interface TrustModeConfig {
  silentMin: number;
  modalMax: number;
}

interface PsycheModeConfig {
  resonanceEnabled: boolean;
  captureProbeEnabled: boolean;
  signalOverrideEnabled?: boolean;
  slowBrainEnabled?: boolean;
  slowBrainShadowEnabled?: boolean;
  slowBrainShadowRollout?: number;
  proactivePingEnabled?: boolean;
  proactivePingMinIntervalMinutes?: number;
  proactivePingMaxPerDay?: number;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  quietHoursTimezoneOffsetMinutes?: number;
}

type KillSwitchMode = 'all_stop' | 'outbound_only' | 'desktop_only' | 'off';
type ControlView = 'modules' | 'tasks-list' | 'tasks-detail';
type TaskStatusFilter = 'all' | 'completed' | 'running' | 'failed' | 'stopped';

interface GatewaySnapshot {
  updatedAt?: string;
  gateway?: {
    status?: string;
    url?: string;
  };
  daemon?: {
    connected?: boolean;
    cpuPercent?: number;
    activeJobID?: string;
    activeJobProgress?: number;
    psycheSignalHub?: {
      running?: boolean;
      sequence?: number;
      sampledAt?: string;
      ageMs?: number;
      stale?: boolean;
      consecutiveFailures?: number;
      lastError?: string;
      sampleIntervalMs?: number;
      burstIntervalMs?: number;
      staleAfterMs?: number;
    };
  };
  policyHash?: string;
  sessions?: {
    total?: number;
    active?: number;
    queued?: number;
    muted?: number;
  };
  jobs?: {
    total?: number;
    enabled?: number;
    pendingApprovals?: number;
    recentRuns?: Array<{
      id?: string;
      status?: string;
      trigger?: string;
      updatedAt?: string;
      reason?: string;
    }>;
  };
  nexus?: {
    sessionId?: string;
    activeTool?: string;
    permission?: string;
    pendingTickets?: number;
    killSwitchMode?: KillSwitchMode;
    insights?: Array<{ at?: string; text?: string; auditID?: string }>;
    trust?: NexusTrustSnapshot;
    trustMode?: TrustModeConfig;
    psycheMode?: PsycheModeConfig;
    guardianSafeHoldReason?: string;
  };
  nodes?: {
    total?: number;
    connected?: number;
    list?: Array<{
      id?: string;
      label?: string;
      connected?: boolean;
      platform?: string;
      updatedAt?: string;
    }>;
  };
  channels?: {
    recentOutbound?: Array<{
      id?: string;
      at?: string;
      channel?: string;
      destination?: string;
      sent?: boolean;
      message?: string;
      receiptStatus?: string;
      recipientTextCheck?: string;
      sendStatusCheck?: string;
      evidenceConfidence?: number;
      evidenceLimitations?: string[];
      simulationStatus?: string;
      semanticSummary?: {
        conclusion?: string;
        keyAssertion?: string;
        recovery?: string;
      };
    }>;
  };
}

interface PolicyDomainRow {
  domain: string;
  status: 'running' | 'paused';
}

interface GatewayResponseFrame {
  type: 'response';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
}

function readGatewayTokenFromQuery(): string {
  const token = new URLSearchParams(location.search).get('token');
  return token ? token.trim() : '';
}

function readGatewayTokenFromStorage(): string {
  try {
    return String(localStorage.getItem('miya_gateway_token') ?? '').trim();
  } catch {
    return '';
  }
}

function writeGatewayTokenToStorage(token: string): void {
  if (!token) return;
  try {
    localStorage.setItem('miya_gateway_token', token);
  } catch {}
}

function resolveGatewayToken(): string {
  const fromQuery = readGatewayTokenFromQuery();
  if (fromQuery) {
    writeGatewayTokenToStorage(fromQuery);
    return fromQuery;
  }
  return readGatewayTokenFromStorage();
}

interface MiyaJob {
  id: string;
  name: string;
}

interface MiyaJobRun {
  id: string;
  jobId: string;
  jobName: string;
  trigger: 'scheduler' | 'manual' | 'approval';
  startedAt: string;
  endedAt: string;
  status: 'success' | 'failed' | 'skipped';
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

type UiTaskStatus = 'completed' | 'running' | 'failed' | 'stopped';

interface TaskRecord {
  id: string;
  jobId?: string;
  title: string;
  trigger: string;
  startedAt: string;
  endedAt?: string;
  durationText: string;
  sourceText: string;
  status: UiTaskStatus;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
}

function parseRoute(pathname: string): { view: ControlView; taskId?: string; basePath: string } {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const matched = normalized.match(/^(.*)\/tasks(?:\/([^/]+))?$/);
  if (matched) {
    return {
      view: matched[2] ? 'tasks-detail' : 'tasks-list',
      taskId: matched[2] ? decodeURIComponent(matched[2]) : undefined,
      basePath: matched[1] || '',
    };
  }
  return {
    view: 'modules',
    basePath: normalized === '/' ? '' : normalized,
  };
}

function buildRoute(basePath: string, view: ControlView, taskId?: string): string {
  const base = basePath || '';
  if (view === 'modules') return base || '/';
  if (view === 'tasks-list') return `${base}/tasks`;
  return `${base}/tasks/${encodeURIComponent(taskId || '')}`;
}

function killSwitchLabel(mode: KillSwitchMode): string {
  if (mode === 'all_stop') return '全部停止';
  if (mode === 'outbound_only') return '仅停外发';
  if (mode === 'desktop_only') return '仅停桌控';
  return '正常运行';
}

function trustTierLabel(tier: NexusTrustSnapshot['tier']): string {
  if (tier === 'high') return '高';
  if (tier === 'medium') return '中';
  return '低';
}

function domainLabel(domain: string): string {
  if (domain === 'outbound_send') return '消息外发';
  if (domain === 'desktop_control') return '桌面控制';
  if (domain === 'memory_read') return '记忆读取';
  return domain;
}

function statusTone(status?: string): string {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'running' || normalized === 'completed' || normalized === 'connected') {
    return 'text-emerald-700';
  }
  if (normalized === 'paused' || normalized === 'queued' || normalized === 'degraded') {
    return 'text-amber-700';
  }
  return 'text-rose-700';
}

function guardianReasonLabel(reason?: string): string {
  if (!reason) return '无';
  if (reason === 'resonance_disabled') return '共鸣层已关闭，自动触达进入静默等待';
  if (reason === 'psyche_consult_unavailable') return '守门员离线，已自动降级为静默模式';
  return reason;
}

function formatHubAge(ageMs?: number): string {
  if (!Number.isFinite(ageMs)) return '-';
  const sec = Math.max(0, Math.floor(Number(ageMs) / 1000));
  return `${sec}s`;
}

function evidenceImageUrl(auditID?: string, slot: 'pre' | 'post' = 'pre'): string {
  if (!auditID) return '';
  const params = new URLSearchParams({
    auditID,
    slot,
  });
  return `/api/evidence/image?${params.toString()}`;
}

function formatDateTime(input?: string): string {
  if (!input) return '-';
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return input;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatDuration(startedAt?: string, endedAt?: string): string {
  if (!startedAt) return '-';
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return '-';
  const end = endedAt ? Date.parse(endedAt) : Date.now();
  if (!Number.isFinite(end) || end < start) return '-';
  const sec = Math.floor((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function taskStatusMeta(status: UiTaskStatus): { text: string; className: string } {
  if (status === 'completed') return { text: '已完成', className: 'bg-emerald-500 text-white' };
  if (status === 'running') return { text: '执行中', className: 'bg-sky-500 text-white' };
  if (status === 'failed') return { text: '执行失败', className: 'bg-rose-500 text-white' };
  return { text: '已终止', className: 'bg-slate-400 text-white' };
}

function normalizeTaskStatus(status: MiyaJobRun['status']): UiTaskStatus {
  if (status === 'success') return 'completed';
  if (status === 'failed') return 'failed';
  return 'stopped';
}

async function invokeGateway(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const reqId = `ui-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const token = resolveGatewayToken();

  return await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`gateway_request_timeout:${method}`));
    }, 10000);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          role: 'ui',
          clientID: 'gateway-ui',
          protocolVersion: '1.1',
          auth: token ? { token } : undefined,
        }),
      );
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('gateway_ws_error'));
    };

    ws.onmessage = (event) => {
      let frame: GatewayResponseFrame | null = null;
      try {
        frame = JSON.parse(String(event.data)) as GatewayResponseFrame;
      } catch {
        return;
      }
      if (!frame || frame.type !== 'response') return;
      if (frame.id === 'hello') {
        if (!frame.ok) {
          clearTimeout(timeout);
          ws.close();
          reject(
            new Error(
              frame.error?.message === 'invalid_gateway_token'
                ? 'invalid_gateway_token: 请使用带 token 的控制台链接重新打开'
                : frame.error?.message || 'gateway_hello_failed',
            ),
          );
          return;
        }
        ws.send(
          JSON.stringify({
            type: 'request',
            id: reqId,
            method,
            params,
          }),
        );
        return;
      }
      if (frame.id !== reqId) return;
      clearTimeout(timeout);
      ws.close();
      if (frame.ok) {
        resolve(frame.result);
      } else {
        reject(new Error(frame.error?.message || 'gateway_request_failed'));
      }
    };
  });
}

export default function App() {
  const routeState = parseRoute(location.pathname);
  const [snapshot, setSnapshot] = useState<GatewaySnapshot>({});
  const [domains, setDomains] = useState<PolicyDomainRow[]>([]);
  const [jobs, setJobs] = useState<MiyaJob[]>([]);
  const [taskRuns, setTaskRuns] = useState<MiyaJobRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [successText, setSuccessText] = useState('');
  const [insightText, setInsightText] = useState('');
  const [view, setView] = useState<ControlView>(routeState.view);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(routeState.taskId);
  const [basePath, setBasePath] = useState(routeState.basePath);
  const [taskFilter, setTaskFilter] = useState<TaskStatusFilter>('all');
  const [expandedTaskLogs, setExpandedTaskLogs] = useState<Record<string, boolean>>({});
  const [trustModeForm, setTrustModeForm] = useState<TrustModeConfig>({
    silentMin: 90,
    modalMax: 50,
  });
  const [psycheModeForm, setPsycheModeForm] = useState<PsycheModeConfig>({
    resonanceEnabled: true,
    captureProbeEnabled: true,
    proactivePingEnabled: true,
    proactivePingMinIntervalMinutes: 90,
    proactivePingMaxPerDay: 12,
    quietHoursEnabled: true,
    quietHoursStart: '23:00',
    quietHoursEnd: '08:00',
  });

  const refresh = useCallback(async () => {
    try {
      const statusRes = await fetch('/api/status', { cache: 'no-store' });
      if (!statusRes.ok) {
        setConnected(false);
        return;
      }
      const status = (await statusRes.json()) as GatewaySnapshot;
      setSnapshot(status);
      const rpcErrors: string[] = [];
      const [domainsResult, jobsResult, runsResult] = await Promise.allSettled([
        invokeGateway('policy.domains.list'),
        invokeGateway('cron.list'),
        invokeGateway('cron.runs.list', { limit: 80 }),
      ]);

      if (domainsResult.status === 'fulfilled') {
        const rows = (domainsResult.value as { domains?: PolicyDomainRow[] }).domains ?? [];
        setDomains(rows);
      } else {
        rpcErrors.push(
          domainsResult.reason instanceof Error
            ? domainsResult.reason.message
            : String(domainsResult.reason),
        );
      }
      if (jobsResult.status === 'fulfilled') {
        setJobs(Array.isArray(jobsResult.value) ? (jobsResult.value as MiyaJob[]) : []);
      } else {
        rpcErrors.push(
          jobsResult.reason instanceof Error
            ? jobsResult.reason.message
            : String(jobsResult.reason),
        );
      }
      if (runsResult.status === 'fulfilled') {
        setTaskRuns(Array.isArray(runsResult.value) ? (runsResult.value as MiyaJobRun[]) : []);
      } else {
        rpcErrors.push(
          runsResult.reason instanceof Error
            ? runsResult.reason.message
            : String(runsResult.reason),
        );
      }
      const tokenError = rpcErrors.find((item) => item.includes('invalid_gateway_token'));
      setConnected(Boolean(status.daemon?.connected) && !tokenError);
      const incomingMode = status.nexus?.trustMode;
      if (incomingMode) {
        setTrustModeForm(incomingMode);
      }
      const incomingPsycheMode = status.nexus?.psycheMode;
      if (incomingPsycheMode) {
        setPsycheModeForm((prev) => ({ ...prev, ...incomingPsycheMode }));
      }
      if (rpcErrors.length > 0) {
        setErrorText(tokenError ?? rpcErrors[0]);
      } else {
        setErrorText('');
      }
    } catch (error) {
      setConnected(false);
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 2500);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const onPopState = () => {
      const route = parseRoute(location.pathname);
      setView(route.view);
      setSelectedTaskId(route.taskId);
      setBasePath(route.basePath);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback(
    (nextView: ControlView, taskId?: string) => {
      const nextPath = buildRoute(basePath, nextView, taskId);
      const nextUrl = `${nextPath}${location.search || ''}${location.hash || ''}`;
      if (nextUrl !== `${location.pathname}${location.search}${location.hash}`) {
        history.pushState({}, '', nextUrl);
      }
      setView(nextView);
      setSelectedTaskId(taskId);
    },
    [basePath],
  );

  const killSwitchMode = snapshot.nexus?.killSwitchMode ?? 'off';
  const trust = snapshot.nexus?.trust;
  const signalHub = snapshot.daemon?.psycheSignalHub;

  const quickStats = useMemo(
    () => [
      {
        title: '连接状态',
        value: connected ? '在线' : '离线',
        desc: `守门员 CPU ${(snapshot.daemon?.cpuPercent ?? 0).toFixed(1)}%`,
      },
      {
        title: '会话',
        value: `${snapshot.sessions?.active ?? 0}/${snapshot.sessions?.total ?? 0}`,
        desc: `排队 ${snapshot.sessions?.queued ?? 0}，静音 ${snapshot.sessions?.muted ?? 0}`,
      },
      {
        title: '任务',
        value: `${snapshot.jobs?.enabled ?? 0}/${snapshot.jobs?.total ?? 0}`,
        desc: `待审批 ${snapshot.jobs?.pendingApprovals ?? 0}`,
      },
      {
        title: '风险票据',
        value: String(snapshot.nexus?.pendingTickets ?? 0),
        desc: `守门员：${guardianReasonLabel(snapshot.nexus?.guardianSafeHoldReason)}`,
      },
    ],
    [connected, snapshot],
  );

  const jobNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const job of jobs) map.set(job.id, job.name);
    return map;
  }, [jobs]);

  const taskRecords = useMemo<TaskRecord[]>(() => {
    const records: TaskRecord[] = taskRuns.map((run) => ({
      id: run.id,
      jobId: run.jobId,
      title: run.jobName || jobNameMap.get(run.jobId) || run.jobId || '未命名任务',
      trigger: run.trigger,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      durationText: formatDuration(run.startedAt, run.endedAt),
      sourceText: `触发方式：${run.trigger} · 退出码：${run.exitCode ?? '-'}${run.timedOut ? ' · 已超时' : ''}`,
      status: normalizeTaskStatus(run.status),
      stdout: run.stdout || undefined,
      stderr: run.stderr || undefined,
      timedOut: run.timedOut,
    }));

    const activeJobID = snapshot.daemon?.activeJobID;
    if (activeJobID && !records.some((item) => item.jobId === activeJobID && item.status === 'running')) {
      records.unshift({
        id: `live-${activeJobID}`,
        jobId: activeJobID,
        title: jobNameMap.get(activeJobID) || `执行任务 ${activeJobID}`,
        trigger: 'scheduler',
        startedAt: snapshot.updatedAt || new Date().toISOString(),
        durationText: '进行中',
        sourceText: '实时执行中',
        status: 'running',
      });
    }

    return records;
  }, [jobNameMap, snapshot.daemon?.activeJobID, snapshot.updatedAt, taskRuns]);

  const filteredTaskRecords = useMemo(
    () => taskRecords.filter((item) => (taskFilter === 'all' ? true : item.status === taskFilter)),
    [taskFilter, taskRecords],
  );

  const selectedTask = useMemo(
    () => taskRecords.find((item) => item.id === selectedTaskId) ?? null,
    [selectedTaskId, taskRecords],
  );

  const selectedTaskProgress = useMemo(() => {
    if (!selectedTask) return 0;
    if (selectedTask.status !== 'running') return 100;
    const progress = snapshot.daemon?.activeJobProgress;
    if (typeof progress === 'number' && Number.isFinite(progress)) {
      return Math.max(0, Math.min(100, Math.floor(progress * 100)));
    }
    return 45;
  }, [selectedTask, snapshot.daemon?.activeJobProgress]);

  const runAction = async (task: () => Promise<unknown>, successMessage: string) => {
    setLoading(true);
    setSuccessText('');
    try {
      await task();
      await refresh();
      setSuccessText(successMessage);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const setKillSwitchMode = async (mode: KillSwitchMode) => {
    if (mode === 'all_stop') {
      const confirmed = window.confirm('这会立即停止外发和桌面控制。确定继续吗？');
      if (!confirmed) return;
    }
    await runAction(async () => {
      await invokeGateway('killswitch.set_mode', { mode });
    }, `已切换为：${killSwitchLabel(mode)}`);
  };

  const rerunTask = async (task: TaskRecord) => {
    if (!task.jobId) {
      setErrorText('该任务没有关联 jobID，无法重新执行。');
      return;
    }
    const policyHash = snapshot.policyHash;
    if (!policyHash) {
      setErrorText('缺少策略哈希，无法执行高风险操作，请刷新后重试。');
      return;
    }
    await runAction(async () => {
      await invokeGateway('cron.run.now', { jobID: task.jobId, policyHash });
    }, `已触发重新执行：${task.title}`);
  };

  const deleteTaskHistory = async (task: TaskRecord) => {
    const policyHash = snapshot.policyHash;
    if (!policyHash) {
      setErrorText('缺少策略哈希，无法删除任务记录，请刷新后重试。');
      return;
    }
    await runAction(async () => {
      const result = (await invokeGateway('cron.runs.remove', {
        runID: task.id,
        policyHash,
      })) as { removed?: boolean };
      if (!result?.removed) {
        throw new Error('task_history_not_found_or_delete_failed');
      }
      if (view === 'tasks-detail') {
        navigate('tasks-list');
      }
    }, `已删除任务记录：${task.id}`);
  };

  const exportTaskLogs = (task: TaskRecord) => {
    const payload = {
      id: task.id,
      jobId: task.jobId,
      title: task.title,
      trigger: task.trigger,
      status: task.status,
      startedAt: task.startedAt,
      endedAt: task.endedAt,
      stdout: task.stdout ?? '',
      stderr: task.stderr ?? '',
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `task-log-${task.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSuccessText(`已导出任务日志：${task.id}`);
  };

  const panelClass = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';

  return (
    <div className="min-h-screen bg-[#dfe7ec] text-slate-700">
      <div className="mx-auto flex max-w-[1520px] gap-4 p-3 md:p-5">
        <aside className="hidden w-[300px] shrink-0 flex-col rounded-3xl border border-slate-200 bg-[#f4f8fb] shadow-sm lg:flex">
          <div className="border-b border-slate-200 p-6">
            <p className="text-4xl leading-none">M</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-wide text-slate-800">Miya</h1>
            <p className="mt-1 text-sm text-slate-500">控制台</p>
          </div>
          <nav className="space-y-1 px-3 py-4 text-base">
            {[
              { key: 'modules', label: '控制中心' },
              { key: 'tasks', label: '任务' },
            ].map((item) => {
              const active = (view === 'modules' && item.key === 'modules') || (view !== 'modules' && item.key === 'tasks');
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    if (item.key === 'tasks') navigate('tasks-list');
                    if (item.key === 'modules') navigate('modules');
                  }}
                  className={`flex w-full items-center rounded-xl px-4 py-3 text-left ${active ? 'border border-sky-200 bg-sky-100 text-sky-700' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="mt-auto border-t border-slate-200 p-4 text-sm text-slate-500">
            <p>配置</p>
            <p className="mt-3">Gateway UI v1.0</p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 space-y-4 rounded-3xl border border-slate-200 bg-[#eef3f7] p-3 md:p-5">
          <header className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4">
                <p className="rounded-lg bg-slate-100 px-3 py-2 text-xl font-semibold text-slate-800">default</p>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  <span>{connected ? '运行中' : '已降级'}</span>
                </div>
                <p className="text-sm text-slate-500">{snapshot.nodes?.connected ?? 0} 端点</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
                >
                  刷新
                </button>
                <span className={`rounded-full px-3 py-1 text-xs ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                  {connected ? '系统在线' : '系统降级'}
                </span>
              </div>
            </div>
            {errorText ? <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">错误：{errorText}</p> : null}
            {successText ? (
              <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">成功：{successText}</p>
            ) : null}
          </header>

          <nav className="flex flex-wrap gap-2 lg:hidden">
            {[
              { key: 'modules', label: '控制中心' },
              { key: 'tasks', label: '任务' },
            ].map((item) => {
              const active = (view === 'modules' && item.key === 'modules') || (view !== 'modules' && item.key === 'tasks');
              return (
                <button
                  key={`mobile-${item.key}`}
                  type="button"
                  onClick={() => {
                    if (item.key === 'tasks') navigate('tasks-list');
                    if (item.key === 'modules') navigate('modules');
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${active ? 'border-sky-200 bg-sky-100 text-sky-700' : 'border-slate-300 bg-white text-slate-600'}`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {view === 'tasks-list' ? (
            <section className={panelClass}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-3xl font-semibold text-slate-800">任务管理</h2>
                  <p className="mt-2 text-sm text-slate-500">查看与管理所有执行过的任务记录，点击任务查看详情。</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={taskFilter}
                    onChange={(event) => setTaskFilter(event.target.value as TaskStatusFilter)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700"
                  >
                    <option value="all">全部状态</option>
                    <option value="completed">已完成</option>
                    <option value="running">执行中</option>
                    <option value="failed">执行失败</option>
                    <option value="stopped">已终止</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    刷新
                  </button>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {filteredTaskRecords.length === 0 ? (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">暂无任务记录</p>
                ) : (
                  filteredTaskRecords.map((task) => {
                    const statusMeta = taskStatusMeta(task.status);
                    return (
                      <button
                        type="button"
                        key={task.id}
                        onClick={() => navigate('tasks-detail', task.id)}
                        className="flex w-full cursor-pointer flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-left transition hover:border-sky-200 hover:bg-sky-50 md:flex-row md:items-center"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-lg font-semibold text-slate-800">{task.title}</p>
                          <p className="mt-1 text-xs text-slate-600">{formatDateTime(task.startedAt)} · 耗时 {task.durationText}</p>
                          <p className="mt-1 text-xs text-slate-500">{task.sourceText}</p>
                        </div>
                        <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-medium ${statusMeta.className}`}>
                          {statusMeta.text}
                        </span>
                        <span className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700">
                          查看详情
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          ) : null}

          {view === 'tasks-detail' ? (
            <section className="space-y-4">
              <article className={panelClass}>
                <button
                  type="button"
                  onClick={() => navigate('tasks-list')}
                  className="text-sm text-sky-700 hover:text-sky-800"
                >
                  {'< 返回任务列表'}
                </button>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <h2 className="text-3xl font-semibold text-slate-800">{selectedTask?.title || '任务详情'}</h2>
                  {selectedTask ? (
                    <span className={`rounded-full px-3 py-1 text-xs ${taskStatusMeta(selectedTask.status).className}`}>
                      {taskStatusMeta(selectedTask.status).text}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  开始：{formatDateTime(selectedTask?.startedAt)} · 结束：{formatDateTime(selectedTask?.endedAt)} · 总时长：{selectedTask?.durationText || '-'} · 触发：{selectedTask?.trigger || '-'}
                </p>
              </article>
              {!selectedTask ? (
                <article className={panelClass}>
                  <p className="text-sm text-slate-500">该任务不存在或已被清理，请返回列表刷新后重试。</p>
                </article>
              ) : (
                <>
                  <article className={panelClass}>
                    <h3 className="text-base font-semibold text-slate-800">任务进度</h3>
                    <div className="mt-3 h-2 w-full rounded-full bg-slate-200">
                      <div className="h-2 rounded-full bg-sky-500" style={{ width: `${selectedTaskProgress}%` }} />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">当前完成度：{selectedTaskProgress}%</p>
                  </article>
                  <article className={panelClass}>
                    <h3 className="text-base font-semibold text-slate-800">执行日志与错误信息</h3>
                    <div className="mt-3 space-y-2">
                      {selectedTask.stderr ? (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                          <p className="text-xs font-medium text-rose-700">错误日志</p>
                          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-rose-700">
                            {expandedTaskLogs[selectedTask.id] ? selectedTask.stderr : selectedTask.stderr.slice(0, 600)}
                          </pre>
                        </div>
                      ) : null}
                      {selectedTask.stdout ? (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-medium text-slate-700">普通日志</p>
                          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                            {expandedTaskLogs[selectedTask.id] ? selectedTask.stdout : selectedTask.stdout.slice(0, 600)}
                          </pre>
                        </div>
                      ) : null}
                      {(selectedTask.stdout?.length || 0) > 600 || (selectedTask.stderr?.length || 0) > 600 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedTaskLogs((prev) => ({
                              ...prev,
                              [selectedTask.id]: !prev[selectedTask.id],
                            }))
                          }
                          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                        >
                          {expandedTaskLogs[selectedTask.id] ? '折叠日志' : '展开日志'}
                        </button>
                      ) : null}
                    </div>
                  </article>
                  <article className={panelClass}>
                    <h3 className="text-base font-semibold text-slate-800">获得的经验与习惯</h3>
                    <div className="mt-3 space-y-2 text-sm text-slate-700">
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">任务来源：<span className="font-medium">{selectedTask.trigger}</span>，建议后续同类任务保持相同触发方式。</p>
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">执行表现：<span className="font-medium">{taskStatusMeta(selectedTask.status).text}</span>，时长 {selectedTask.durationText}。</p>
                    </div>
                  </article>
                  <article className={panelClass}>
                    <h3 className="text-base font-semibold text-slate-800">记忆写入记录</h3>
                    <p className="mt-2 text-xs text-slate-500">当前网关未提供单任务记忆写入明细接口，以下基于系统时间线生成摘要。</p>
                    <div className="mt-3 space-y-2 text-xs">
                      {(snapshot.nexus?.insights || []).slice(0, 5).map((item, index) => (
                        <div key={`${item.at || 'insight'}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700">更新</span>
                            <span className="text-slate-500">{formatDateTime(item.at)}</span>
                          </div>
                          <p className="mt-1 text-slate-700">{item.text || '无内容'}</p>
                        </div>
                      ))}
                    </div>
                  </article>
                  <article className={`${panelClass} flex flex-wrap gap-2`}>
                    <button
                      type="button"
                      onClick={() => void rerunTask(selectedTask)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs hover:bg-slate-100"
                    >
                      重新执行任务
                    </button>
                    <button
                      type="button"
                      onClick={() => exportTaskLogs(selectedTask)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs hover:bg-slate-100"
                    >
                      导出任务日志
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteTaskHistory(selectedTask)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs hover:bg-slate-100"
                    >
                      删除任务记录
                    </button>
                  </article>
                </>
              )}
            </section>
          ) : null}

          <div className={view === 'modules' ? 'space-y-4' : 'hidden'}>
          <section className={`${panelClass}`}>
            <h2 className="text-3xl font-semibold text-slate-800">模块管理</h2>
            <p className="mt-2 text-sm text-slate-500">管理控制面板与安全模块。先看状态，再操作，再写入时间线。</p>
            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
              {quickStats.map((item) => (
                <article key={item.title} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-xs text-slate-500">{item.title}</p>
                  <p className="mt-1 text-lg font-semibold text-slate-800">{item.value}</p>
                  <p className="mt-1 text-xs text-slate-600">{item.desc}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <article className={panelClass}>
              <h2 className="text-base font-semibold text-slate-800">Psyche Signal Hub</h2>
              {signalHub ? (
                <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p>运行状态：{signalHub.running ? 'running' : 'stopped'}</p>
                    <p>序号：{signalHub.sequence ?? '-'}</p>
                    <p>最近采样年龄：{formatHubAge(signalHub.ageMs)}</p>
                    <p>过期：{signalHub.stale ? 'yes' : 'no'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p>连续失败：{signalHub.consecutiveFailures ?? 0}</p>
                    <p>采样间隔：{signalHub.sampleIntervalMs ?? '-'}ms</p>
                    <p>突发间隔：{signalHub.burstIntervalMs ?? '-'}ms</p>
                    <p>过期阈值：{signalHub.staleAfterMs ?? '-'}ms</p>
                  </div>
                  {signalHub.lastError ? <p className="text-rose-700 md:col-span-2">lastError: {signalHub.lastError}</p> : null}
                </div>
              ) : (
                <p className="mt-2 text-xs text-amber-700">未收到 daemon signal hub 指标。</p>
              )}
            </article>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <article className={panelClass}>
            <h2 className="text-sm font-semibold">安全总开关（紧急开关）</h2>
            <p className="mt-1 text-xs text-slate-500">当前模式：{killSwitchLabel(killSwitchMode)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {([
                { mode: 'off', text: '正常运行', hint: '外发和桌控都可用' },
                { mode: 'outbound_only', text: '暂停外发', hint: '停止发送消息，但保留桌控' },
                { mode: 'desktop_only', text: '暂停桌控', hint: '禁止鼠标键盘自动操作' },
                { mode: 'all_stop', text: '全部停止', hint: '紧急止损，全部停机' },
              ] as Array<{ mode: KillSwitchMode; text: string; hint: string }>).map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  disabled={loading}
                  onClick={() => void setKillSwitchMode(item.mode)}
                  className={`rounded-lg border px-2 py-2 text-left text-xs ${killSwitchMode === item.mode ? 'border-sky-300 bg-sky-50' : 'border-slate-300 hover:bg-slate-100'}`}
                >
                  <p className="font-medium">{item.text}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{item.hint}</p>
                </button>
              ))}
            </div>
          </article>

          <article className={panelClass}>
            <h2 className="text-sm font-semibold">信任阈值（审批疲劳优化）</h2>
            <p className="mt-1 text-xs text-slate-500">分数高于静默阈值可自动放行，低于阻断阈值必须人工确认。</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <label className="flex flex-col gap-1">
                <span>静默阈值（推荐 90）</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={trustModeForm.silentMin}
                  onChange={(event) =>
                    setTrustModeForm((prev) => ({ ...prev, silentMin: Number(event.target.value) }))
                  }
                  className="rounded border border-slate-300 bg-white px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span>阻断阈值（推荐 50）</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={trustModeForm.modalMax}
                  onChange={(event) =>
                    setTrustModeForm((prev) => ({ ...prev, modalMax: Number(event.target.value) }))
                  }
                  className="rounded border border-slate-300 bg-white px-2 py-1"
                />
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() =>
                  void runAction(async () => {
                    await invokeGateway('trust.set_mode', trustModeForm as unknown as Record<string, unknown>);
                  }, '信任阈值已保存')
                }
                className="rounded-lg border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100"
              >
                保存
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setTrustModeForm({ silentMin: 90, modalMax: 50 });
                }}
                className="rounded-lg border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100"
              >
                恢复推荐值
              </button>
            </div>
            {trust ? (
              <p className="mt-2 text-xs text-slate-500">
                当前信任：{trust.minScore}（{trustTierLabel(trust.tier)}）/ 目标 {trust.target}，来源 {trust.source}，动作 {trust.action}
              </p>
            ) : null}
          </article>

          <article className={panelClass}>
            <h2 className="text-sm font-semibold">守门员开关（新手推荐）</h2>
            <p className="mt-1 text-xs text-slate-500">关闭共鸣层后，自动触达将进入静默等待；关闭截图核验后，系统不再做截图/VLM探测。</p>
            <div className="mt-3 space-y-2 text-xs">
              <label className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
                <span>共鸣层（主动陪伴）</span>
                <input
                  type="checkbox"
                  checked={psycheModeForm.resonanceEnabled}
                  onChange={(event) =>
                    setPsycheModeForm((prev) => ({ ...prev, resonanceEnabled: event.target.checked }))
                  }
                />
              </label>
              <label className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
                <span>截图/VLM 核验</span>
                <input
                  type="checkbox"
                  checked={psycheModeForm.captureProbeEnabled}
                  onChange={(event) =>
                    setPsycheModeForm((prev) => ({
                      ...prev,
                      captureProbeEnabled: event.target.checked,
                    }))
                  }
                />
              </label>
              <label className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
                <span>proactive_ping（主动问候）</span>
                <input
                  type="checkbox"
                  checked={Boolean(psycheModeForm.proactivePingEnabled)}
                  onChange={(event) =>
                    setPsycheModeForm((prev) => ({
                      ...prev,
                      proactivePingEnabled: event.target.checked,
                    }))
                  }
                />
              </label>
              <label className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
                <span>quiet_hours（静默时段）</span>
                <input
                  type="checkbox"
                  checked={Boolean(psycheModeForm.quietHoursEnabled)}
                  onChange={(event) =>
                    setPsycheModeForm((prev) => ({
                      ...prev,
                      quietHoursEnabled: event.target.checked,
                    }))
                  }
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 rounded border border-slate-200 bg-slate-50 px-3 py-2">
                  <span>最小间隔（分钟）</span>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={psycheModeForm.proactivePingMinIntervalMinutes ?? 90}
                    onChange={(event) =>
                      setPsycheModeForm((prev) => ({
                        ...prev,
                        proactivePingMinIntervalMinutes: Number(event.target.value),
                      }))
                    }
                    className="rounded border border-slate-300 bg-white px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1 rounded border border-slate-200 bg-slate-50 px-3 py-2">
                  <span>每日上限</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={psycheModeForm.proactivePingMaxPerDay ?? 12}
                    onChange={(event) =>
                      setPsycheModeForm((prev) => ({
                        ...prev,
                        proactivePingMaxPerDay: Number(event.target.value),
                      }))
                    }
                    className="rounded border border-slate-300 bg-white px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1 rounded border border-slate-200 bg-slate-50 px-3 py-2">
                  <span>静默开始</span>
                  <input
                    type="time"
                    value={psycheModeForm.quietHoursStart ?? '23:00'}
                    onChange={(event) =>
                      setPsycheModeForm((prev) => ({
                        ...prev,
                        quietHoursStart: event.target.value,
                      }))
                    }
                    className="rounded border border-slate-300 bg-white px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1 rounded border border-slate-200 bg-slate-50 px-3 py-2">
                  <span>静默结束</span>
                  <input
                    type="time"
                    value={psycheModeForm.quietHoursEnd ?? '08:00'}
                    onChange={(event) =>
                      setPsycheModeForm((prev) => ({
                        ...prev,
                        quietHoursEnd: event.target.value,
                      }))
                    }
                    className="rounded border border-slate-300 bg-white px-2 py-1"
                  />
                </label>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              当前降级原因：{guardianReasonLabel(snapshot.nexus?.guardianSafeHoldReason)}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() =>
                  void runAction(async () => {
                    await invokeGateway('psyche.mode.set', psycheModeForm as unknown as Record<string, unknown>);
                  }, '守门员开关已保存')
                }
                className="rounded-lg border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100"
              >
                保存守门员设置
              </button>
            </div>
          </article>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <article className={panelClass}>
            <h2 className="text-sm font-semibold">能力域状态</h2>
            <p className="mt-1 text-xs text-slate-500">可直接暂停/恢复单个能力域。</p>
            <div className="mt-3 space-y-2">
              {domains.map((domain) => (
                <div key={domain.domain} className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
                  <div>
                    <p className="font-medium">{domainLabel(domain.domain)}</p>
                    <p className={statusTone(domain.status)}>{domain.status === 'running' ? '运行中' : '已暂停'}</p>
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() =>
                      void runAction(async () => {
                        await invokeGateway(
                          domain.status === 'running' ? 'policy.domain.pause' : 'policy.domain.resume',
                          { domain: domain.domain },
                        );
                      }, `${domainLabel(domain.domain)} 已${domain.status === 'running' ? '暂停' : '恢复'}`)
                    }
                    className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-100"
                  >
                    {domain.status === 'running' ? '暂停' : '恢复'}
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">策略哈希：{snapshot.policyHash ?? '暂无'}</p>
          </article>

          <article className={panelClass}>
            <h2 className="text-sm font-semibold">节点状态</h2>
            <p className="mt-1 text-xs text-slate-500">
              在线节点 {snapshot.nodes?.connected ?? 0} / {snapshot.nodes?.total ?? 0}
            </p>
            <div className="mt-3 max-h-60 space-y-2 overflow-auto pr-1">
              {(snapshot.nodes?.list ?? []).map((node, index) => (
                <div
                  key={node.id ?? `${node.label ?? 'node'}-${node.platform ?? 'unknown'}-${index}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                >
                  <p className="font-medium">{node.label || node.id || '未命名节点'}</p>
                  <p className={node.connected ? 'text-emerald-700' : 'text-rose-700'}>
                    {node.connected ? '在线' : '离线'}
                  </p>
                  <p className="text-slate-500">平台：{node.platform || '未知'}</p>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <article className={panelClass}>
            <h2 className="text-sm font-semibold">最近任务执行</h2>
            <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
              {(snapshot.jobs?.recentRuns ?? []).map((run, index) => (
                <div key={`${run.id ?? 'run'}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                  <p className="font-medium">{run.id ?? '任务'}</p>
                  <p className={statusTone(run.status)}>{run.status ?? '未知状态'}</p>
                  <p className="text-slate-500">触发方式：{run.trigger ?? '手动'} / 更新时间：{run.updatedAt ?? '暂无'}</p>
                </div>
              ))}
            </div>
          </article>

          <article className={panelClass}>
            <h2 className="text-sm font-semibold">系统时间线</h2>
            <p className="mt-1 text-xs text-slate-500">人工干预后建议写一条备注，后续排障更快。</p>
            <div className="mt-2 flex gap-2">
              <input
                value={insightText}
                onChange={(event) => setInsightText(event.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                placeholder="例如：已手工暂停外发，等本人确认。"
              />
              <button
                type="button"
                disabled={loading || !insightText.trim()}
                onClick={() =>
                  void runAction(async () => {
                    await invokeGateway('insight.append', { text: insightText.trim() });
                    setInsightText('');
                  }, '备注已写入时间线')
                }
                className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
              >
                记录
              </button>
            </div>
            <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
              {(snapshot.nexus?.insights ?? []).map((item, index) => (
                <div key={`${item.at ?? 'ins'}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                  <p className="text-slate-700">{item.text ?? '无内容'}</p>
                  <p className="text-slate-500">{item.at ?? '暂无'} {item.auditID ? `| ${item.auditID}` : ''}</p>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="grid grid-cols-1 gap-4">
          <article className={panelClass}>
            <h2 className="text-sm font-semibold">Evidence Pack V5（外发证据预览）</h2>
            <p className="mt-1 text-xs text-slate-500">用于审批前快速核验：目标、发送状态、截图、限制项。</p>
            <div className="mt-3 max-h-[28rem] space-y-3 overflow-auto pr-1">
              {(snapshot.channels?.recentOutbound ?? []).slice(0, 10).map((row, index) => (
                <div key={`${row.id ?? 'audit'}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {row.channel ?? 'channel'}
                      {' -> '}
                      {row.destination ?? 'unknown'}
                    </p>
                    <span className={row.sent ? 'text-emerald-700' : 'text-rose-700'}>
                      {row.sent ? '已发送' : '已阻断'}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600">{row.message ?? '-'}</p>
                  <p className="mt-1 text-slate-500">
                    审计ID: {row.id ?? '-'} | 时间: {row.at ?? '-'} | 置信度: {typeof row.evidenceConfidence === 'number' ? row.evidenceConfidence.toFixed(2) : '-'}
                  </p>
                  <p className="mt-1 text-slate-500">
                    recipient={row.recipientTextCheck ?? '-'} | send={row.sendStatusCheck ?? '-'} | receipt={row.receiptStatus ?? '-'} | simulation={row.simulationStatus ?? '-'}
                  </p>
                  {Array.isArray(row.evidenceLimitations) && row.evidenceLimitations.length > 0 ? (
                    <p className="mt-1 text-amber-700">limitations: {row.evidenceLimitations.join(', ')}</p>
                  ) : null}
                  {row.semanticSummary?.conclusion ? (
                    <p className="mt-1 text-slate-600">结论: {row.semanticSummary.conclusion}</p>
                  ) : null}
                  {row.id ? (
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                      <img
                        src={evidenceImageUrl(row.id, 'pre')}
                        alt="pre-send evidence"
                        loading="lazy"
                        className="max-h-44 w-full rounded border border-slate-200 object-cover"
                      />
                      <img
                        src={evidenceImageUrl(row.id, 'post')}
                        alt="post-send evidence"
                        loading="lazy"
                        className="max-h-44 w-full rounded border border-slate-200 object-cover"
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </article>
        </section>
        </div>
        </main>
      </div>
    </div>
  );
}
