/**
 * Security Page - 安全与风控模块
 *
 * Displays security controls, policy domains, trust mode configuration, and evidence packs.
 * Requirements: 4.1, 4.2, 4.5, 4.7
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
import type {
  KillSwitchMode,
  PolicyDomainRow,
  TrustModeConfig,
} from '../types/gateway';

/**
 * KillSwitchStatusCard Component
 * Displays current Kill-Switch mode and provides control buttons
 * Requirements: 4.1, 4.2
 */
interface KillSwitchStatusCardProps {
  mode: KillSwitchMode;
  onModeChange: (mode: KillSwitchMode) => Promise<void>;
}

const KillSwitchStatusCard = React.memo<KillSwitchStatusCardProps>(
  function KillSwitchStatusCard({ mode, onModeChange }) {
    const [loading, setLoading] = React.useState(false);

    const handleModeChange = useStableCallback(
      async (newMode: KillSwitchMode) => {
        if (loading) return;

        // Confirmation for critical modes (Requirement 4.10)
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
        all_stop: {
          label: '全部停止',
          color: 'red',
          icon: '🛑',
          description: '停止所有操作',
        },
        outbound_only: {
          label: '仅停外发',
          color: 'orange',
          icon: '📤',
          description: '仅停止消息外发',
        },
        desktop_only: {
          label: '仅停桌控',
          color: 'yellow',
          icon: '🖥️',
          description: '仅停止桌面控制',
        },
        off: {
          label: '正常运行',
          color: 'green',
          icon: '✅',
          description: '所有功能正常',
        },
      }),
      [],
    );

    const currentConfig = modeConfig[mode];

    return (
      <Card title="Kill-Switch 状态" subtitle="全局急停控制">
        <div className="space-y-4">
          {/* Current Status */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div className="flex items-center">
              <span className="text-3xl mr-3">{currentConfig.icon}</span>
              <div>
                <div className="text-lg font-bold text-slate-900">
                  {currentConfig.label}
                </div>
                <div className="text-sm text-slate-600">
                  {currentConfig.description}
                </div>
              </div>
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
                px-3 py-2 rounded-lg border-2 transition-all text-sm
                ${
                  mode === modeKey
                    ? 'border-blue-500 bg-blue-50 cursor-default'
                    : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'
                }
                ${loading ? 'opacity-50 cursor-not-allowed' : ''}
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
              >
                <div className="flex items-center justify-center">
                  <span className="text-xl mr-2">{config.icon}</span>
                  <span className="font-medium">{config.label}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </Card>
    );
  },
);

/**
 * PolicyDomainsCard Component
 * Displays all policy domains and their status
 * Requirements: 4.3, 4.4
 * Note: This is a placeholder - will be implemented in task 10.2
 */
interface PolicyDomainsCardProps {
  domains: PolicyDomainRow[];
  onToggle: (domain: string) => Promise<void>;
}

const PolicyDomainsCard = React.memo<PolicyDomainsCardProps>(
  function PolicyDomainsCard({ domains, onToggle }) {
    return (
      <Card title="策略域状态" subtitle="权限范围控制">
        <div className="space-y-3">
          {domains.length === 0 ? (
            <div className="text-center text-slate-500 py-4">暂无策略域</div>
          ) : (
            domains.map((domain) => (
              <div
                key={domain.domain}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
              >
                <div>
                  <div className="font-medium text-slate-900">
                    {domain.label}
                  </div>
                  <div className="text-xs text-slate-600">{domain.domain}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onToggle(domain.domain)}
                  className={`
                  px-3 py-1 rounded text-sm font-medium transition-colors
                  ${
                    domain.paused
                      ? 'bg-red-100 text-red-700 hover:bg-red-200'
                      : 'bg-green-100 text-green-700 hover:bg-green-200'
                  }
                `}
                >
                  {domain.paused ? '已暂停' : '运行中'}
                </button>
              </div>
            ))
          )}
        </div>
      </Card>
    );
  },
);

/**
 * TrustModeCard Component
 * Displays and allows editing of trust mode configuration
 * Requirements: 4.5, 4.6
 * Note: This is a placeholder - will be implemented in task 10.3
 */
interface TrustModeCardProps {
  config: TrustModeConfig;
  onSave: (config: TrustModeConfig) => Promise<void>;
}

const TrustModeCard = React.memo<TrustModeCardProps>(function TrustModeCard({
  config,
  onSave,
}) {
  const [formData, setFormData] = React.useState<TrustModeConfig>(config);
  const [saving, setSaving] = React.useState(false);

  const handleSave = useStableCallback(async () => {
    setSaving(true);
    try {
      await onSave(formData);
    } catch (error) {
      console.error('Failed to save trust mode config:', error);
      alert('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  });

  return (
    <Card title="信任模式配置" subtitle="静默与模态阈值">
      <div className="space-y-4">
        <div className="space-y-2">
          <label
            htmlFor="silentMin"
            className="text-sm font-medium text-slate-700"
          >
            静默最小分: {formData.silentMin}
          </label>
          <input
            id="silentMin"
            type="number"
            min="0"
            max="100"
            value={formData.silentMin}
            onChange={(e) =>
              setFormData({
                ...formData,
                silentMin: parseInt(e.target.value, 10) || 0,
              })
            }
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="modalMax"
            className="text-sm font-medium text-slate-700"
          >
            模态最大分: {formData.modalMax}
          </label>
          <input
            id="modalMax"
            type="number"
            min="0"
            max="100"
            value={formData.modalMax}
            onChange={(e) =>
              setFormData({
                ...formData,
                modalMax: parseInt(e.target.value, 10) || 0,
              })
            }
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {saving ? '保存中...' : '保存配置'}
        </button>
      </div>
    </Card>
  );
});

/**
 * EvidencePackList Component
 * Displays recent execution sequences (Evidence Pack V5)
 * Requirements: 4.7, 4.8, 4.9
 * Note: This is a placeholder - will be implemented in task 10.4
 */
interface EvidencePackListProps {
  recentOutbound: Array<{
    id: string;
    timestamp: string;
    channel: string;
    target: string;
    sendStatus: string;
    evidenceConfidence?: number;
    preScreenshot?: string;
    postScreenshot?: string;
  }>;
}

const EvidencePackList = React.memo<EvidencePackListProps>(
  function EvidencePackList({ recentOutbound }) {
    return (
      <Card title="最近执行序列" subtitle="Evidence Pack V5 预览">
        <div className="space-y-3">
          {recentOutbound.length === 0 ? (
            <div className="text-center text-slate-500 py-4">暂无执行记录</div>
          ) : (
            recentOutbound.map((item) => (
              <div
                key={item.id}
                className="p-3 bg-slate-50 rounded-lg space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-900">
                    {item.channel} → {item.target}
                  </div>
                  <div
                    className={`
                  text-xs px-2 py-1 rounded
                  ${item.sendStatus === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}
                `}
                  >
                    {item.sendStatus}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>{new Date(item.timestamp).toLocaleString()}</span>
                  {item.evidenceConfidence !== undefined && (
                    <span>置信度: {item.evidenceConfidence}%</span>
                  )}
                </div>

                {(item.preScreenshot || item.postScreenshot) && (
                  <div className="flex gap-2 pt-2">
                    {item.preScreenshot && (
                      <button type="button" className="text-xs text-blue-600 hover:underline">
                        查看前置截图
                      </button>
                    )}
                    {item.postScreenshot && (
                      <button type="button" className="text-xs text-blue-600 hover:underline">
                        查看后置截图
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </Card>
    );
  },
);

/**
 * SessionPermissionCard Component
 * Displays current session permission information
 * Requirement: 4.11
 */
interface SessionPermissionCardProps {
  activeTool?: string;
  permission?: string;
}

const SessionPermissionCard = React.memo<SessionPermissionCardProps>(
  function SessionPermissionCard({ activeTool, permission }) {
    return (
      <Card title="会话权限" subtitle="当前会话信息">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">激活工具</span>
            <span className="text-sm font-medium text-slate-900">
              {activeTool || '无'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">权限级别</span>
            <span className="text-sm font-medium text-slate-900">
              {permission || '未设置'}
            </span>
          </div>
        </div>
      </Card>
    );
  },
);

/**
 * SecurityPage Component
 * Main security and risk control page
 * Requirements: 4.1, 4.2, 4.5, 4.7
 */
export const SecurityPage = React.memo(function SecurityPage() {
  const {
    snapshot,
    setKillSwitch,
    loading,
    updateTrustMode,
    togglePolicyDomain,
  } = useGateway();
  const memoizedSnapshot = useMemoizedSnapshot(snapshot);

  const policyDomains = React.useMemo<PolicyDomainRow[]>(() => {
    const candidate = (
      memoizedSnapshot?.configCenter as Record<string, unknown> | undefined
    )?.policyDomains;
    if (!Array.isArray(candidate)) {
      return [];
    }
    return candidate.filter((item): item is PolicyDomainRow => {
      return (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { domain?: unknown }).domain === 'string' &&
        typeof (item as { label?: unknown }).label === 'string' &&
        typeof (item as { paused?: unknown }).paused === 'boolean'
      );
    });
  }, [memoizedSnapshot]);

  // Stable callback for kill switch mode change
  const handleKillSwitchChange = useStableCallback(
    async (mode: KillSwitchMode) => {
      await setKillSwitch(mode);
    },
  );

  // Stable callback for policy domain toggle
  const handlePolicyDomainToggle = useStableCallback(async (domain: string) => {
    const existing = policyDomains.find((item) => item.domain === domain);
    const nextPaused = existing ? !existing.paused : true;
    await togglePolicyDomain(domain, nextPaused);
  });

  // Stable callback for trust mode save
  const handleTrustModeSave = useStableCallback(
    async (config: TrustModeConfig) => {
      await updateTrustMode(config);
    },
  );

  // Show loading state on initial load
  if (loading || !memoizedSnapshot) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">安全与风控</h1>
          <p className="text-slate-600 mt-1">权限控制与审计</p>
        </div>
        <div className="text-center py-12 text-slate-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">安全与风控</h1>
        <p className="text-slate-600 mt-1">权限控制与审计</p>
      </div>

      {/* Kill-Switch Status - Requirement 4.1, 4.2 */}
      <KillSwitchStatusCard
        mode={memoizedSnapshot.nexus.killSwitchMode}
        onModeChange={handleKillSwitchChange}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Policy Domains - Requirement 4.3, 4.4 */}
        <PolicyDomainsCard
          domains={policyDomains}
          onToggle={handlePolicyDomainToggle}
        />

        {/* Trust Mode Configuration - Requirement 4.5, 4.6 */}
        <TrustModeCard
          config={memoizedSnapshot.nexus.trustMode}
          onSave={handleTrustModeSave}
        />
      </div>

      {/* Session Permission - Requirement 4.11 */}
      <SessionPermissionCard
        activeTool={memoizedSnapshot.nexus.activeTool}
        permission={memoizedSnapshot.nexus.permission}
      />

      {/* Evidence Pack List - Requirement 4.7, 4.8, 4.9 */}
      <EvidencePackList
        recentOutbound={memoizedSnapshot.channels.recentOutbound}
      />
    </div>
  );
});
