/**
 * Psyche Page - 交互感知模块
 *
 * Displays Guardian status and provides configuration forms for all Psyche parameters.
 * Requirements: 3.1-3.14
 */

import React, { useCallback, useState } from 'react';
import { Card } from '../components/Card';
import { useGateway } from '../hooks/useGateway';
import type { PsycheModeConfig } from '../types/gateway';

/**
 * PsycheSignalHubCard - Displays Guardian status
 * Requirements: 3.1, 3.14
 */
const PsycheSignalHubCard = React.memo<{
  hub?: {
    running: boolean;
    sequenceNo?: number;
    sampledAt?: string;
    latencyMs?: number;
  };
  guardianSafeHoldReason?: string;
}>(function PsycheSignalHubCard({ hub, guardianSafeHoldReason }) {
  return (
    <Card title="守门员状态" subtitle="Psyche Signal Hub">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-600">运行状态</span>
          <span
            className={`text-sm font-medium ${hub?.running ? 'text-green-600' : 'text-slate-400'}`}
          >
            {hub?.running ? '运行中' : '离线'}
          </span>
        </div>

        {hub?.sequenceNo !== undefined && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">序列号</span>
            <span className="text-sm font-mono">{hub.sequenceNo}</span>
          </div>
        )}

        {hub?.sampledAt && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">采样时间</span>
            <span className="text-sm">
              {new Date(hub.sampledAt).toLocaleString()}
            </span>
          </div>
        )}

        {hub?.latencyMs !== undefined && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">延迟</span>
            <span className="text-sm">{hub.latencyMs}ms</span>
          </div>
        )}

        {guardianSafeHoldReason && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="text-xs font-medium text-amber-800 mb-1">
              安全保持原因
            </div>
            <div className="text-sm text-amber-700">
              {guardianSafeHoldReason}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
});

/**
 * PsycheModeForm - Configuration form for all Psyche parameters
 * Requirements: 3.2-3.13
 */
const PsycheModeForm = React.memo<{
  config: PsycheModeConfig;
  onSave: (config: PsycheModeConfig) => Promise<void>;
}>(function PsycheModeForm({ config, onSave }) {
  const [formData, setFormData] = useState<PsycheModeConfig>(config);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(formData);
    } finally {
      setSaving(false);
    }
  }, [formData, onSave]);

  return (
    <Card title="Psyche 配置" subtitle="交互感知参数设置">
      <div className="space-y-6">
        {/* 共鸣层开关 - Requirement 3.2 */}
        <div className="flex items-center justify-between">
          <label
            htmlFor="resonanceEnabled"
            className="text-sm font-medium text-slate-700"
          >
            共鸣层
          </label>
          <input
            id="resonanceEnabled"
            type="checkbox"
            checked={formData.resonanceEnabled}
            onChange={(e) =>
              setFormData({ ...formData, resonanceEnabled: e.target.checked })
            }
            className="h-4 w-4 rounded border-slate-300"
          />
        </div>

        {/* 捕获探针开关 - Requirement 3.3 */}
        <div className="flex items-center justify-between">
          <label
            htmlFor="captureProbeEnabled"
            className="text-sm font-medium text-slate-700"
          >
            捕获探针
          </label>
          <input
            id="captureProbeEnabled"
            type="checkbox"
            checked={formData.captureProbeEnabled}
            onChange={(e) =>
              setFormData({
                ...formData,
                captureProbeEnabled: e.target.checked,
              })
            }
            className="h-4 w-4 rounded border-slate-300"
          />
        </div>

        {/* 信号覆盖开关 - Requirement 3.4 */}
        <div className="flex items-center justify-between">
          <label
            htmlFor="signalOverrideEnabled"
            className="text-sm font-medium text-slate-700"
          >
            信号覆盖
          </label>
          <input
            id="signalOverrideEnabled"
            type="checkbox"
            checked={formData.signalOverrideEnabled ?? false}
            onChange={(e) =>
              setFormData({
                ...formData,
                signalOverrideEnabled: e.target.checked,
              })
            }
            className="h-4 w-4 rounded border-slate-300"
          />
        </div>

        {/* 主动探索率滑动条 - Requirement 3.5 */}
        <div className="space-y-2">
          <label
            htmlFor="proactivityExploreRate"
            className="text-sm font-medium text-slate-700"
          >
            主动探索率: {formData.proactivityExploreRate ?? 0}%
          </label>
          <input
            id="proactivityExploreRate"
            type="range"
            min="0"
            max="100"
            value={formData.proactivityExploreRate ?? 0}
            onChange={(e) =>
              setFormData({
                ...formData,
                proactivityExploreRate: parseInt(e.target.value, 10),
              })
            }
            className="w-full"
          />
        </div>

        {/* 慢脑开关 - Requirement 3.6 */}
        <div className="flex items-center justify-between">
          <label
            htmlFor="slowBrainEnabled"
            className="text-sm font-medium text-slate-700"
          >
            慢脑
          </label>
          <input
            id="slowBrainEnabled"
            type="checkbox"
            checked={formData.slowBrainEnabled ?? false}
            onChange={(e) =>
              setFormData({ ...formData, slowBrainEnabled: e.target.checked })
            }
            className="h-4 w-4 rounded border-slate-300"
          />
        </div>

        {/* 慢脑影子模式开关 - Requirement 3.7 */}
        <div className="flex items-center justify-between">
          <label
            htmlFor="slowBrainShadowEnabled"
            className="text-sm font-medium text-slate-700"
          >
            慢脑影子模式
          </label>
          <input
            id="slowBrainShadowEnabled"
            type="checkbox"
            checked={formData.slowBrainShadowEnabled ?? false}
            onChange={(e) =>
              setFormData({
                ...formData,
                slowBrainShadowEnabled: e.target.checked,
              })
            }
            className="h-4 w-4 rounded border-slate-300"
          />
        </div>

        {/* 影子队列比例滑动条 - Requirement 3.8 */}
        <div className="space-y-2">
          <label
            htmlFor="slowBrainShadowRollout"
            className="text-sm font-medium text-slate-700"
          >
            影子队列比例: {formData.slowBrainShadowRollout ?? 0}%
          </label>
          <input
            id="slowBrainShadowRollout"
            type="range"
            min="0"
            max="100"
            value={formData.slowBrainShadowRollout ?? 0}
            onChange={(e) =>
              setFormData({
                ...formData,
                slowBrainShadowRollout: parseInt(e.target.value, 10),
              })
            }
            className="w-full"
          />
        </div>

        {/* 周期重训开关 - Requirement 3.9 */}
        <div className="flex items-center justify-between">
          <label
            htmlFor="periodicRetrainEnabled"
            className="text-sm font-medium text-slate-700"
          >
            周期重训
          </label>
          <input
            id="periodicRetrainEnabled"
            type="checkbox"
            checked={formData.periodicRetrainEnabled ?? false}
            onChange={(e) =>
              setFormData({
                ...formData,
                periodicRetrainEnabled: e.target.checked,
              })
            }
            className="h-4 w-4 rounded border-slate-300"
          />
        </div>

        {/* 主动触达开关 - Requirement 3.10 */}
        <div className="flex items-center justify-between">
          <label
            htmlFor="proactivePingEnabled"
            className="text-sm font-medium text-slate-700"
          >
            主动触达
          </label>
          <input
            id="proactivePingEnabled"
            type="checkbox"
            checked={formData.proactivePingEnabled ?? false}
            onChange={(e) =>
              setFormData({
                ...formData,
                proactivePingEnabled: e.target.checked,
              })
            }
            className="h-4 w-4 rounded border-slate-300"
          />
        </div>

        {/* 主动触达频率设置 - Requirement 3.11 */}
        <div className="space-y-3 pl-4 border-l-2 border-slate-200">
          <div className="space-y-1">
            <label
              htmlFor="proactivePingMinIntervalMinutes"
              className="text-sm font-medium text-slate-700"
            >
              最小间隔（分钟）
            </label>
            <input
              id="proactivePingMinIntervalMinutes"
              type="number"
              min="1"
              max="1440"
              value={formData.proactivePingMinIntervalMinutes ?? 60}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  proactivePingMinIntervalMinutes: parseInt(e.target.value, 10),
                })
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="proactivePingMaxPerDay"
              className="text-sm font-medium text-slate-700"
            >
              每日最大次数
            </label>
            <input
              id="proactivePingMaxPerDay"
              type="number"
              min="1"
              max="100"
              value={formData.proactivePingMaxPerDay ?? 10}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  proactivePingMaxPerDay: parseInt(e.target.value, 10),
                })
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
        </div>

        {/* 静默时段设置 - Requirement 3.12 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label
              htmlFor="quietHoursEnabled"
              className="text-sm font-medium text-slate-700"
            >
              静默时段
            </label>
            <input
              id="quietHoursEnabled"
              type="checkbox"
              checked={formData.quietHoursEnabled ?? false}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  quietHoursEnabled: e.target.checked,
                })
              }
              className="h-4 w-4 rounded border-slate-300"
            />
          </div>

          <div className="pl-4 border-l-2 border-slate-200 space-y-3">
            <div className="space-y-1">
              <label
                htmlFor="quietHoursStart"
                className="text-sm font-medium text-slate-700"
              >
                起始时间
              </label>
              <input
                id="quietHoursStart"
                type="time"
                value={formData.quietHoursStart ?? '22:00'}
                onChange={(e) =>
                  setFormData({ ...formData, quietHoursStart: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="quietHoursEnd"
                className="text-sm font-medium text-slate-700"
              >
                结束时间
              </label>
              <input
                id="quietHoursEnd"
                type="time"
                value={formData.quietHoursEnd ?? '08:00'}
                onChange={(e) =>
                  setFormData({ ...formData, quietHoursEnd: e.target.value })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="quietHoursTimezoneOffset"
                className="text-sm font-medium text-slate-700"
              >
                时区偏移（小时）
              </label>
              <input
                id="quietHoursTimezoneOffset"
                type="number"
                min="-12"
                max="14"
                value={formData.quietHoursTimezoneOffset ?? 8}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    quietHoursTimezoneOffset: parseInt(e.target.value, 10),
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
          </div>
        </div>

        {/* 保存按钮 - Requirement 3.13 */}
        <div className="pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? '保存中...' : '保存配置'}
          </button>
        </div>
      </div>
    </Card>
  );
});

/**
 * PsychePage - Main page component
 * Requirements: 3.1-3.14
 */
export const PsychePage = React.memo(function PsychePage() {
  const { snapshot, loading } = useGateway();

  const handleSave = useCallback(async (config: PsycheModeConfig) => {
    void config;
    // TODO: Call gateway RPC to save configuration
    // await gatewayClient.request('setPsycheMode', config);
  }, []);

  if (loading && !snapshot) {
    return (
      <div className="p-6">
        <div className="text-center text-slate-500">加载中...</div>
      </div>
    );
  }

  const hub = snapshot?.daemon.psycheSignalHub;
  const guardianSafeHoldReason = snapshot?.nexus.guardianSafeHoldReason;
  const psycheMode = snapshot?.nexus.psycheMode;

  return (
    <div className="p-6 space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">交互感知</h1>
        <p className="text-sm text-slate-600 mt-1">守门员与心理参数配置</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PsycheSignalHubCard
          hub={hub}
          guardianSafeHoldReason={guardianSafeHoldReason}
        />

        {psycheMode && (
          <PsycheModeForm config={psycheMode} onSave={handleSave} />
        )}
      </div>
    </div>
  );
});
