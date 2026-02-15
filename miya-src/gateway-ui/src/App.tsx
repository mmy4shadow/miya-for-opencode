import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import {
  Activity,
  Brain,
  Cable,
  ChevronRight,
  Link2Off,
  Settings2,
  Sparkles,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Mode = 'speed' | 'deep' | 'creative';
type CoreState = 'idle' | 'thinking' | 'critical';

type GatewayStatus = {
  daemon?: {
    connected?: boolean;
    cpuPercent?: number;
    activeJobID?: string;
    activeJobProgress?: number;
  };
  sessions?: {
    total?: number;
    active?: number;
  };
  jobs?: {
    total?: number;
    enabled?: number;
    pendingApprovals?: number;
  };
  nexus?: {
    sessionId?: string;
    activeTool?: string;
    permission?: string;
    pendingTickets?: number;
    killSwitchMode?: 'all_stop' | 'outbound_only' | 'desktop_only' | 'off';
    insights?: Array<{ at?: string; text?: string; auditID?: string }>;
  };
};

type WavePoint = {
  t: string;
  value: number;
};

const providers = [
  { name: 'OpenAI', online: true, latency: 18 },
  { name: 'Anthropic', online: true, latency: 26 },
  { name: 'DeepSeek', online: false, latency: 0 },
];

const memoryKeywords = [
  { word: 'Miya', weight: 28 },
  { word: 'Neural Core', weight: 22 },
  { word: 'MemTensor', weight: 18 },
  { word: 'Agent', weight: 15 },
  { word: 'Gateway', weight: 13 },
  { word: 'Reasoning', weight: 11 },
  { word: 'Safety', weight: 9 },
  { word: 'Workflow', weight: 8 },
];

function seedWave(): WavePoint[] {
  return Array.from({ length: 20 }).map((_, idx) => ({
    t: `${idx}`,
    value: 45 + Math.round(Math.random() * 35),
  }));
}

function nextWave(series: WavePoint[], nextValue: number): WavePoint[] {
  const copy = [...series, { t: `${Date.now()}`, value: Math.max(10, Math.min(99, nextValue)) }];
  return copy.slice(-20);
}

function inferCoreState(cpuPercent: number, mode: Mode): CoreState {
  if (cpuPercent > 90) return 'critical';
  if (mode === 'deep' || cpuPercent > 55) return 'thinking';
  return 'idle';
}

function corePalette(state: CoreState): { ring: string; glow: string; speed: number } {
  if (state === 'critical') {
    return { ring: '#ef4444', glow: 'rgba(239,68,68,0.45)', speed: 3.2 };
  }
  if (state === 'thinking') {
    return { ring: '#f59e0b', glow: 'rgba(245,158,11,0.35)', speed: 2.1 };
  }
  return { ring: '#38bdf8', glow: 'rgba(56,189,248,0.35)', speed: 1.3 };
}

export default function App() {
  const [mode, setMode] = useState<Mode>('speed');
  const [status, setStatus] = useState<GatewayStatus>({});
  const [connected, setConnected] = useState(false);
  const [wave, setWave] = useState<WavePoint[]>(() => seedWave());

  const cpu = status.daemon?.cpuPercent ?? 34;
  const sessions = status.sessions?.active ?? 0;
  const sessionsTotal = status.sessions?.total ?? 0;
  const jobs = status.jobs?.enabled ?? 0;
  const jobsTotal = status.jobs?.total ?? 0;
  const pendingTickets = status.nexus?.pendingTickets ?? status.jobs?.pendingApprovals ?? 0;
  const sessionId = status.nexus?.sessionId ?? 'main';
  const activeTool = status.nexus?.activeTool ?? 'gateway.status.get';
  const permission = status.nexus?.permission ?? 'none';
  const killSwitchMode = status.nexus?.killSwitchMode ?? 'off';
  const insights = status.nexus?.insights ?? [];
  const latency = mode === 'deep' ? 1280 : mode === 'creative' ? 740 : 320;
  const tps = useMemo(() => {
    const base = mode === 'deep' ? 37 : mode === 'creative' ? 61 : 88;
    return Math.max(12, Math.round(base - cpu / 5));
  }, [cpu, mode]);
  const memoryUsage = 14;
  const coreState = inferCoreState(cpu, mode);
  const palette = corePalette(coreState);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/status', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as GatewayStatus;
        setStatus(json);
        const cpuSample = json.daemon?.cpuPercent ?? 35 + Math.random() * 20;
        setWave((prev) => nextWave(prev, cpuSample));
      } catch {
        setWave((prev) => nextWave(prev, 40 + Math.random() * 25));
      }
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      setConnected(true);
      ws.send(
        JSON.stringify({
          type: 'hello',
          role: 'ui',
          protocolVersion: '1.0',
        }),
      );
      ws.send(
        JSON.stringify({
          type: 'request',
          id: 'sub',
          method: 'gateway.subscribe',
          params: { events: ['*'] },
        }),
      );
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    return () => ws.close();
  }, []);

  return (
    <div className="flex min-h-screen bg-miya-bg text-miya-text">
      <aside className="flex w-20 flex-col items-center gap-5 border-r border-white/10 bg-miya-card/35 py-6 backdrop-blur-md">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <Brain className="h-5 w-5 text-miya-primary" />
        </div>
        <NavItem active icon={<Brain className="h-5 w-5" />} label="Core" />
        <NavItem icon={<Settings2 className="h-5 w-5" />} label="Synapses" />
        <NavItem icon={<Activity className="h-5 w-5" />} label="Thoughts" />
      </aside>
      <main className="flex-1 overflow-auto p-6 md:p-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Miya Neural Gateway</h1>
            <p className="text-sm text-slate-300/90">
              Bionic dashboard for real-time cognition and orchestration telemetry.
            </p>
          </div>
          <div className="rounded-full border border-white/15 bg-black/20 px-4 py-2 text-xs tracking-[0.18em] text-miya-primary">
            {connected ? 'ONLINE' : 'DEGRADED'}
          </div>
        </header>

        <section className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="col-span-2 rounded-3xl border border-white/10 bg-miya-card/45 p-6 shadow-glow backdrop-blur-md">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-medium">Neural Core</h2>
              <span className="text-xs uppercase tracking-[0.2em] text-slate-300">
                {coreState}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
              <NeuralCoreVisualizer palette={palette} />
              <TelemetryPanel tps={tps} memoryUsage={memoryUsage} latency={latency} wave={wave} />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <StatusCard title="OpenCode Link" value={connected ? 'Connected' : 'Disconnected'} meta="12ms" />
            <StatusCard title="Active Model" value="DeepSeek-R1-Distill" meta="Health 98%" />
            <ModeSwitcher mode={mode} onModeChange={setMode} />
          </div>
        </section>

        <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-miya-card/35 p-5 backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">
                Synapse Status
              </h3>
              <Cable className="h-4 w-4 text-miya-primary" />
            </div>
            <div className="space-y-3">
              {providers.map((provider) => (
                <SynapseStatus key={provider.name} {...provider} />
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-miya-card/35 p-5 backdrop-blur-md">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">
              Runtime Snapshot
            </h3>
            <div className="space-y-2 text-sm text-slate-200">
              <p className="flex items-center justify-between">
                <span>Session</span>
                <span>{sessionId}</span>
              </p>
              <p className="flex items-center justify-between">
                <span>Active Tool</span>
                <span>{activeTool}</span>
              </p>
              <p className="flex items-center justify-between">
                <span>Permission</span>
                <span>{permission}</span>
              </p>
              <p className="flex items-center justify-between">
                <span>CPU Load</span>
                <span>{cpu.toFixed(1)}%</span>
              </p>
              <p className="flex items-center justify-between">
                <span>Sessions</span>
                <span>
                  {sessions}/{sessionsTotal}
                </span>
              </p>
              <p className="flex items-center justify-between">
                <span>Automation Jobs</span>
                <span>
                  {jobs}/{jobsTotal}
                </span>
              </p>
              <p className="flex items-center justify-between">
                <span>Active Job</span>
                <span>{status.daemon?.activeJobID ?? 'none'}</span>
              </p>
              <p className="flex items-center justify-between">
                <span>Progress</span>
                <span>{status.daemon?.activeJobProgress ?? 0}%</span>
              </p>
              <p className="flex items-center justify-between">
                <span>Pending Tickets</span>
                <span>{pendingTickets}</span>
              </p>
              <p className="flex items-center justify-between">
                <span>Kill Switch</span>
                <span>{killSwitchMode}</span>
              </p>
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-miya-card/35 p-5 backdrop-blur-md">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">
              Memory Visualizer
            </h3>
            <div className="flex flex-wrap gap-2">
              {memoryKeywords.map((item) => (
                <span
                  className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs"
                  key={item.word}
                  style={{ opacity: Math.min(1, 0.45 + item.weight / 30) }}
                >
                  {item.word}
                </span>
              ))}
            </div>
            <div className="mt-4 space-y-1 text-xs text-slate-300">
              {insights.slice(-3).map((item, idx) => (
                <p key={`${item.auditID ?? 'ins'}-${idx}`}>{item.text ?? 'n/a'}</p>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
}: {
  icon: ReactElement;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      className={`group flex w-14 flex-col items-center gap-1 rounded-2xl border p-2 text-[11px] transition ${
        active
          ? 'border-miya-primary/40 bg-miya-primary/15 text-miya-primary'
          : 'border-white/10 bg-black/10 text-slate-300 hover:border-white/25 hover:text-white'
      }`}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function NeuralCoreVisualizer({
  palette,
}: {
  palette: { ring: string; glow: string; speed: number };
}) {
  return (
    <div className="flex min-h-[260px] items-center justify-center">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 20 / palette.speed, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
        className="relative flex h-52 w-52 items-center justify-center rounded-full"
        style={{ boxShadow: `0 0 60px ${palette.glow}` }}
      >
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 2.4 / palette.speed, repeat: Number.POSITIVE_INFINITY }}
          className="absolute h-52 w-52 rounded-full border-2"
          style={{ borderColor: palette.ring }}
        />
        <motion.div
          animate={{ scale: [0.86, 1, 0.86], opacity: [0.55, 0.95, 0.55] }}
          transition={{ duration: 2 / palette.speed, repeat: Number.POSITIVE_INFINITY }}
          className="h-36 w-36 rounded-full"
          style={{
            background: `radial-gradient(circle, ${palette.ring}88 0%, ${palette.ring}22 65%, transparent 100%)`,
          }}
        />
      </motion.div>
    </div>
  );
}

function TelemetryPanel({
  tps,
  memoryUsage,
  latency,
  wave,
}: {
  tps: number;
  memoryUsage: number;
  latency: number;
  wave: WavePoint[];
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile title="TPS" value={`${tps}`} suffix="tokens/s" />
        <Tile title="Memory" value={`${memoryUsage}%`} suffix="/ 128k" />
        <Tile title="Latency" value={`${latency}`} suffix="ms" />
      </div>
      <div className="h-40 rounded-2xl border border-white/10 bg-black/25 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={wave}>
            <CartesianGrid strokeDasharray="4 6" stroke="rgba(148,163,184,0.2)" />
            <XAxis hide dataKey="t" />
            <YAxis width={28} tick={{ fill: '#94a3b8', fontSize: 10 }} />
            <Tooltip
              contentStyle={{
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 12,
                background: 'rgba(15,23,42,0.9)',
                color: '#f8fafc',
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#38bdf8"
              strokeWidth={2}
              dot={false}
              isAnimationActive
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Tile({ title, value, suffix }: { title: string; value: string; suffix: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-300">{title}</p>
      <p className="mt-1 text-lg font-semibold text-white">
        {value} <span className="text-xs font-normal text-slate-300">{suffix}</span>
      </p>
    </div>
  );
}

function SynapseStatus({ name, online, latency }: { name: string; online: boolean; latency: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        {online ? <Sparkles className="h-4 w-4 text-miya-primary" /> : <Link2Off className="h-4 w-4 text-miya-danger" />}
        <span>{name}</span>
      </div>
      <span className={`text-xs ${online ? 'text-emerald-400' : 'text-miya-danger'}`}>
        {online ? `${latency}ms` : 'link broken'}
      </span>
    </div>
  );
}

function StatusCard({ title, value, meta }: { title: string; value: string; meta: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-miya-card/45 p-4 backdrop-blur-md">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-300">{title}</p>
      <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
        {value}
        <ChevronRight className="h-4 w-4 text-miya-primary" />
      </p>
      <p className="mt-1 text-xs text-slate-300">{meta}</p>
    </div>
  );
}

function ModeSwitcher({
  mode,
  onModeChange,
}: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-miya-card/45 p-4 backdrop-blur-md">
      <p className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-300">Mode Switch</p>
      <ToggleGroup.Root
        type="single"
        className="grid grid-cols-3 gap-2"
        value={mode}
        onValueChange={(value) => {
          if (value === 'speed' || value === 'deep' || value === 'creative') {
            onModeChange(value);
          }
        }}
      >
        <ModeButton value="speed" label="Speed" />
        <ModeButton value="deep" label="Deep" accent />
        <ModeButton value="creative" label="Creative" />
      </ToggleGroup.Root>
    </div>
  );
}

function ModeButton({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <ToggleGroup.Item
      value={value}
      className={`rounded-lg border px-2 py-2 text-xs transition data-[state=on]:text-white ${
        accent
          ? 'border-miya-accent/30 text-miya-accent data-[state=on]:bg-miya-accent/25'
          : 'border-white/15 text-slate-300 data-[state=on]:bg-miya-primary/25'
      }`}
    >
      {label}
    </ToggleGroup.Item>
  );
}
