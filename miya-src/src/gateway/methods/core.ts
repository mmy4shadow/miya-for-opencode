import {
  getAutoflowPersistentRuntimeSnapshot,
  listAutoflowSessions,
  readAutoflowPersistentConfig,
} from '../../autoflow';
import {
  getLauncherBackpressureStats,
  getLauncherDaemonSnapshot,
  getMiyaClient,
} from '../../daemon';
import { getLearningStats, listSkillDrafts, buildLearningInjection } from '../../learning';
import {
  getRouteCostSummary,
  listRouteCostRecords,
  readRouterModeConfig,
} from '../../router';
import { readModeObservability } from '../mode-observability';
import { MODE_POLICY_FREEZE_V1 } from '../mode-policy';
import type {
  GatewayMethodRegistry,
} from '../protocol';

interface GatewayCoreMethodDeps {
  projectDir: string;
  runtime: {
    methods: GatewayMethodRegistry;
  };
  now: () => string;
  buildSnapshot: () => {
    doctor: unknown;
  };
  buildGatewayState: () => unknown;
  scheduleGatewayStop: () => void;
  ensureGatewayRunning: () => { url: string };
  probeGatewayAlive: (url: string, timeoutMs?: number) => Promise<boolean>;
  listActionLedger: (limit: number) => unknown[];
}

function parseText(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

export function registerGatewayCoreMethods(
  methods: GatewayMethodRegistry,
  deps: GatewayCoreMethodDeps,
): void {
  methods.register('gateway.status.get', async () => deps.buildSnapshot());
  methods.register('autoflow.status.get', async (params) => {
    const limit = typeof params.limit === 'number' ? Number(params.limit) : 30;
    const sessions = listAutoflowSessions(
      deps.projectDir,
      Math.max(1, Math.min(200, limit)),
    );
    const persistentConfig = readAutoflowPersistentConfig(deps.projectDir);
    const persistentSessions = getAutoflowPersistentRuntimeSnapshot(
      deps.projectDir,
      Math.max(1, Math.min(200, limit)),
    );
    return {
      active: sessions.filter(
        (item) =>
          item.phase === 'planning' ||
          item.phase === 'execution' ||
          item.phase === 'verification' ||
          item.phase === 'fixing',
      ).length,
      sessions,
      persistent: {
        ...persistentConfig,
        sessions: persistentSessions,
      },
    };
  });
  methods.register('routing.stats.get', async (params) => {
    const limit = typeof params.limit === 'number' ? Number(params.limit) : 200;
    const mode = readRouterModeConfig(deps.projectDir);
    return {
      mode,
      modePolicy: MODE_POLICY_FREEZE_V1,
      cost: getRouteCostSummary(deps.projectDir, Math.max(1, Math.min(1000, limit))),
      recent: listRouteCostRecords(deps.projectDir, Math.max(1, Math.min(100, limit))),
      modeObservability: readModeObservability(deps.projectDir),
    };
  });
  methods.register('mode.policy.get', async () => ({
    modePolicy: MODE_POLICY_FREEZE_V1,
  }));
  methods.register('learning.drafts.stats', async () => ({
    stats: getLearningStats(deps.projectDir),
  }));
  methods.register('learning.drafts.list', async (params) => {
    const limit = typeof params.limit === 'number' ? Number(params.limit) : 30;
    const statusRaw = parseText(params.status);
    const status =
      statusRaw === 'draft' ||
      statusRaw === 'recommended' ||
      statusRaw === 'accepted' ||
      statusRaw === 'rejected'
        ? statusRaw
        : undefined;
    return {
      drafts: listSkillDrafts(deps.projectDir, {
        limit: Math.max(1, Math.min(200, limit)),
        status,
      }),
    };
  });
  methods.register('learning.drafts.recommend', async (params) => {
    const query = parseText(params.query);
    if (!query) throw new Error('query_required');
    const threshold =
      typeof params.threshold === 'number' ? Number(params.threshold) : undefined;
    const limit = typeof params.limit === 'number' ? Number(params.limit) : undefined;
    return buildLearningInjection(deps.projectDir, query, {
      threshold,
      limit,
    });
  });
  methods.register('gateway.shutdown', async () => {
    const state = deps.buildGatewayState();
    deps.scheduleGatewayStop();
    return { ok: true, state };
  });
  methods.register('doctor.run', async () => deps.buildSnapshot().doctor);
  methods.register('gateway.backpressure.stats', async () => ({
    ...deps.runtime.methods.stats(),
    updatedAt: deps.now(),
  }));
  methods.register('audit.ledger.list', async (params) => {
    const limitRaw = typeof params.limit === 'number' ? Number(params.limit) : 50;
    const limit = Math.max(1, Math.min(500, Math.floor(limitRaw)));
    return {
      items: deps.listActionLedger(limit),
    };
  });
  methods.register('daemon.backpressure.stats', async () => ({
    ...getLauncherBackpressureStats(deps.projectDir),
    updatedAt: deps.now(),
  }));
  methods.register('daemon.psyche.signals.get', async () => {
    const daemon = getMiyaClient(deps.projectDir);
    try {
      const status = await daemon.psycheSignalsGet();
      return {
        ok: true,
        status,
        updatedAt: deps.now(),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        updatedAt: deps.now(),
      };
    }
  });
  methods.register('gateway.pressure.run', async (params) => {
    const concurrencyRaw =
      typeof params.concurrency === 'number' ? Number(params.concurrency) : 10;
    const roundsRaw = typeof params.rounds === 'number' ? Number(params.rounds) : 1;
    const timeoutMs = typeof params.timeoutMs === 'number' ? Number(params.timeoutMs) : 20_000;
    const concurrency = Math.max(1, Math.min(100, Math.floor(concurrencyRaw)));
    const rounds = Math.max(1, Math.min(20, Math.floor(roundsRaw)));
    const daemon = getMiyaClient(deps.projectDir);
    const startedAtMs = Date.now();
    let success = 0;
    let failed = 0;
    const errors: string[] = [];
    for (let round = 0; round < rounds; round += 1) {
      const tasks = Array.from({ length: concurrency }, async (_, index) => {
        try {
          await daemon.runIsolatedProcess({
            kind: 'generic',
            command: process.platform === 'win32' ? 'cmd' : 'sh',
            args:
              process.platform === 'win32'
                ? ['/c', 'echo', `miya-pressure-${round}-${index}`]
                : ['-lc', `echo miya-pressure-${round}-${index}`],
            timeoutMs: Math.max(1_000, timeoutMs),
          });
          success += 1;
        } catch (error) {
          failed += 1;
          errors.push(error instanceof Error ? error.message : String(error));
        }
      });
      await Promise.all(tasks);
    }
    return {
      success,
      failed,
      elapsedMs: Date.now() - startedAtMs,
      gateway: deps.runtime.methods.stats(),
      daemon: getLauncherBackpressureStats(deps.projectDir),
      errors: errors.slice(0, 20),
    };
  });
  methods.register('gateway.startup.probe.run', async (params) => {
    const roundsRaw = typeof params.rounds === 'number' ? Number(params.rounds) : 20;
    const rounds = Math.max(1, Math.min(100, Math.floor(roundsRaw)));
    const waitMsRaw = typeof params.waitMs === 'number' ? Number(params.waitMs) : 250;
    const waitMs = Math.max(50, Math.min(5_000, Math.floor(waitMsRaw)));
    const gatewayState = deps.buildGatewayState() as { url?: unknown } | null;
    const urlFromRuntime =
      gatewayState && typeof gatewayState.url === 'string' && gatewayState.url.trim().length > 0
        ? gatewayState.url
        : undefined;
    const probeUrl = urlFromRuntime ?? deps.ensureGatewayRunning().url;
    let healthy = 0;
    let daemonReady = 0;
    const samples: Array<{
      index: number;
      gatewayAlive: boolean;
      daemonConnected: boolean;
      daemonStatus: string;
    }> = [];
    for (let index = 0; index < rounds; index += 1) {
      const gatewayAlive = await deps.probeGatewayAlive(probeUrl, 1_200);
      const daemonSnapshot = getLauncherDaemonSnapshot(deps.projectDir);
      const daemonConnected = Boolean(daemonSnapshot.connected);
      if (gatewayAlive) healthy += 1;
      if (daemonConnected) daemonReady += 1;
      samples.push({
        index: index + 1,
        gatewayAlive,
        daemonConnected,
        daemonStatus: daemonSnapshot.statusText,
      });
      if (index < rounds - 1) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    return {
      rounds,
      gatewayHealthy: healthy,
      daemonConnected: daemonReady,
      gatewaySuccessRate: Number(((healthy / rounds) * 100).toFixed(2)),
      daemonSuccessRate: Number(((daemonReady / rounds) * 100).toFixed(2)),
      samples,
    };
  });
}
