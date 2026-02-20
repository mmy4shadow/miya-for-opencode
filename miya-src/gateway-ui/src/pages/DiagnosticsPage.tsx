/**
 * Diagnostics Page - 网关诊断
 * 
 * Displays gateway connection status, node list, and diagnostic information.
 * Follows requirements 7.1-7.9 - network diagnostics and troubleshooting.
 * 
 * Performance optimizations:
 * - Uses React.memo to prevent unnecessary re-renders
 * - Uses useMemoizedSnapshot for efficient data access
 * - Uses useStableCallback for stable event handlers
 */

import React, { useMemo } from 'react';
import { useGateway } from '../hooks/useGateway';
import { useMemoizedSnapshot } from '../hooks/useMemoizedSnapshot';
import { Card } from '../components/Card';

/**
 * ConnectionStatusCard Component
 * Displays gateway and daemon connection status with diagnostic tips
 * Requirements 7.1, 7.2, 7.3, 7.7, 7.8, 7.9
 */
interface ConnectionStatusCardProps {
  gateway: {
    url: string;
    status: 'online' | 'offline' | 'error';
  };
  daemon: {
    connected: boolean;
  };
  statusError?: string;
}

const ConnectionStatusCard = React.memo<ConnectionStatusCardProps>(function ConnectionStatusCard({
  gateway,
  daemon,
  statusError,
}) {
  const isConnected = gateway.status === 'online' && daemon.connected;
  const hasError = gateway.status === 'error' || statusError;

  // PowerShell command to fix NO_PROXY issue
  const fixCommand = `$env:NO_PROXY = "localhost,127.0.0.1"; [System.Environment]::SetEnvironmentVariable('NO_PROXY', 'localhost,127.0.0.1', 'User')`;

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(fixCommand).then(() => {
      alert('已复制修复命令到剪贴板');
    }).catch((err) => {
      console.error('Failed to copy command:', err);
      alert('复制失败，请手动复制');
    });
  };

  return (
    <Card title="连接状态" subtitle="网关与守门员连接">
      <div className="space-y-4">
        {/* Gateway Connection */}
        <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
          <div>
            <div className="font-medium">网关连接</div>
            <div className="text-sm text-gray-600">{gateway.url}</div>
          </div>
          <div className={`font-bold ${
            gateway.status === 'online' ? 'text-green-600' :
            gateway.status === 'error' ? 'text-red-600' :
            'text-gray-600'
          }`}>
            {gateway.status === 'online' ? '✅ 在线' :
             gateway.status === 'error' ? '❌ 错误' :
             '⚪ 离线'}
          </div>
        </div>

        {/* Daemon Connection */}
        <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
          <div>
            <div className="font-medium">守门员连接</div>
            <div className="text-sm text-gray-600">daemon.connected</div>
          </div>
          <div className={`font-bold ${daemon.connected ? 'text-green-600' : 'text-red-600'}`}>
            {daemon.connected ? '✅ 已连接' : '❌ 未连接'}
          </div>
        </div>

        {/* Error Message */}
        {statusError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="font-medium text-red-800">错误信息</div>
            <div className="text-sm text-red-700 mt-1">{statusError}</div>
          </div>
        )}

        {/* Diagnostic Tips - Show when connection fails */}
        {!isConnected && (
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="font-medium text-yellow-800 mb-2">🔧 诊断提示</div>
            <div className="text-sm text-yellow-700 space-y-2">
              <p>连接失败可能是由于代理配置问题。请尝试以下修复方案：</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>检查网关服务是否正在运行</li>
                <li>确认 NO_PROXY 环境变量包含 localhost</li>
                <li>运行下方的 PowerShell 命令修复代理配置</li>
              </ol>
            </div>
            
            {/* PowerShell Fix Command */}
            <div className="mt-3">
              <div className="text-sm font-medium text-yellow-800 mb-1">PowerShell 修复命令：</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-gray-900 text-green-400 text-xs rounded overflow-x-auto">
                  {fixCommand}
                </code>
                <button
                  onClick={handleCopyCommand}
                  className="px-3 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition-colors text-sm font-medium"
                >
                  复制
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Success Message */}
        {isConnected && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-sm text-green-700">
              ✅ 所有连接正常，系统运行良好
            </div>
          </div>
        )}
      </div>
    </Card>
  );
});

/**
 * NodeListCard Component
 * Displays all nodes with their connection status and metadata
 * Requirements 7.4, 7.5, 7.6
 */
interface NodeListCardProps {
  nodes: {
    total: number;
    connected: number;
    list: Array<{
      id: string;
      label: string;
      connected: boolean;
      platform: string;
      updatedAt: string;
    }>;
  };
  policyHash: string;
}

const NodeListCard = React.memo<NodeListCardProps>(function NodeListCard({
  nodes,
  policyHash,
}) {
  // Format timestamp for display
  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return timestamp;
    }
  };

  return (
    <Card title="节点列表" subtitle="所有连接的设备节点">
      <div className="space-y-4">
        {/* Node Statistics */}
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-gray-900">{nodes.total}</div>
            <div className="text-sm text-gray-600">总节点数</div>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <div className="text-2xl font-bold text-green-600">{nodes.connected}</div>
            <div className="text-sm text-gray-600">已连接</div>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-gray-600">{nodes.total - nodes.connected}</div>
            <div className="text-sm text-gray-600">未连接</div>
          </div>
        </div>

        {/* Policy Hash */}
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="text-sm font-medium text-blue-800">策略哈希值</div>
          <code className="text-xs text-blue-700 break-all">{policyHash || '未设置'}</code>
        </div>

        {/* Node List */}
        {nodes.list.length > 0 ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-700">节点详情</div>
            <div className="space-y-2">
              {nodes.list.map((node) => (
                <div
                  key={node.id}
                  className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-lg ${node.connected ? 'text-green-600' : 'text-gray-400'}`}>
                          {node.connected ? '🟢' : '⚪'}
                        </span>
                        <span className="font-medium">{node.label || node.id}</span>
                      </div>
                      <div className="mt-1 space-y-1 text-sm text-gray-600">
                        <div>ID: <code className="text-xs bg-gray-100 px-1 rounded">{node.id}</code></div>
                        <div>平台: {node.platform}</div>
                        <div>更新时间: {formatTimestamp(node.updatedAt)}</div>
                      </div>
                    </div>
                    <div className={`px-2 py-1 rounded text-xs font-medium ${
                      node.connected 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {node.connected ? '在线' : '离线'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <div className="text-4xl mb-2">📡</div>
            <div>暂无节点</div>
          </div>
        )}
      </div>
    </Card>
  );
});

/**
 * DiagnosticsPage Component
 * Main diagnostics page displaying connection status and node information
 * Requirements 7.1, 7.4
 */
export const DiagnosticsPage = React.memo(function DiagnosticsPage() {
  const { snapshot, loading } = useGateway();
  const memoizedSnapshot = useMemoizedSnapshot(snapshot);

  // Show loading state on initial load
  if (loading || !memoizedSnapshot) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">网关诊断</h1>
          <p className="text-gray-600 mt-1">节点与连接态</p>
        </div>
        <div className="text-center py-12 text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">网关诊断</h1>
        <p className="text-gray-600 mt-1">节点与连接态</p>
      </div>

      {/* Connection Status */}
      <ConnectionStatusCard
        gateway={memoizedSnapshot.gateway}
        daemon={memoizedSnapshot.daemon}
        statusError={memoizedSnapshot.statusError}
      />

      {/* Node List */}
      <NodeListCard
        nodes={memoizedSnapshot.nodes}
        policyHash={memoizedSnapshot.policyHash}
      />
    </div>
  );
});
