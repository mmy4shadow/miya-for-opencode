import { useCallback, useEffect, useMemo, useState } from 'react';
import { GatewayRpcClient } from './gateway-client';

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
type ControlView =
  | 'modules'
  | 'tasks-list'
  | 'tasks-detail'
  | 'memory-list'
  | 'memory-detail'
  | 'gateway';
type TaskStatusFilter = 'all' | 'completed' | 'running' | 'failed' | 'stopped';
type MemoryStatusFilter =
  | 'all'
  | 'active'
  | 'pending'
  | 'superseded'
  | 'archived';
type MemoryDomainFilter = 'all' | 'work' | 'relationship';

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
  statusError?: {
    code?: string;
    message?: string;
    hint?: string;
  };
}

interface PolicyDomainRow {
  domain: string;
  status: 'running' | 'paused';
}

interface EmptyStateProps {
  title: string;
  description: string;
}

function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-lg text-slate-600">
        ···
      </div>
      <p className="mt-3 text-sm font-medium text-slate-700">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </div>
  );
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

function clearGatewayTokenInUrl(): void {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has('token')) return;
    url.searchParams.delete('token');
    const next =
      url.pathname +
      (url.searchParams.size > 0 ? `?${url.searchParams.toString()}` : '') +
      url.hash;
    history.replaceState({}, '', next);
  } catch {}
}

function sanitizedLocationSearch(): string {
  try {
    const params = new URLSearchParams(location.search);
    params.delete('token');
    const serialized = params.toString();
    return serialized ? `?${serialized}` : '';
  } catch {
    return '';
  }
}

function resolveGatewayToken(): string {
  const fromQuery = readGatewayTokenFromQuery();
  if (fromQuery) {
    writeGatewayTokenToStorage(fromQuery);
    clearGatewayTokenInUrl();
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

type NavKey = 'modules' | 'tasks' | 'memory' | 'gateway';

interface NavItem {
  key: NavKey;
  label: string;
  subtitle: string;
}

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

interface MemoryRecord {
  id: string;
  text: string;
  domain: 'work' | 'relationship';
  status: 'pending' | 'active' | 'superseded';
  isArchived: boolean;
  memoryKind?: 'Fact' | 'Insight' | 'UserPreference';
  semanticLayer?: 'episodic' | 'semantic' | 'preference' | 'tool_trace';
  learningStage?: 'ephemeral' | 'candidate' | 'persistent';
  confidence?: number;
  score?: number;
  sourceType?: string;
  createdAt?: string;
  updatedAt?: string;
  lastAccessedAt?: string;
}

function parseRoute(pathname: string): {
  view: ControlView;
  taskId?: string;
  memoryId?: string;
  basePath: string;
} {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const matched = normalized.match(/^(.*)\/tasks(?:\/([^/]+))?$/);
  if (matched) {
    return {
      view: matched[2] ? 'tasks-detail' : 'tasks-list',
      taskId: matched[2] ? decodeURIComponent(matched[2]) : undefined,
      basePath: matched[1] || '',
    };
  }
  const memoryMatched = normalized.match(/^(.*)\/memory(?:\/([^/]+))?$/);
  if (memoryMatched) {
    return {
      view: memoryMatched[2] ? 'memory-detail' : 'memory-list',
      memoryId: memoryMatched[2]
        ? decodeURIComponent(memoryMatched[2])
        : undefined,
      basePath: memoryMatched[1] || '',
    };
  }
  const gatewayMatched = normalized.match(/^(.*)\/gateway$/);
  if (gatewayMatched) {
    return {
      view: 'gateway',
      basePath: gatewayMatched[1] || '',
    };
  }
  return {
    view: 'modules',
    basePath: normalized === '/' ? '' : normalized,
  };
}

function buildRoute(
  basePath: string,
  view: ControlView,
  taskId?: string,
): string {
  const base = basePath || '';
  if (view === 'modules') return base || '/';
  if (view === 'tasks-list') return `${base}/tasks`;
  if (view === 'tasks-detail')
    return `${base}/tasks/${encodeURIComponent(taskId || '')}`;
  if (view === 'memory-list') return `${base}/memory`;
  if (view === 'memory-detail')
    return `${base}/memory/${encodeURIComponent(taskId || '')}`;
  return `${base}/gateway`;
}

function resolveGatewayBasePath(pathname: string = location.pathname): string {
  return parseRoute(pathname).basePath;
}

function withGatewayBasePath(
  suffix: `/${string}`,
  pathname?: string,
): string {
  const basePath = resolveGatewayBasePath(pathname ?? location.pathname);
  return basePath ? `${basePath}${suffix}` : suffix;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'modules', label: '控制中枢', subtitle: '总览与安全联锁' },
  { key: 'tasks', label: '作业中心', subtitle: '任务执行与回放' },
  { key: 'memory', label: '记忆库', subtitle: '记忆筛选与修订' },
  { key: 'gateway', label: '网关诊断', subtitle: '节点与连接态' },
];

function isNavActive(view: ControlView, key: NavKey): boolean {
  if (key === 'modules') return view === 'modules';
  if (key === 'tasks') return view === 'tasks-list' || view === 'tasks-detail';
  if (key === 'memory')
    return view === 'memory-list' || view === 'memory-detail';
  return view === 'gateway';
}

function targetViewForNav(key: NavKey): ControlView {
  if (key === 'tasks') return 'tasks-list';
  if (key === 'memory') return 'memory-list';
  if (key === 'gateway') return 'gateway';
  return 'modules';
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

function memoryDomainLabel(domain: MemoryRecord['domain']): string {
  return domain === 'work' ? '工作记忆' : '关系记忆';
}

function memoryStatusLabel(item: MemoryRecord): string {
  if (item.isArchived) return '已归档';
  if (item.status === 'active') return '生效中';
  if (item.status === 'pending') return '待确认';
  return '已替代';
}

function statusTone(status?: string): string {
  const normalized = (status || '').toLowerCase();
  if (
    normalized === 'running' ||
    normalized === 'completed' ||
    normalized === 'connected'
  ) {
    return 'text-emerald-700';
  }
  if (
    normalized === 'paused' ||
    normalized === 'queued' ||
    normalized === 'degraded'
  ) {
    return 'text-amber-700';
  }
  return 'text-rose-700';
}

function guardianReasonLabel(reason?: string): string {
  if (!reason) return '无';
  if (reason === 'resonance_disabled')
    return '共鸣层已关闭，自动触达进入静默等待';
  if (reason === 'psyche_consult_unavailable')
    return '守门员离线，已自动降级为静默模式';
  return reason;
}

function formatHubAge(ageMs?: number): string {
  if (!Number.isFinite(ageMs)) return '-';
  const sec = Math.max(0, Math.floor(Number(ageMs) / 1000));
  return `${sec}s`;
}

function evidenceImageUrl(
  auditID?: string,
  slot: 'pre' | 'post' = 'pre',
): string {
  if (!auditID) return '';
  const params = new URLSearchParams({
    auditID,
    slot,
  });
  return `${withGatewayBasePath('/api/evidence/image')}?${params.toString()}`;
}

function resolveUiLocale(): string {
  const fromDocument =
    document.documentElement.lang || navigator.languages?.[0] || navigator.language;
  const locale = String(fromDocument ?? '').trim();
  return locale || 'zh-CN';
}

function formatDateTime(input?: string, locale = 'zh-CN'): string {
  if (!input) return '-';
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return input;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
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

function taskStatusMeta(status: UiTaskStatus): {
  text: string;
  className: string;
} {
  if (status === 'completed')
    return { text: '已完成', className: 'bg-emerald-500 text-white' };
  if (status === 'running')
    return { text: '执行中', className: 'bg-sky-500 text-white' };
  if (status === 'failed')
    return { text: '执行失败', className: 'bg-rose-500 text-white' };
  return { text: '已终止', className: 'bg-slate-400 text-white' };
}

function normalizeTaskStatus(status: MiyaJobRun['status']): UiTaskStatus {
  if (status === 'success') return 'completed';
  if (status === 'failed') return 'failed';
  return 'stopped';
}

function normalizeStatusFetchError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.toLowerCase();
  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('fetch')
  ) {
    return '无法连接网关。请检查同源反代路径是否可用，或确认 localhost/127.0.0.1/::1 已设置直连并且网关与 daemon 正在运行。';
  }
  return raw;
}

const LOOPBACK_NO_PROXY = 'localhost,127.0.0.1,::1';
const POWERSHELL_PROXY_FIX_COMMAND =
  `$env:NO_PROXY='${LOOPBACK_NO_PROXY}'; ` +
  `$env:no_proxy='${LOOPBACK_NO_PROXY}'; ` +
  `[Environment]::SetEnvironmentVariable('NO_PROXY','${LOOPBACK_NO_PROXY}','User'); ` +
  `[Environment]::SetEnvironmentVariable('no_proxy','${LOOPBACK_NO_PROXY}','User')`;

let cachedGatewayClient: GatewayRpcClient | null = null;
let cachedGatewayClientKey = '';

function getGatewayClient(): GatewayRpcClient {
  const wsPath = withGatewayBasePath('/ws');
  const key = `${location.protocol}//${location.host}${wsPath}`;
  if (!cachedGatewayClient || cachedGatewayClientKey !== key) {
    cachedGatewayClient?.dispose();
    cachedGatewayClient = new GatewayRpcClient({
      wsPath,
      tokenProvider: resolveGatewayToken,
    });
    cachedGatewayClientKey = key;
  }
  return cachedGatewayClient;
}

async function invokeGateway(
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  try {
    return await getGatewayClient().request(method, params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (message.includes('invalid_gateway_token')) {
      throw new Error('invalid_gateway_token: 请使用带 token 的控制台链接重新打开');
    }
    throw error instanceof Error ? error : new Error(message);
  }
}

export default function App() {
  const routeState = parseRoute(location.pathname);
  const [snapshot, setSnapshot] = useState<GatewaySnapshot>({});
  const [domains, setDomains] = useState<PolicyDomainRow[]>([]);
  const [jobs, setJobs] = useState<MiyaJob[]>([]);
  const [uiLocale, setUiLocale] = useState(() => resolveUiLocale());
  const [taskRuns, setTaskRuns] = useState<MiyaJobRun[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [rpcConnected, setRpcConnected] = useState(false);
  const [hasRefreshedOnce, setHasRefreshedOnce] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [successText, setSuccessText] = useState('');
  const [copyHintText, setCopyHintText] = useState('');
  const [insightText, setInsightText] = useState('');
  const [view, setView] = useState<ControlView>(routeState.view);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(
    routeState.taskId,
  );
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | undefined>(
    routeState.memoryId,
  );
  const [basePath, setBasePath] = useState(routeState.basePath);
  const [taskFilter, setTaskFilter] = useState<TaskStatusFilter>('all');
  const [memoryStatusFilter, setMemoryStatusFilter] =
    useState<MemoryStatusFilter>('all');
  const [memoryDomainFilter, setMemoryDomainFilter] =
    useState<MemoryDomainFilter>('all');
  const [memoryEditText, setMemoryEditText] = useState('');
  const [identityMode, setIdentityMode] = useState<
    'owner' | 'guest' | 'unknown'
  >('unknown');
  const [expandedTaskLogs, setExpandedTaskLogs] = useState<
    Record<string, boolean>
  >({});
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

  useEffect(() => {
    clearGatewayTokenInUrl();
  }, []);

  useEffect(() => {
    setUiLocale(resolveUiLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang = uiLocale;
  }, [uiLocale]);

  useEffect(() => {
    if (!successText) return;
    const timer = setTimeout(() => setSuccessText(''), 3200);
    return () => clearTimeout(timer);
  }, [successText]);

  useEffect(() => {
    if (!copyHintText) return;
    const timer = setTimeout(() => setCopyHintText(''), 2400);
    return () => clearTimeout(timer);
  }, [copyHintText]);

  const refresh = useCallback(async () => {
    try {
      const status = (await invokeGateway('gateway.status.get')) as GatewaySnapshot;
      setRpcConnected(true);
      setSnapshot(status);
      const rpcErrors: string[] = [];
      if (status.statusError?.message) {
        const hint = status.statusError.hint ? `；${status.statusError.hint}` : '';
        rpcErrors.push(
          `status_snapshot_degraded:${
            status.statusError.code || 'unknown'
          }: ${status.statusError.message}${hint}`,
        );
      }
      const [domainsResult, jobsResult, runsResult, identityResult] =
        await Promise.allSettled([
          invokeGateway('policy.domains.list'),
          invokeGateway('cron.list'),
          invokeGateway('cron.runs.list', { limit: 80 }),
          invokeGateway('security.identity.status'),
        ]);

      if (domainsResult.status === 'fulfilled') {
        const rows =
          (domainsResult.value as { domains?: PolicyDomainRow[] }).domains ??
          [];
        setDomains(rows);
      } else {
        rpcErrors.push(
          domainsResult.reason instanceof Error
            ? domainsResult.reason.message
            : String(domainsResult.reason),
        );
      }
      if (jobsResult.status === 'fulfilled') {
        setJobs(
          Array.isArray(jobsResult.value)
            ? (jobsResult.value as MiyaJob[])
            : [],
        );
      } else {
        rpcErrors.push(
          jobsResult.reason instanceof Error
            ? jobsResult.reason.message
            : String(jobsResult.reason),
        );
      }
      if (runsResult.status === 'fulfilled') {
        setTaskRuns(
          Array.isArray(runsResult.value)
            ? (runsResult.value as MiyaJobRun[])
            : [],
        );
      } else {
        rpcErrors.push(
          runsResult.reason instanceof Error
            ? runsResult.reason.message
            : String(runsResult.reason),
        );
      }
      let resolvedIdentityMode: 'owner' | 'guest' | 'unknown' = identityMode;
      if (identityResult.status === 'fulfilled') {
        const modeRaw = String(
          (identityResult.value as { mode?: string }).mode ?? 'unknown',
        );
        const mode =
          modeRaw === 'owner' || modeRaw === 'guest' || modeRaw === 'unknown'
            ? modeRaw
            : 'unknown';
        resolvedIdentityMode = mode;
        setIdentityMode(mode);
      } else {
        rpcErrors.push(
          identityResult.reason instanceof Error
            ? identityResult.reason.message
            : String(identityResult.reason),
        );
      }
      const shouldLoadMemory =
        view === 'memory-list' ||
        view === 'memory-detail' ||
        resolvedIdentityMode === 'owner';
      if (shouldLoadMemory) {
        try {
          const memoryRows = (await invokeGateway(
            'companion.memory.vector.list',
          )) as unknown;
          setMemories(
            Array.isArray(memoryRows) ? (memoryRows as MemoryRecord[]) : [],
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (!message.includes('owner_mode_required')) {
            rpcErrors.push(message);
          }
          if (resolvedIdentityMode !== 'owner') setMemories([]);
        }
      } else {
        setMemories([]);
      }
      const tokenError = rpcErrors.find((item) =>
        item.includes('invalid_gateway_token'),
      );
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
      setRpcConnected(false);
      setConnected(false);
      setErrorText(normalizeStatusFetchError(error));
    } finally {
      setHasRefreshedOnce(true);
    }
  }, [identityMode, view]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 2500);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    return () => {
      cachedGatewayClient?.dispose();
      cachedGatewayClient = null;
      cachedGatewayClientKey = '';
    };
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const route = parseRoute(location.pathname);
      setView(route.view);
      setSelectedTaskId(route.taskId);
      setSelectedMemoryId(route.memoryId);
      setBasePath(route.basePath);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback(
    (nextView: ControlView, id?: string) => {
      const nextPath = buildRoute(basePath, nextView, id);
      const nextUrl = `${nextPath}${sanitizedLocationSearch()}${location.hash || ''}`;
      if (nextUrl !== `${location.pathname}${location.search}${location.hash}`) {
        history.pushState({}, '', nextUrl);
      }
      setView(nextView);
      if (nextView === 'tasks-detail') {
        setSelectedTaskId(id);
      } else if (nextView === 'memory-detail') {
        setSelectedMemoryId(id);
      } else {
        setSelectedTaskId(undefined);
        setSelectedMemoryId(undefined);
      }
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
        desc: `守门员 CPU 占用率 ${(snapshot.daemon?.cpuPercent ?? 0).toFixed(1)}%`,
        toneClass: connected ? 'text-emerald-700' : 'text-rose-700',
        dotClass: connected ? 'bg-emerald-500' : 'bg-rose-500',
      },
      {
        title: '会话',
        value: `${snapshot.sessions?.active ?? 0}/${snapshot.sessions?.total ?? 0}`,
        desc: `排队 ${snapshot.sessions?.queued ?? 0}，静音 ${snapshot.sessions?.muted ?? 0}`,
        toneClass: 'text-slate-800',
        dotClass: 'bg-slate-300',
      },
      {
        title: '任务',
        value: `${snapshot.jobs?.enabled ?? 0}/${snapshot.jobs?.total ?? 0}`,
        desc: `待审批 ${snapshot.jobs?.pendingApprovals ?? 0}`,
        toneClass: 'text-slate-800',
        dotClass: 'bg-slate-300',
      },
      {
        title: '风险票据',
        value: String(snapshot.nexus?.pendingTickets ?? 0),
        desc: `守门员：${guardianReasonLabel(snapshot.nexus?.guardianSafeHoldReason)}`,
        toneClass: 'text-slate-800',
        dotClass: 'bg-slate-300',
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
      title:
        run.jobName || jobNameMap.get(run.jobId) || run.jobId || '未命名任务',
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
    if (
      activeJobID &&
      !records.some(
        (item) => item.jobId === activeJobID && item.status === 'running',
      )
    ) {
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
    () =>
      taskRecords.filter((item) =>
        taskFilter === 'all' ? true : item.status === taskFilter,
      ),
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

  const memoryRecords = useMemo(
    () =>
      memories.filter((item) => {
        const domainOk =
          memoryDomainFilter === 'all'
            ? true
            : item.domain === memoryDomainFilter;
        const statusOk =
          memoryStatusFilter === 'all'
            ? true
            : memoryStatusFilter === 'archived'
              ? item.isArchived
              : item.status === memoryStatusFilter && !item.isArchived;
        return domainOk && statusOk;
      }),
    [memories, memoryDomainFilter, memoryStatusFilter],
  );

  const selectedMemory = useMemo(
    () => memories.find((item) => item.id === selectedMemoryId) ?? null,
    [memories, selectedMemoryId],
  );

  useEffect(() => {
    setMemoryEditText(selectedMemory?.text ?? '');
  }, [selectedMemory?.text]);

  const runAction = async (
    task: () => Promise<unknown>,
    successMessage: string,
  ) => {
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

  const copyProxyFixCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(POWERSHELL_PROXY_FIX_COMMAND);
      setCopyHintText('已复制 PowerShell 修复命令');
    } catch {
      setCopyHintText('复制失败，请手动复制命令');
    }
  }, []);

  const setKillSwitchMode = async (mode: KillSwitchMode) => {
    if (mode === 'all_stop') {
      const confirmed = window.confirm(
        '这会立即停止外发和桌面控制。确定继续吗？',
      );
      if (!confirmed) return;
    }
    await runAction(
      async () => {
        await invokeGateway('killswitch.set_mode', { mode });
      },
      `已切换为：${killSwitchLabel(mode)}`,
    );
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
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `task-log-${task.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSuccessText(`已导出任务日志：${task.id}`);
  };

  const saveMemoryEdit = async () => {
    if (!selectedMemory) return;
    const policyHash = snapshot.policyHash;
    if (!policyHash) {
      setErrorText('缺少策略哈希，无法修改记忆，请刷新后重试。');
      return;
    }
    const text = memoryEditText.trim();
    if (!text) {
      setErrorText('记忆内容不能为空。');
      return;
    }
    await runAction(async () => {
      await invokeGateway('companion.memory.update', {
        policyHash,
        memoryID: selectedMemory.id,
        text,
        domain: selectedMemory.domain,
        memoryKind: selectedMemory.memoryKind,
      });
    }, '记忆已更新');
  };

  const archiveMemory = async (archived: boolean) => {
    if (!selectedMemory) return;
    const policyHash = snapshot.policyHash;
    if (!policyHash) {
      setErrorText('缺少策略哈希，无法归档记忆，请刷新后重试。');
      return;
    }
    await runAction(
      async () => {
        await invokeGateway('companion.memory.archive', {
          policyHash,
          memoryID: selectedMemory.id,
          archived,
        });
      },
      archived ? '记忆已归档' : '记忆已恢复',
    );
  };

  const confirmPendingMemory = async () => {
    if (!selectedMemory) return;
    const policyHash = snapshot.policyHash;
    if (!policyHash) {
      setErrorText('缺少策略哈希，无法确认记忆，请刷新后重试。');
      return;
    }
    await runAction(async () => {
      await invokeGateway('companion.memory.confirm', {
        policyHash,
        memoryID: selectedMemory.id,
        confirm: true,
        evidence: ['ui_manual_confirmation=1'],
      });
    }, '待确认记忆已转为生效');
  };

  const panelClass =
    'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';

  return (
    <div className="min-h-screen bg-[#dfe7ec] text-slate-700">
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(560px,92vw)] flex-col gap-2">
        {errorText ? (
          <div
            role="alert"
            aria-live="assertive"
            className="pointer-events-auto rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm"
          >
            错误：{errorText}
          </div>
        ) : null}
        {!rpcConnected && hasRefreshedOnce ? (
          <div className="pointer-events-auto rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 shadow-sm">
            <p>
              网关连接异常。若通过 OpenCode 同源反代访问，请检查 `/miya/*`
              路由；若直连本地网关，请确保 localhost/127.0.0.1/::1 走直连。
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded bg-amber-100 px-2 py-1 text-[11px]">
                NO_PROXY={LOOPBACK_NO_PROXY}
              </code>
              <button
                type="button"
                onClick={() => void copyProxyFixCommand()}
                className="rounded border border-amber-300 bg-white px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-100"
              >
                复制 PowerShell 修复命令
              </button>
            </div>
          </div>
        ) : null}
        {successText ? (
          <output
            aria-live="polite"
            className="pointer-events-auto rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 shadow-sm"
          >
            成功：{successText}
          </output>
        ) : null}
        {copyHintText ? (
          <output
            aria-live="polite"
            className="pointer-events-auto rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700 shadow-sm"
          >
            {copyHintText}
          </output>
        ) : null}
      </div>

      <div className="mx-auto flex max-w-[1520px] gap-4 p-3 md:p-5">
        <aside className="hidden w-[300px] shrink-0 flex-col rounded-3xl border border-slate-200 bg-[#f4f8fb] shadow-sm lg:flex">
          <div className="border-b border-slate-200 p-6">
            <p className="text-4xl leading-none">M</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-wide text-slate-800">
              Miya
            </h1>
            <p className="mt-1 text-sm text-slate-500">控制台</p>
          </div>
          <nav className="space-y-1.5 px-3 py-4 text-base">
            {NAV_ITEMS.map((item) => {
              const active = isNavActive(view, item.key);
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigate(targetViewForNav(item.key))}
                  className={`flex w-full flex-col rounded-xl px-4 py-3 text-left transition ${active ? 'border border-sky-200 bg-sky-100 text-sky-700 shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <span className="font-medium">{item.label}</span>
                  <span
                    className={`mt-0.5 text-xs ${active ? 'text-sky-600' : 'text-slate-500'}`}
                  >
                    {item.subtitle}
                  </span>
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
                <p className="rounded-lg bg-slate-100 px-3 py-2 text-xl font-semibold text-slate-800">
                  default
                </p>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <span
                    className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-rose-500'}`}
                  />
                  <span>{connected ? '运行中' : '已降级'}</span>
                </div>
                <p className="text-sm text-slate-500">
                  {snapshot.nodes?.connected ?? 0} 端点
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
                >
                  刷新
                </button>
                <span
                  className={`rounded-full px-3 py-1 text-xs ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}
                >
                  {connected ? '系统在线' : '系统降级'}
                </span>
              </div>
            </div>
          </header>

          <nav className="flex flex-wrap gap-2 lg:hidden">
            {NAV_ITEMS.map((item) => {
              const active = isNavActive(view, item.key);
              return (
                <button
                  key={`mobile-${item.key}`}
                  type="button"
                  onClick={() => navigate(targetViewForNav(item.key))}
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
                  <h2 className="text-3xl font-semibold text-slate-800">
                    作业中心
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    查看与管理所有执行过的任务记录，点击任务查看详情。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={taskFilter}
                    onChange={(event) =>
                      setTaskFilter(event.target.value as TaskStatusFilter)
                    }
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
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="grid grid-cols-[2.2fr_1fr_1fr_120px] border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
                  <span>任务</span>
                  <span>开始时间</span>
                  <span>状态</span>
                  <span className="text-right">操作</span>
                </div>
                {filteredTaskRecords.length === 0 ? (
                  <div className="px-3 py-5">
                    <EmptyState
                      title="暂无任务记录"
                      description="作业中心已加载完成，当前筛选条件下没有可展示的任务。"
                    />
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filteredTaskRecords.map((task) => {
                      const statusMeta = taskStatusMeta(task.status);
                      return (
                        <button
                          type="button"
                          key={task.id}
                          onClick={() => navigate('tasks-detail', task.id)}
                          className="grid w-full grid-cols-[2.2fr_1fr_1fr_120px] items-center px-3 py-2 text-left hover:bg-sky-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-800">
                              {task.title}
                            </span>
                            <span className="block truncate text-xs text-slate-500">
                              {task.sourceText}
                            </span>
                          </span>
                          <span className="text-xs text-slate-600">
                            {formatDateTime(task.startedAt, uiLocale)}
                          </span>
                          <span
                            className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium ${statusMeta.className}`}
                          >
                            {statusMeta.text}
                          </span>
                          <span className="text-right text-xs text-sky-700">
                            查看详情
                          </span>
                        </button>
                      );
                    })}
                  </div>
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
                  <h2 className="text-3xl font-semibold text-slate-800">
                    {selectedTask?.title || '任务详情'}
                  </h2>
                  {selectedTask ? (
                    <span
                      className={`rounded-full px-3 py-1 text-xs ${taskStatusMeta(selectedTask.status).className}`}
                    >
                      {taskStatusMeta(selectedTask.status).text}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  开始：{formatDateTime(selectedTask?.startedAt, uiLocale)} · 结束：
                  {formatDateTime(selectedTask?.endedAt, uiLocale)} · 总时长：
                  {selectedTask?.durationText || '-'} · 触发：
                  {selectedTask?.trigger || '-'}
                </p>
              </article>
              {!selectedTask ? (
                <article className={panelClass}>
                  <p className="text-sm text-slate-500">
                    该任务不存在或已被清理，请返回列表刷新后重试。
                  </p>
                </article>
              ) : (
                <>
                  <article className={panelClass}>
                    <h3 className="text-base font-semibold text-slate-800">
                      任务进度
                    </h3>
                    <div className="mt-3 h-2 w-full rounded-full bg-slate-200">
                      <div
                        className="h-2 rounded-full bg-sky-500"
                        style={{ width: `${selectedTaskProgress}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      当前完成度：{selectedTaskProgress}%
                    </p>
                  </article>
                  <article className={panelClass}>
                    <h3 className="text-base font-semibold text-slate-800">
                      执行日志与错误信息
                    </h3>
                    <div className="mt-3 space-y-2">
                      {selectedTask.stderr ? (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                          <p className="text-xs font-medium text-rose-700">
                            错误日志
                          </p>
                          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-rose-700">
                            {expandedTaskLogs[selectedTask.id]
                              ? selectedTask.stderr
                              : selectedTask.stderr.slice(0, 600)}
                          </pre>
                        </div>
                      ) : null}
                      {selectedTask.stdout ? (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs font-medium text-slate-700">
                            普通日志
                          </p>
                          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                            {expandedTaskLogs[selectedTask.id]
                              ? selectedTask.stdout
                              : selectedTask.stdout.slice(0, 600)}
                          </pre>
                        </div>
                      ) : null}
                      {(selectedTask.stdout?.length || 0) > 600 ||
                      (selectedTask.stderr?.length || 0) > 600 ? (
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
                          {expandedTaskLogs[selectedTask.id]
                            ? '折叠日志'
                            : '展开日志'}
                        </button>
                      ) : null}
                    </div>
                  </article>
                  <article className={panelClass}>
                    <h3 className="text-base font-semibold text-slate-800">
                      获得的经验与习惯
                    </h3>
                    <div className="mt-3 space-y-2 text-sm text-slate-700">
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        任务来源：
                        <span className="font-medium">
                          {selectedTask.trigger}
                        </span>
                        ，建议后续同类任务保持相同触发方式。
                      </p>
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        执行表现：
                        <span className="font-medium">
                          {taskStatusMeta(selectedTask.status).text}
                        </span>
                        ，时长 {selectedTask.durationText}。
                      </p>
                    </div>
                  </article>
                  <article className={panelClass}>
                    <h3 className="text-base font-semibold text-slate-800">
                      记忆写入记录
                    </h3>
                    <p className="mt-2 text-xs text-slate-500">
                      当前网关未提供单任务记忆写入明细接口，以下基于系统时间线生成摘要。
                    </p>
                    <div className="mt-3 space-y-2 text-xs">
                      {(snapshot.nexus?.insights || [])
                        .slice(0, 5)
                        .map((item, index) => (
                          <div
                            key={`${item.at || 'insight'}-${index}`}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                          >
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700">
                                更新
                              </span>
                              <span className="text-slate-500">
                                {formatDateTime(item.at, uiLocale)}
                              </span>
                            </div>
                            <p className="mt-1 text-slate-700">
                              {item.text || '无内容'}
                            </p>
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

          {view === 'memory-list' ? (
            <section className={panelClass}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-3xl font-semibold text-slate-800">
                    记忆库
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    查看、分类与检索已写入记忆，支持跳转到详情编辑。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={memoryDomainFilter}
                    onChange={(event) =>
                      setMemoryDomainFilter(
                        event.target.value as MemoryDomainFilter,
                      )
                    }
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700"
                  >
                    <option value="all">全部域</option>
                    <option value="work">工作记忆</option>
                    <option value="relationship">关系记忆</option>
                  </select>
                  <select
                    value={memoryStatusFilter}
                    onChange={(event) =>
                      setMemoryStatusFilter(
                        event.target.value as MemoryStatusFilter,
                      )
                    }
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700"
                  >
                    <option value="all">全部状态</option>
                    <option value="active">生效中</option>
                    <option value="pending">待确认</option>
                    <option value="superseded">已替代</option>
                    <option value="archived">已归档</option>
                  </select>
                </div>
              </div>
              {identityMode !== 'owner' ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  当前身份：{identityMode}。记忆编辑仅在 Owner
                  模式下可用；可先完成 `security.identity.init`。
                </p>
              ) : null}
              <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                {[
                  { key: 'all', label: '全部', count: memories.length },
                  {
                    key: 'active',
                    label: '生效中',
                    count: memories.filter(
                      (m) => m.status === 'active' && !m.isArchived,
                    ).length,
                  },
                  {
                    key: 'pending',
                    label: '待确认',
                    count: memories.filter(
                      (m) => m.status === 'pending' && !m.isArchived,
                    ).length,
                  },
                  {
                    key: 'archived',
                    label: '已归档',
                    count: memories.filter((m) => m.isArchived).length,
                  },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() =>
                      setMemoryStatusFilter(item.key as MemoryStatusFilter)
                    }
                    className={`rounded-xl border px-3 py-2 text-left text-xs ${memoryStatusFilter === item.key ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-600'}`}
                  >
                    <p>{item.label}</p>
                    <p className="mt-1 text-base font-semibold">{item.count}</p>
                  </button>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                {memoryRecords.length === 0 ? (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
                    当前筛选下暂无记忆。
                  </p>
                ) : (
                  memoryRecords.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigate('memory-detail', item.id)}
                      className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-sky-200 hover:bg-sky-50"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                          {memoryDomainLabel(item.domain)}
                        </span>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                          {memoryStatusLabel(item)}
                        </span>
                        {item.semanticLayer ? (
                          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700">
                            {item.semanticLayer}
                          </span>
                        ) : null}
                        {item.memoryKind ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                            {item.memoryKind}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm text-slate-700">
                        {item.text}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        更新时间：{formatDateTime(item.updatedAt, uiLocale)}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </section>
          ) : null}

          {view === 'memory-detail' ? (
            <section className="space-y-4">
              <article className={panelClass}>
                <button
                  type="button"
                  onClick={() => navigate('memory-list')}
                  className="text-sm text-sky-700 hover:text-sky-800"
                >
                  {'< 返回记忆列表'}
                </button>
                {!selectedMemory ? (
                  <p className="mt-3 text-sm text-slate-500">
                    该记忆不存在或已被清理，请返回刷新。
                  </p>
                ) : (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold text-slate-800">
                        记忆详情
                      </h2>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        {memoryDomainLabel(selectedMemory.domain)}
                      </span>
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                        {memoryStatusLabel(selectedMemory)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      ID: {selectedMemory.id} · 创建：
                      {formatDateTime(selectedMemory.createdAt, uiLocale)} · 最近访问：
                      {formatDateTime(selectedMemory.lastAccessedAt, uiLocale)}
                    </p>
                    <textarea
                      value={memoryEditText}
                      onChange={(event) =>
                        setMemoryEditText(event.target.value)
                      }
                      className="mt-3 min-h-[140px] w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-700"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void saveMemoryEdit()}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs hover:bg-slate-100"
                      >
                        保存修改
                      </button>
                      {selectedMemory.status === 'pending' ? (
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => void confirmPendingMemory()}
                          className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 hover:bg-emerald-100"
                        >
                          确认入库
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() =>
                          void archiveMemory(!selectedMemory.isArchived)
                        }
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs hover:bg-slate-100"
                      >
                        {selectedMemory.isArchived ? '取消归档' : '归档'}
                      </button>
                    </div>
                  </>
                )}
              </article>
            </section>
          ) : null}

          {view === 'gateway' ? (
            <section className="space-y-4">
              <article className={panelClass}>
                <h2 className="text-3xl font-semibold text-slate-800">
                  网关诊断
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  集中查看 Gateway/Daemon/节点与证据，减少控制中心信息拥挤。
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <p>Gateway 状态：{snapshot.gateway?.status ?? 'unknown'}</p>
                    <p className="mt-1">URL：{snapshot.gateway?.url ?? '-'}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <p>
                      Daemon：
                      {snapshot.daemon?.connected ? '已连接' : '未连接'}
                    </p>
                    <p className="mt-1">
                      CPU 占用率：{(snapshot.daemon?.cpuPercent ?? 0).toFixed(1)}
                      %
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <p>
                      节点：{snapshot.nodes?.connected ?? 0}/
                      {snapshot.nodes?.total ?? 0}
                    </p>
                    <p className="mt-1">
                      策略哈希：{snapshot.policyHash ?? '-'}
                    </p>
                  </div>
                </div>
              </article>
              <article className={panelClass}>
                <h3 className="text-base font-semibold text-slate-800">
                  节点状态
                </h3>
                <div className="mt-3 max-h-60 space-y-2 overflow-auto pr-1">
                  {(snapshot.nodes?.list ?? []).map((node, index) => (
                    <div
                      key={
                        node.id ??
                        `${node.label ?? 'node'}-${node.platform ?? 'unknown'}-${index}`
                      }
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                    >
                      <p className="font-medium">
                        {node.label || node.id || '未命名节点'}
                      </p>
                      <p
                        className={
                          node.connected ? 'text-emerald-700' : 'text-rose-700'
                        }
                      >
                        {node.connected ? '在线' : '离线'}
                      </p>
                      <p className="text-slate-500">
                        平台：{node.platform || '未知'}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          ) : null}

          <div className={view === 'modules' ? 'space-y-4' : 'hidden'}>
            <section className={`${panelClass}`}>
              <h2 className="text-3xl font-semibold text-slate-800">
                控制中枢
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                仅保留全局控制项。任务、记忆、网关详情已分流到独立页面。
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
                {quickStats.map((item) => (
                  <article
                    key={item.title}
                    className="rounded-xl border border-sky-200 bg-sky-50 p-3"
                  >
                    <p className="text-xs text-slate-500">{item.title}</p>
                    <p className={`mt-1 flex items-center gap-2 text-lg font-semibold ${item.toneClass}`}>
                      <span className={`h-2 w-2 rounded-full ${item.dotClass}`} />
                      <span>{item.value}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-600">{item.desc}</p>
                  </article>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <button
                  type="button"
                  onClick={() => navigate('tasks-list')}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-left text-xs transition hover:border-sky-300 hover:bg-sky-50"
                >
                  <p className="font-semibold text-slate-800">作业中心</p>
                  <p className="mt-1 text-slate-500">任务列表、日志导出与重放</p>
                </button>
                <button
                  type="button"
                  onClick={() => navigate('memory-list')}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-left text-xs transition hover:border-sky-300 hover:bg-sky-50"
                >
                  <p className="font-semibold text-slate-800">记忆库</p>
                  <p className="mt-1 text-slate-500">筛选、修订、归档、确认</p>
                </button>
                <button
                  type="button"
                  onClick={() => navigate('gateway')}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-left text-xs transition hover:border-sky-300 hover:bg-sky-50"
                >
                  <p className="font-semibold text-slate-800">网关诊断</p>
                  <p className="mt-1 text-slate-500">节点、连接态、策略哈希</p>
                </button>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <article className={panelClass}>
                <h2 className="text-base font-semibold text-slate-800">
                  守门员信号中心（Psyche Signal Hub）
                </h2>
                {signalHub ? (
                  <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <p>运行状态：{signalHub.running ? '运行中' : '已停止'}</p>
                      <p>序号：{signalHub.sequence ?? '-'}</p>
                      <p>最近采样年龄：{formatHubAge(signalHub.ageMs)}</p>
                      <p>过期：{signalHub.stale ? '是' : '否'}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <p>连续失败：{signalHub.consecutiveFailures ?? 0}</p>
                      <p>采样间隔：{signalHub.sampleIntervalMs ?? '-'}ms</p>
                      <p>突发间隔：{signalHub.burstIntervalMs ?? '-'}ms</p>
                      <p>过期阈值：{signalHub.staleAfterMs ?? '-'}ms</p>
                    </div>
                    {signalHub.lastError ? (
                      <p className="text-rose-700 md:col-span-2">
                        lastError: {signalHub.lastError}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2">
                    <EmptyState
                      title="等待守门员信号接入"
                      description="尚未收到 daemon signal hub 指标，通常发生在 daemon 未连接或刚启动阶段。"
                    />
                  </div>
                )}
              </article>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <article className={panelClass}>
                <h2 className="text-sm font-semibold">安全总开关（紧急）</h2>
                <p className="mt-1 text-xs text-slate-500">
                  当前模式：{killSwitchLabel(killSwitchMode)}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(
                    [
                      {
                        mode: 'off',
                        text: '正常运行',
                        hint: '外发和桌控都可用',
                      },
                      {
                        mode: 'outbound_only',
                        text: '暂停外发',
                        hint: '停止发送消息，但保留桌控',
                      },
                      {
                        mode: 'desktop_only',
                        text: '暂停桌控',
                        hint: '禁止鼠标键盘自动操作',
                      },
                      {
                        mode: 'all_stop',
                        text: '全部停止',
                        hint: '紧急止损，全部停机',
                      },
                    ] as Array<{
                      mode: KillSwitchMode;
                      text: string;
                      hint: string;
                    }>
                  ).map((item) => (
                    <button
                      key={item.mode}
                      type="button"
                      disabled={loading}
                      onClick={() => void setKillSwitchMode(item.mode)}
                    className={`rounded-lg border px-2 py-2 text-left text-xs ${killSwitchMode === item.mode ? 'border-sky-300 bg-sky-50' : 'border-slate-300 hover:bg-slate-100'}`}
                  >
                      <p className="font-medium">{item.text}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {item.hint}
                      </p>
                    </button>
                  ))}
                </div>
              </article>

              <article className={panelClass}>
                <h2 className="text-sm font-semibold">信任阈值</h2>
                <p className="mt-1 text-xs text-slate-500">
                  分数高于静默阈值可自动放行，低于阻断阈值必须人工确认。
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <label className="flex flex-col gap-1 rounded border border-slate-200 bg-slate-50 p-2">
                    <span>静默阈值（推荐 90）</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={trustModeForm.silentMin}
                      onChange={(event) =>
                        setTrustModeForm((prev) => ({
                          ...prev,
                          silentMin: Number(event.target.value),
                        }))
                      }
                      className="rounded border border-slate-300 bg-white px-2 py-1"
                    />
                  </label>
                  <label className="flex flex-col gap-1 rounded border border-slate-200 bg-slate-50 p-2">
                    <span>阻断阈值（推荐 50）</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={trustModeForm.modalMax}
                      onChange={(event) =>
                        setTrustModeForm((prev) => ({
                          ...prev,
                          modalMax: Number(event.target.value),
                        }))
                      }
                      className="rounded border border-slate-300 bg-white px-2 py-1"
                    />
                  </label>
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() =>
                      void runAction(async () => {
                        await invokeGateway(
                          'trust.set_mode',
                          trustModeForm as unknown as Record<string, unknown>,
                        );
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
                    当前信任：{trust.minScore}（{trustTierLabel(trust.tier)}）/
                    目标 {trust.target}，来源 {trust.source}，动作{' '}
                    {trust.action}
                  </p>
                ) : null}
              </article>

              <article className={`${panelClass} xl:col-span-2`}>
                <h2 className="text-sm font-semibold">守门员策略</h2>
                <p className="mt-1 text-xs text-slate-500">
                  关闭共鸣层后，自动触达将进入静默等待；关闭截图核验后，系统不再做截图/VLM探测。
                </p>
                <div className="mt-3 space-y-2 text-xs">
                  <label className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    <span>共鸣层（主动陪伴）</span>
                    <input
                      type="checkbox"
                      checked={psycheModeForm.resonanceEnabled}
                      onChange={(event) =>
                        setPsycheModeForm((prev) => ({
                          ...prev,
                          resonanceEnabled: event.target.checked,
                        }))
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
                    <span>主动问候（proactive_ping）</span>
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
                    <span>静默时段（quiet_hours）</span>
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
                        value={
                          psycheModeForm.proactivePingMinIntervalMinutes ?? 90
                        }
                        onChange={(event) =>
                          setPsycheModeForm((prev) => ({
                            ...prev,
                            proactivePingMinIntervalMinutes: Number(
                              event.target.value,
                            ),
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
                  当前降级原因：
                  {guardianReasonLabel(snapshot.nexus?.guardianSafeHoldReason)}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() =>
                      void runAction(async () => {
                        await invokeGateway(
                          'psyche.mode.set',
                          psycheModeForm as unknown as Record<string, unknown>,
                        );
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
                <h2 className="text-sm font-semibold">代理兼容设置</h2>
                <p className="mt-1 text-xs text-slate-500">
                  直连网关模式下，请让本地回环直连；同源反代模式下可优先使用 `/miya/*`。
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
                  <li>`NO_PROXY=localhost,127.0.0.1,::1`</li>
                  <li>系统代理绕过：`localhost;127.0.0.1;::1`</li>
                  <li>Clash/TUN 请放行 loopback 后再刷新控制台</li>
                </ul>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => void copyProxyFixCommand()}
                    className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-100"
                  >
                    复制 PowerShell 修复命令
                  </button>
                  <code className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                    {`$env:NO_PROXY='${LOOPBACK_NO_PROXY}'`}
                  </code>
                </div>
              </article>

              <article className={panelClass}>
                <h2 className="text-sm font-semibold">能力域状态</h2>
                <p className="mt-1 text-xs text-slate-500">
                  可直接暂停/恢复单个能力域。
                </p>
                <div className="mt-3 space-y-2">
                  {domains.map((domain) => (
                    <div
                      key={domain.domain}
                      className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs"
                    >
                      <div>
                        <p className="font-medium">
                          {domainLabel(domain.domain)}
                        </p>
                        <p className={statusTone(domain.status)}>
                          {domain.status === 'running' ? '运行中' : '已暂停'}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() =>
                          void runAction(
                            async () => {
                              await invokeGateway(
                                domain.status === 'running'
                                  ? 'policy.domain.pause'
                                  : 'policy.domain.resume',
                                { domain: domain.domain },
                              );
                            },
                            `${domainLabel(domain.domain)} 已${domain.status === 'running' ? '暂停' : '恢复'}`,
                          )
                        }
                        className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-100"
                      >
                        {domain.status === 'running' ? '暂停' : '恢复'}
                      </button>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  策略哈希：{snapshot.policyHash ?? '暂无'}
                </p>
              </article>
            </section>

            <section className="hidden grid grid-cols-1 gap-4 xl:grid-cols-2">
              <article className={panelClass}>
                <h2 className="text-sm font-semibold">最近任务执行</h2>
                <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
                  {(snapshot.jobs?.recentRuns ?? []).map((run, index) => (
                    <div
                      key={`${run.id ?? 'run'}-${index}`}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                    >
                      <p className="font-medium">{run.id ?? '任务'}</p>
                      <p className={statusTone(run.status)}>
                        {run.status ?? '未知状态'}
                      </p>
                      <p className="text-slate-500">
                        触发方式：{run.trigger ?? '手动'} / 更新时间：
                        {run.updatedAt ?? '暂无'}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className={panelClass}>
                <h2 className="text-sm font-semibold">系统时间线</h2>
                <p className="mt-1 text-xs text-slate-500">
                  人工干预后建议写一条备注，后续排障更快。
                </p>
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
                        await invokeGateway('insight.append', {
                          text: insightText.trim(),
                        });
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
                    <div
                      key={`${item.at ?? 'ins'}-${index}`}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                    >
                      <p className="text-slate-700">{item.text ?? '无内容'}</p>
                      <p className="text-slate-500">
                        {item.at ?? '暂无'}{' '}
                        {item.auditID ? `| ${item.auditID}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className="hidden grid grid-cols-1 gap-4">
              <article className={panelClass}>
                <h2 className="text-sm font-semibold">
                  Evidence Pack V5（外发证据预览）
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  用于审批前快速核验：目标、发送状态、截图、限制项。
                </p>
                <div className="mt-3 max-h-[28rem] space-y-3 overflow-auto pr-1">
                  {(snapshot.channels?.recentOutbound ?? [])
                    .slice(0, 10)
                    .map((row, index) => (
                      <div
                        key={`${row.id ?? 'audit'}-${index}`}
                        className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium">
                            {row.channel ?? 'channel'}
                            {' -> '}
                            {row.destination ?? 'unknown'}
                          </p>
                          <span
                            className={
                              row.sent ? 'text-emerald-700' : 'text-rose-700'
                            }
                          >
                            {row.sent ? '已发送' : '已阻断'}
                          </span>
                        </div>
                        <p className="mt-1 text-slate-600">
                          {row.message ?? '-'}
                        </p>
                        <p className="mt-1 text-slate-500">
                          审计ID: {row.id ?? '-'} | 时间: {row.at ?? '-'} |
                          置信度:{' '}
                          {typeof row.evidenceConfidence === 'number'
                            ? row.evidenceConfidence.toFixed(2)
                            : '-'}
                        </p>
                        <p className="mt-1 text-slate-500">
                          recipient={row.recipientTextCheck ?? '-'} | send=
                          {row.sendStatusCheck ?? '-'} | receipt=
                          {row.receiptStatus ?? '-'} | simulation=
                          {row.simulationStatus ?? '-'}
                        </p>
                        {Array.isArray(row.evidenceLimitations) &&
                        row.evidenceLimitations.length > 0 ? (
                          <p className="mt-1 text-amber-700">
                            limitations: {row.evidenceLimitations.join(', ')}
                          </p>
                        ) : null}
                        {row.semanticSummary?.conclusion ? (
                          <p className="mt-1 text-slate-600">
                            结论: {row.semanticSummary.conclusion}
                          </p>
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
