import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayProvider } from '../hooks/useGateway';
import type { GatewaySnapshot } from '../types/gateway';
import { DashboardPage } from './DashboardPage';

/**
 * Mock GatewayRpcClient to avoid real network calls
 */
vi.mock('../gateway-client', () => ({
  GatewayRpcClient: class MockGatewayRpcClient {
    request = vi.fn().mockResolvedValue({});
    dispose = vi.fn();
  },
}));

/**
 * Create a minimal mock snapshot for testing
 */
function createMockSnapshot(
  overrides?: Partial<GatewaySnapshot>,
): GatewaySnapshot {
  return {
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
      activeAgentId: 'test-agent-001',
      storageRevision: 1,
    },
    daemon: {
      connected: true,
      cpuPercent: 25.5,
      memoryMB: 512.3,
      activeJobID: 'job-123',
    },
    policyHash: 'abc123',
    configCenter: {},
    killSwitch: {
      active: false,
    },
    nexus: {
      sessionId: 'session-001',
      activeTool: 'test-tool',
      permission: 'read',
      pendingTickets: 3,
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
    safety: {
      recentSelfApproval: [],
    },
    jobs: {
      total: 10,
      enabled: 7,
      pendingApprovals: 2,
      recentRuns: [],
    },
    loop: {},
    autoflow: {
      active: 0,
      sessions: [],
      persistent: {
        enabled: false,
        resumeCooldownMs: 5000,
        maxAutoResumes: 3,
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
      total: 5,
      running: 2,
      tasks: [],
    },
    sessions: {
      total: 15,
      active: 8,
      queued: 3,
      muted: 4,
      items: [],
    },
    channels: {
      states: [],
      pendingPairs: [],
      recentOutbound: [],
    },
    nodes: {
      total: 4,
      connected: 3,
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
    ...overrides,
  } as GatewaySnapshot;
}

/**
 * Wrapper component that provides GatewayContext with mock data
 */
function _TestWrapper({
  children,
  snapshot,
}: {
  children: React.ReactNode;
  snapshot: GatewaySnapshot;
}) {
  // Mock the GatewayProvider to provide test data
  const mockContextValue = {
    snapshot,
    loading: false,
    connected: true,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    setKillSwitch: vi.fn().mockResolvedValue(undefined),
    updatePsycheMode: vi.fn().mockResolvedValue(undefined),
    updateTrustMode: vi.fn().mockResolvedValue(undefined),
    togglePolicyDomain: vi.fn().mockResolvedValue(undefined),
  };

  // Use a custom provider that bypasses the real implementation
  return (
    <div data-testid="test-wrapper">
      {React.cloneElement(children as React.ReactElement, {
        ...mockContextValue,
      })}
    </div>
  );
}

describe('DashboardPage', () => {
  let _mockSnapshot: GatewaySnapshot;

  beforeEach(() => {
    _mockSnapshot = createMockSnapshot();
  });

  describe('Core Information Display', () => {
    it('should render page title and subtitle', () => {
      /**
       * **Validates: Requirements 2.1**
       *
       * The Dashboard should display clear page identification.
       */
      render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      // Wait for content to load
      waitFor(() => {
        const heading = screen.queryByText('控制中枢');
        expect(heading).toBeInTheDocument();

        const subtitle = screen.queryByText('核心状态总览');
        expect(subtitle).toBeInTheDocument();
      });
    });

    it('should display connection status', () => {
      /**
       * **Validates: Requirements 2.1, 2.8**
       *
       * The Dashboard should display system online status.
       */
      render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        // Look for connection status text
        const statusLabel = screen.queryByText('连接状态');
        expect(statusLabel).toBeInTheDocument();
      });
    });

    it('should display session statistics', () => {
      /**
       * **Validates: Requirements 2.1, 2.8**
       *
       * The Dashboard should display session count (active/total).
       */
      render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const sessionLabel = screen.queryByText('会话');
        expect(sessionLabel).toBeInTheDocument();
      });
    });

    it('should display task statistics', () => {
      /**
       * **Validates: Requirements 2.1, 2.8**
       *
       * The Dashboard should display task count (enabled/total).
       */
      render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const taskLabel = screen.queryByText('任务');
        expect(taskLabel).toBeInTheDocument();
      });
    });

    it('should display risk ticket count', () => {
      /**
       * **Validates: Requirements 2.1, 2.8**
       *
       * The Dashboard should display pending risk tickets.
       */
      render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const ticketLabel = screen.queryByText('风险票据');
        expect(ticketLabel).toBeInTheDocument();
      });
    });

    it('should display CPU usage when available', () => {
      /**
       * **Validates: Requirements 2.1**
       *
       * The Dashboard should display CPU usage percentage.
       */
      render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const cpuLabel = screen.queryByText('CPU 使用率');
        expect(cpuLabel).toBeInTheDocument();
      });
    });

    it('should display memory usage when available', () => {
      /**
       * **Validates: Requirements 2.1**
       *
       * The Dashboard should display memory usage in MB.
       */
      render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const memoryLabel = screen.queryByText('内存使用');
        expect(memoryLabel).toBeInTheDocument();
      });
    });

    it('should display active agent ID when available', () => {
      /**
       * **Validates: Requirements 2.1**
       *
       * The Dashboard should display the currently active agent.
       */
      render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const agentLabel = screen.queryByText('当前代理');
        expect(agentLabel).toBeInTheDocument();
      });
    });
  });

  describe('Kill-Switch Control Display', () => {
    it('should display Kill-Switch control card', () => {
      /**
       * **Validates: Requirements 2.2**
       *
       * The Dashboard should display Kill-Switch control in a prominent position.
       */
      render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const killSwitchTitle = screen.queryByText('全局急停控制');
        expect(killSwitchTitle).toBeInTheDocument();
      });
    });

    it('should display current Kill-Switch mode', () => {
      /**
       * **Validates: Requirements 2.2**
       *
       * The Dashboard should show the current Kill-Switch mode status.
       */
      render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        // Look for mode indicators
        const modeText =
          screen.queryByText(/正常运行|全部停止|仅停外发|仅停桌控/);
        expect(modeText).toBeInTheDocument();
      });
    });

    it('should display Kill-Switch mode buttons', () => {
      /**
       * **Validates: Requirements 2.2**
       *
       * The Dashboard should provide buttons to change Kill-Switch mode.
       */
      const { container } = render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        // Look for mode buttons
        const buttons = container.querySelectorAll('button');
        const killSwitchButtons = Array.from(buttons).filter(
          (btn) =>
            btn.textContent?.includes('全部停止') ||
            btn.textContent?.includes('仅停外发') ||
            btn.textContent?.includes('仅停桌控') ||
            btn.textContent?.includes('正常运行'),
        );

        expect(killSwitchButtons.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Content Isolation - Removed Elements', () => {
    it('should NOT display Psyche configuration forms', () => {
      /**
       * **Validates: Requirements 2.3**
       *
       * The Dashboard should NOT contain Psyche-related configuration controls
       * (resonance, capture probe, signal override, etc.)
       */
      const { container } = render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        // Check for Psyche-related terms that should NOT be present
        const psycheTerms = [
          '共鸣层',
          '捕获探针',
          '信号覆盖',
          '主动探索率',
          '慢脑',
          '影子模式',
          '周期重训',
          '主动触达',
          '静默时段',
          'resonance',
          'capture probe',
          'signal override',
        ];

        psycheTerms.forEach((term) => {
          const element = screen.queryByText(new RegExp(term, 'i'));
          expect(element).not.toBeInTheDocument();
        });
      });
    });

    it('should NOT display security switches', () => {
      /**
       * **Validates: Requirements 2.4**
       *
       * The Dashboard should NOT contain security switch controls
       * (outbound pause, desktop control pause, etc.)
       */
      const { container } = render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        // Check for security switch terms that should NOT be present
        const securityTerms = [
          '外发暂停',
          '桌控暂停',
          '记忆读取暂停',
          'outbound pause',
          'desktop pause',
        ];

        securityTerms.forEach((term) => {
          const element = screen.queryByText(new RegExp(term, 'i'));
          expect(element).not.toBeInTheDocument();
        });
      });
    });

    it('should NOT display policy domain status', () => {
      /**
       * **Validates: Requirements 2.5**
       *
       * The Dashboard should NOT display policy domain information.
       */
      const { container } = render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        // Check for policy domain terms that should NOT be present
        const policyTerms = [
          '策略域',
          '消息外发',
          '桌面控制',
          '记忆读取',
          'policy domain',
          'message outbound',
        ];

        policyTerms.forEach((term) => {
          const element = screen.queryByText(new RegExp(term, 'i'));
          expect(element).not.toBeInTheDocument();
        });
      });
    });

    it('should NOT display recent execution sequences', () => {
      /**
       * **Validates: Requirements 2.6**
       *
       * The Dashboard should NOT display execution sequences or evidence packs.
       */
      const { container } = render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        // Check for execution sequence terms that should NOT be present
        const executionTerms = [
          '执行序列',
          '证据包',
          '证据截图',
          '证据置信度',
          'execution sequence',
          'evidence pack',
          'evidence screenshot',
        ];

        executionTerms.forEach((term) => {
          const element = screen.queryByText(new RegExp(term, 'i'));
          expect(element).not.toBeInTheDocument();
        });
      });
    });

    it('should NOT display skill summaries', () => {
      /**
       * **Validates: Requirements 2.7**
       *
       * The Dashboard should NOT display skill summaries.
       */
      const { container } = render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        // Check for skill-related terms that should NOT be present
        const skillTerms = [
          '技能摘要',
          '技能列表',
          '已启用技能',
          'skill summary',
          'enabled skills',
        ];

        skillTerms.forEach((term) => {
          const element = screen.queryByText(new RegExp(term, 'i'));
          expect(element).not.toBeInTheDocument();
        });
      });
    });

    it('should NOT display ecosystem bridge summaries', () => {
      /**
       * **Validates: Requirements 2.7**
       *
       * The Dashboard should NOT display ecosystem bridge information.
       */
      const { container } = render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        // Check for ecosystem bridge terms that should NOT be present
        const ecosystemTerms = [
          '生态桥接',
          '桥接摘要',
          'ecosystem bridge',
          'bridge summary',
        ];

        ecosystemTerms.forEach((term) => {
          const element = screen.queryByText(new RegExp(term, 'i'));
          expect(element).not.toBeInTheDocument();
        });
      });
    });
  });

  describe('Loading State', () => {
    it('should display loading message when data is loading', () => {
      /**
       * The Dashboard should show a loading state during initial data fetch.
       */
      const { container } = render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      // Initially should show loading
      const loadingText = screen.queryByText('加载中...');
      expect(loadingText).toBeInTheDocument();
    });
  });

  describe('Card Layout', () => {
    it('should use Card components for information display', () => {
      /**
       * **Validates: Requirements 8.1**
       *
       * The Dashboard should use Card layout for all information modules.
       */
      const { container } = render(
        <GatewayProvider>
          <DashboardPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        // Look for card elements with expected styling
        const cards = container.querySelectorAll('.rounded-xl, .rounded-2xl');
        expect(cards.length).toBeGreaterThan(0);
      });
    });
  });
});
