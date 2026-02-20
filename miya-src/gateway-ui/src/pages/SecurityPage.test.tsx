import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SecurityPage } from './SecurityPage';
import * as useGatewayModule from '../hooks/useGateway';
import type { GatewaySnapshot } from '../types/gateway';

vi.mock('../hooks/useGateway', () => ({
  useGateway: vi.fn(),
}));

const mockSetKillSwitch = vi.fn().mockResolvedValue(undefined);
const mockUpdateTrustMode = vi.fn().mockResolvedValue(undefined);
const mockTogglePolicyDomain = vi.fn().mockResolvedValue(undefined);

function createSnapshot(overrides?: Partial<GatewaySnapshot>): GatewaySnapshot {
  const base: GatewaySnapshot = {
    updatedAt: '2024-01-01T00:00:00Z',
    gateway: {
      url: 'http://localhost:8080',
      port: 8080,
      pid: 12345,
      startedAt: '2024-01-01T00:00:00Z',
      status: 'online',
    },
    runtime: {
      isOwner: true,
      ownerFresh: true,
      storageRevision: 1,
    },
    daemon: {
      connected: true,
    },
    policyHash: 'policy-hash',
    configCenter: {
      policyDomains: [],
    },
    killSwitch: { active: false },
    nexus: {
      sessionId: 'session-1',
      activeTool: 'test-tool',
      permission: 'admin',
      pendingTickets: 2,
      killSwitchMode: 'off',
      insights: [],
      trustMode: {
        silentMin: 70,
        modalMax: 30,
      },
      psycheMode: {
        resonanceEnabled: true,
        captureProbeEnabled: false,
      },
      learningGate: {
        candidateMode: 'toast_gate',
        persistentRequiresApproval: true,
      },
    },
    safety: { recentSelfApproval: [] },
    jobs: { total: 0, enabled: 0, pendingApprovals: 0, recentRuns: [] },
    loop: {},
    autoflow: {
      active: 0,
      sessions: [],
      persistent: {
        enabled: false,
        resumeCooldownMs: 1000,
        maxAutoResumes: 2,
        maxConsecutiveResumeFailures: 2,
        resumeTimeoutMs: 30000,
        sessions: [],
      },
    },
    routing: {
      ecoMode: false,
      cost: {},
      recent: [],
    },
    learning: {
      stats: {},
      topDrafts: [],
    },
    background: {
      total: 0,
      running: 0,
      tasks: [],
    },
    sessions: {
      total: 0,
      active: 0,
      queued: 0,
      muted: 0,
      items: [],
    },
    channels: {
      states: [],
      pendingPairs: [],
      recentOutbound: [
        {
          id: 'run-1',
          timestamp: '2024-01-01T10:00:00Z',
          channel: 'email',
          target: 'user@example.com',
          sendStatus: 'success',
          evidenceConfidence: 95,
          preScreenshot: '/tmp/pre.png',
          postScreenshot: '/tmp/post.png',
        },
      ],
    },
    nodes: {
      total: 0,
      connected: 0,
      pendingPairs: 0,
      list: [],
      devices: [],
      invokes: [],
    },
    skills: {
      enabled: [],
      discovered: [],
    },
    media: {
      total: 0,
      recent: [],
    },
    voice: {},
    canvas: {
      docs: [],
      events: [],
    },
    companion: {},
    security: {
      ownerIdentity: {},
    },
    doctor: {
      issues: [],
    },
  };

  return {
    ...base,
    ...overrides,
    nexus: {
      ...base.nexus,
      ...(overrides?.nexus ?? {}),
    },
    channels: {
      ...base.channels,
      ...(overrides?.channels ?? {}),
    },
    configCenter: {
      ...base.configCenter,
      ...(overrides?.configCenter ?? {}),
    },
  };
}

describe('SecurityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

    vi.mocked(useGatewayModule.useGateway).mockReturnValue({
      snapshot: createSnapshot(),
      loading: false,
      connected: true,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
      setKillSwitch: mockSetKillSwitch,
      updatePsycheMode: vi.fn().mockResolvedValue(undefined),
      updateTrustMode: mockUpdateTrustMode,
      togglePolicyDomain: mockTogglePolicyDomain,
    });
  });

  it('renders core security cards and session data', () => {
    render(<SecurityPage />);

    expect(screen.getByText('安全与风控')).toBeInTheDocument();
    expect(screen.getByText('Kill-Switch 状态')).toBeInTheDocument();
    expect(screen.getByText('策略域状态')).toBeInTheDocument();
    expect(screen.getByText('信任模式配置')).toBeInTheDocument();
    expect(screen.getByText('会话权限')).toBeInTheDocument();
    expect(screen.getByText('test-tool')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('renders evidence pack details when outbound records exist', () => {
    render(<SecurityPage />);

    expect(screen.getByText('最近执行序列')).toBeInTheDocument();
    expect(screen.getByText(/email → user@example\.com/i)).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText(/置信度: 95%/i)).toBeInTheDocument();
    expect(screen.getByText('查看前置截图')).toBeInTheDocument();
    expect(screen.getByText('查看后置截图')).toBeInTheDocument();
  });

  it('calls setKillSwitch when choosing all_stop and user confirms', async () => {
    render(<SecurityPage />);

    fireEvent.click(screen.getByRole('button', { name: /全部停止/i }));

    await waitFor(() => {
      expect(globalThis.confirm).toHaveBeenCalledTimes(1);
      expect(mockSetKillSwitch).toHaveBeenCalledWith('all_stop');
    });
  });

  it('does not call setKillSwitch when all_stop confirmation is rejected', async () => {
    vi.mocked(globalThis.confirm).mockReturnValue(false);

    render(<SecurityPage />);
    fireEvent.click(screen.getByRole('button', { name: /全部停止/i }));

    await waitFor(() => {
      expect(globalThis.confirm).toHaveBeenCalledTimes(1);
      expect(mockSetKillSwitch).not.toHaveBeenCalled();
    });
  });

  it('calls updateTrustMode when saving trust config', async () => {
    render(<SecurityPage />);

    fireEvent.change(screen.getByLabelText(/静默最小分/i), {
      target: { value: '66' },
    });
    fireEvent.change(screen.getByLabelText(/模态最大分/i), {
      target: { value: '44' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(mockUpdateTrustMode).toHaveBeenCalledWith({
        silentMin: 66,
        modalMax: 44,
      });
    });
  });

  it('calls togglePolicyDomain using configCenter policyDomains', async () => {
    vi.mocked(useGatewayModule.useGateway).mockReturnValue({
      snapshot: createSnapshot({
        configCenter: {
          policyDomains: [
            {
              domain: 'desktop_control',
              label: '桌面控制',
              paused: false,
            },
          ],
        },
      }),
      loading: false,
      connected: true,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
      setKillSwitch: mockSetKillSwitch,
      updatePsycheMode: vi.fn().mockResolvedValue(undefined),
      updateTrustMode: mockUpdateTrustMode,
      togglePolicyDomain: mockTogglePolicyDomain,
    });

    render(<SecurityPage />);

    fireEvent.click(screen.getByRole('button', { name: '运行中' }));

    await waitFor(() => {
      expect(mockTogglePolicyDomain).toHaveBeenCalledWith('desktop_control', true);
    });
  });

  it('shows loading state when snapshot is unavailable', () => {
    vi.mocked(useGatewayModule.useGateway).mockReturnValue({
      snapshot: null,
      loading: true,
      connected: false,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
      setKillSwitch: mockSetKillSwitch,
      updatePsycheMode: vi.fn().mockResolvedValue(undefined),
      updateTrustMode: mockUpdateTrustMode,
      togglePolicyDomain: mockTogglePolicyDomain,
    });

    render(<SecurityPage />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });
});
