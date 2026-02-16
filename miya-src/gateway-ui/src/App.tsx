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

async function invokeGateway(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const reqId = `ui-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  return await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`gateway_request_timeout:${method}`));
    }, 10000);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', role: 'ui', clientID: 'gateway-ui' }));
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
          reject(new Error(frame.error?.message || 'gateway_hello_failed'));
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
  const [snapshot, setSnapshot] = useState<GatewaySnapshot>({});
  const [domains, setDomains] = useState<PolicyDomainRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [successText, setSuccessText] = useState('');
  const [insightText, setInsightText] = useState('');
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
      const [statusRes, domainsResult] = await Promise.all([
        fetch('/api/status', { cache: 'no-store' }),
        invokeGateway('policy.domains.list'),
      ]);
      if (!statusRes.ok) {
        setConnected(false);
        return;
      }
      const status = (await statusRes.json()) as GatewaySnapshot;
      setSnapshot(status);
      setConnected(Boolean(status.daemon?.connected));
      const rows = (domainsResult as { domains?: PolicyDomainRow[] }).domains ?? [];
      setDomains(rows);
      const incomingMode = status.nexus?.trustMode;
      if (incomingMode) {
        setTrustModeForm(incomingMode);
      }
      const incomingPsycheMode = status.nexus?.psycheMode;
      if (incomingPsycheMode) {
        setPsycheModeForm((prev) => ({ ...prev, ...incomingPsycheMode }));
      }
      setErrorText('');
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
            {['聊天', 'IM 通道', '技能', '模块', '状态'].map((item) => (
              <button
                key={item}
                type="button"
                className={`flex w-full items-center rounded-xl px-4 py-3 text-left ${item === '模块' ? 'border border-sky-200 bg-sky-100 text-sky-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {item}
              </button>
            ))}
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
            {['聊天', 'IM 通道', '技能', '模块', '状态'].map((item) => (
              <button
                key={`mobile-${item}`}
                type="button"
                className={`rounded-lg border px-3 py-1.5 text-sm ${item === '模块' ? 'border-sky-200 bg-sky-100 text-sky-700' : 'border-slate-300 bg-white text-slate-600'}`}
              >
                {item}
              </button>
            ))}
          </nav>

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
        </main>
      </div>
    </div>
  );
}
