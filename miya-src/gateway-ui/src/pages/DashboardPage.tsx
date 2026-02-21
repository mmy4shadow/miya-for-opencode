/**
 * Dashboard Page - 控制中枢
 *
 * Displays core system status and global Kill-Switch control.
 * Follows requirements 2.1, 2.2, 2.8 - minimal information display.
 *
 * Performance optimizations:
 * - Uses React.memo to prevent unnecessary re-renders
 * - Uses useMemoizedSnapshot for efficient data access
 * - Uses useStableCallback for stable event handlers
 */

import React, { useMemo } from 'react';
import { Card } from '../components/Card';
import { useGateway } from '../hooks/useGateway';
import { useMemoizedSnapshot } from '../hooks/useMemoizedSnapshot';
import { useStableCallback } from '../hooks/useStableCallback';
import type { KillSwitchMode } from '../types/gateway';

/**
 * QuickStats Component
 * Displays connection status, sessions, tasks, and risk tickets
 * Requirement 2.1, 2.8
 */
interface QuickStatsProps {
  connected: boolean;
  sessions: {
    total: number;
    active: number;
    queued: number;
    muted: number;
  };
  jobs: {
    total: number;
    enabled: number;
    pendingApprovals: number;
  };
  nexus: {
    pendingTickets: number;
  };
}

const QuickStats = React.memo<QuickStatsProps>(function QuickStats({
  connected,
  sessions,
  jobs,
  nexus,
}) {
  // Memoize derived stats to prevent recalculation
  const stats = useMemo(
    () => [
      {
        label: '连接状态',
        value: connected ? '在线' : '离线',
        status: connected ? 'success' : 'error',
      },
      {
        label: '会话',
        value: `${sessions.active}/${sessions.total}`,
        status: sessions.active > 0 ? 'success' : 'idle',
      },
      {
        label: '任务',
        value: `${jobs.enabled}/${jobs.total}`,
        status: jobs.enabled > 0 ? 'success' : 'idle',
      },
      {
        label: '风险票据',
        value: nexus.pendingTickets,
        status: nexus.pendingTickets > 0 ? 'warning' : 'success',
      },
    ],
    [
      connected,
      sessions.active,
      sessions.total,
      jobs.enabled,
      jobs.total,
      nexus.pendingTickets,
    ],
  );

  return (
    <Card title="快速统计" subtitle="系统核心指标">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="text-center">
            <div
              className={`text-2xl font-bold ${
                stat.status === 'success'
                  ? 'text-green-600'
                  : stat.status === 'warning'
                    ? 'text-yellow-600'
                    : stat.status === 'error'
                      ? 'text-red-600'
                      : 'text-gray-600'
              }`}
            >
              {stat.value}
            </div>
            <div className="text-sm text-gray-600 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>
    </Card>
  );
});

/**
 * KillSwitchCard Component
 * Displays and controls the global Kill-Switch mode
 * Requirement 2.2
 */
interface KillSwitchCardProps {
  mode: KillSwitchMode;
  onModeChange: (mode: KillSwitchMode) => Promise<void>;
}

const KillSwitchCard = React.memo<KillSwitchCardProps>(function KillSwitchCard({
  mode,
  onModeChange,
}) {
  const [loading, setLoading] = React.useState(false);

  // Stable callback to prevent child re-renders
  const handleModeChange = useStableCallback(
    async (newMode: KillSwitchMode) => {
      if (loading) return;

      // Confirmation for critical modes
      if (newMode === 'all_stop') {
        const confirmed = window.confirm(
          '确认要启用全局急停吗？这将停止所有系统操作。',
        );
        if (!confirmed) return;
      }

      setLoading(true);
      try {
        await onModeChange(newMode);
      } catch (error) {
        console.error('Failed to change kill switch mode:', error);
        alert('切换模式失败，请重试');
      } finally {
        setLoading(false);
      }
    },
  );

  const modeConfig = useMemo(
    () => ({
      all_stop: { label: '全部停止', color: 'red', icon: '🛑' },
      outbound_only: { label: '仅停外发', color: 'orange', icon: '📤' },
      desktop_only: { label: '仅停桌控', color: 'yellow', icon: '🖥️' },
      off: { label: '正常运行', color: 'green', icon: '✅' },
    }),
    [],
  );

  const currentConfig = modeConfig[mode];

  return (
    <Card title="全局急停控制" subtitle="Kill-Switch 模式">
      <div className="space-y-4">
        {/* Current Status */}
        <div className="flex items-center justify-center p-6 bg-gray-50 rounded-lg">
          <span className="text-4xl mr-3">{currentConfig.icon}</span>
          <div>
            <div className="text-xl font-bold">{currentConfig.label}</div>
            <div className="text-sm text-gray-600">当前模式</div>
          </div>
        </div>

        {/* Mode Buttons */}
        <div className="grid grid-cols-2 gap-3">
          {(
            Object.entries(modeConfig) as [
              KillSwitchMode,
              (typeof modeConfig)[KillSwitchMode],
            ][]
          ).map(([modeKey, config]) => (
            <button
              key={modeKey}
              type="button"
              onClick={() => handleModeChange(modeKey)}
              disabled={loading || mode === modeKey}
              className={`
                px-4 py-3 rounded-lg border-2 transition-all
                ${
                  mode === modeKey
                    ? 'border-blue-500 bg-blue-50 cursor-default'
                    : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                }
                ${loading ? 'opacity-50 cursor-not-allowed' : ''}
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            >
              <div className="flex items-center justify-center">
                <span className="text-2xl mr-2">{config.icon}</span>
                <span className="font-medium">{config.label}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
});

/**
 * SystemStatusCard Component
 * Displays system online status and CPU/memory summary
 * Requirement 2.1
 */
interface SystemStatusCardProps {
  connected: boolean;
  cpuPercent?: number;
  memoryMB?: number;
  activeAgentId?: string;
}

const SystemStatusCard = React.memo<SystemStatusCardProps>(
  function SystemStatusCard({
    connected,
    cpuPercent,
    memoryMB,
    activeAgentId,
  }) {
    return (
      <Card title="系统状态" subtitle="核心运行指标">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-gray-600">在线状态</span>
            <span
              className={`font-medium ${connected ? 'text-green-600' : 'text-red-600'}`}
            >
              {connected ? '✅ 在线' : '❌ 离线'}
            </span>
          </div>

          {activeAgentId && (
            <div className="flex justify-between items-center">
              <span className="text-gray-600">当前代理</span>
              <span className="font-medium text-blue-600">{activeAgentId}</span>
            </div>
          )}

          {cpuPercent !== undefined && (
            <div className="flex justify-between items-center">
              <span className="text-gray-600">CPU 使用率</span>
              <span className="font-medium">{cpuPercent.toFixed(1)}%</span>
            </div>
          )}

          {memoryMB !== undefined && (
            <div className="flex justify-between items-center">
              <span className="text-gray-600">内存使用</span>
              <span className="font-medium">{memoryMB.toFixed(0)} MB</span>
            </div>
          )}
        </div>
      </Card>
    );
  },
);

/**
 * DashboardPage Component
 * Main dashboard page displaying core system status
 * Requirements 2.1, 2.2, 2.8
 */
export const DashboardPage = React.memo(function DashboardPage() {
  const { snapshot, setKillSwitch, loading } = useGateway();
  const memoizedSnapshot = useMemoizedSnapshot(snapshot);

  // Stable callback for kill switch mode change
  const handleKillSwitchChange = useStableCallback(
    async (mode: KillSwitchMode) => {
      await setKillSwitch(mode);
    },
  );

  // Show loading state on initial load
  if (loading || !memoizedSnapshot) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">控制中枢</h1>
          <p className="text-gray-600 mt-1">核心状态总览</p>
        </div>
        <div className="text-center py-12 text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">控制中枢</h1>
        <p className="text-gray-600 mt-1">核心状态总览</p>
      </div>

      {/* System Status */}
      <SystemStatusCard
        connected={memoizedSnapshot.daemon.connected}
        cpuPercent={memoizedSnapshot.daemon.cpuPercent}
        memoryMB={memoizedSnapshot.daemon.memoryMB}
        activeAgentId={memoizedSnapshot.runtime.activeAgentId}
      />

      {/* Kill Switch Control - Most prominent position (Requirement 2.2) */}
      <KillSwitchCard
        mode={memoizedSnapshot.nexus.killSwitchMode}
        onModeChange={handleKillSwitchChange}
      />

      {/* Quick Stats */}
      <QuickStats
        connected={memoizedSnapshot.daemon.connected}
        sessions={memoizedSnapshot.sessions}
        jobs={memoizedSnapshot.jobs}
        nexus={memoizedSnapshot.nexus}
      />
    </div>
  );
});
