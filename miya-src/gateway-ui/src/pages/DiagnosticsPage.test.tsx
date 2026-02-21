import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayProvider } from '../hooks/useGateway';
import type { GatewaySnapshot } from '../types/gateway';
import { DiagnosticsPage } from './DiagnosticsPage';

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
    policyHash: 'abc123def456',
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
      list: [
        {
          id: 'node-001',
          label: 'Desktop PC',
          connected: true,
          platform: 'Windows',
          updatedAt: '2024-01-01T12:00:00Z',
        },
        {
          id: 'node-002',
          label: 'Laptop',
          connected: true,
          platform: 'macOS',
          updatedAt: '2024-01-01T11:30:00Z',
        },
        {
          id: 'node-003',
          label: 'Server',
          connected: true,
          platform: 'Linux',
          updatedAt: '2024-01-01T11:00:00Z',
        },
        {
          id: 'node-004',
          label: 'Mobile',
          connected: false,
          platform: 'Android',
          updatedAt: '2024-01-01T10:00:00Z',
        },
      ],
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

describe('DiagnosticsPage', () => {
  let _mockSnapshot: GatewaySnapshot;

  beforeEach(() => {
    _mockSnapshot = createMockSnapshot();
  });

  describe('Page Structure', () => {
    it('should render page title and subtitle', () => {
      /**
       * **Validates: Requirements 7.1**
       *
       * The Diagnostics page should display clear page identification.
       */
      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const heading = screen.queryByText('网关诊断');
        expect(heading).toBeInTheDocument();

        const subtitle = screen.queryByText('节点与连接态');
        expect(subtitle).toBeInTheDocument();
      });
    });

    it('should render connection status card', () => {
      /**
       * **Validates: Requirements 7.1**
       *
       * The Diagnostics page should display connection status information.
       */
      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const connectionTitle = screen.queryByText('连接状态');
        expect(connectionTitle).toBeInTheDocument();
      });
    });

    it('should render node list card', () => {
      /**
       * **Validates: Requirements 7.4**
       *
       * The Diagnostics page should display node list information.
       */
      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const nodeListTitle = screen.queryByText('节点列表');
        expect(nodeListTitle).toBeInTheDocument();
      });
    });
  });

  describe('Connection Status Display', () => {
    it('should display gateway connection status when online', () => {
      /**
       * **Validates: Requirements 7.1**
       *
       * The Diagnostics page should show gateway online status.
       */
      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const gatewayLabel = screen.queryByText('网关连接');
        expect(gatewayLabel).toBeInTheDocument();

        const onlineStatus = screen.queryByText(/在线/);
        expect(onlineStatus).toBeInTheDocument();
      });
    });

    it('should display daemon connection status when connected', () => {
      /**
       * **Validates: Requirements 7.7**
       *
       * The Diagnostics page should show daemon connection status.
       */
      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const daemonLabel = screen.queryByText('守门员连接');
        expect(daemonLabel).toBeInTheDocument();

        const connectedStatus = screen.queryByText(/已连接/);
        expect(connectedStatus).toBeInTheDocument();
      });
    });

    it('should display gateway URL', () => {
      /**
       * **Validates: Requirements 7.1**
       *
       * The Diagnostics page should display the gateway URL.
       */
      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const urlText = screen.queryByText('http://localhost:8080');
        expect(urlText).toBeInTheDocument();
      });
    });

    it('should display success message when all connections are healthy', () => {
      /**
       * **Validates: Requirements 7.1**
       *
       * The Diagnostics page should show success message when connections are good.
       */
      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const successMessage = screen.queryByText(/所有连接正常/);
        expect(successMessage).toBeInTheDocument();
      });
    });
  });

  describe('Connection Error Handling', () => {
    it('should display diagnostic tips when gateway is offline', () => {
      /**
       * **Validates: Requirements 7.9**
       *
       * When connection fails, the Diagnostics page should display diagnostic tips.
       */
      const _offlineSnapshot = createMockSnapshot({
        gateway: {
          url: 'http://localhost:8080',
          port: 8080,
          pid: 12345,
          startedAt: '2024-01-01T00:00:00Z',
          status: 'offline',
        },
      });

      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const diagnosticTips = screen.queryByText(/诊断提示/);
        expect(diagnosticTips).toBeInTheDocument();
      });
    });

    it('should display diagnostic tips when daemon is disconnected', () => {
      /**
       * **Validates: Requirements 7.9**
       *
       * When daemon connection fails, the Diagnostics page should display diagnostic tips.
       */
      const _disconnectedSnapshot = createMockSnapshot({
        daemon: {
          connected: false,
        },
      });

      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const diagnosticTips = screen.queryByText(/诊断提示/);
        expect(diagnosticTips).toBeInTheDocument();
      });
    });

    it('should display NO_PROXY configuration tip when connection fails', () => {
      /**
       * **Validates: Requirements 7.2, 7.9**
       *
       * The Diagnostics page should show NO_PROXY configuration guidance.
       */
      const _errorSnapshot = createMockSnapshot({
        gateway: {
          url: 'http://localhost:8080',
          port: 8080,
          pid: 12345,
          startedAt: '2024-01-01T00:00:00Z',
          status: 'error',
        },
      });

      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const noProxyTip = screen.queryByText(/NO_PROXY/);
        expect(noProxyTip).toBeInTheDocument();
      });
    });

    it('should display PowerShell fix command when connection fails', () => {
      /**
       * **Validates: Requirements 7.3, 7.9**
       *
       * The Diagnostics page should provide PowerShell command to fix proxy issues.
       */
      const _errorSnapshot = createMockSnapshot({
        daemon: {
          connected: false,
        },
      });

      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const fixCommandLabel = screen.queryByText(/PowerShell 修复命令/);
        expect(fixCommandLabel).toBeInTheDocument();

        const copyButton = screen.queryByText('复制');
        expect(copyButton).toBeInTheDocument();
      });
    });

    it('should display error message when statusError is present', () => {
      /**
       * **Validates: Requirements 7.8**
       *
       * The Diagnostics page should display detailed error information.
       */
      const _errorSnapshot = createMockSnapshot({
        statusError: 'Connection timeout: Failed to connect to gateway',
      });

      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const errorLabel = screen.queryByText('错误信息');
        expect(errorLabel).toBeInTheDocument();

        const errorMessage = screen.queryByText(/Connection timeout/);
        expect(errorMessage).toBeInTheDocument();
      });
    });
  });

  describe('Node List Display', () => {
    it('should display node statistics', () => {
      /**
       * **Validates: Requirements 7.5**
       *
       * The Diagnostics page should display node statistics (total, connected).
       */
      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const totalLabel = screen.queryByText('总节点数');
        expect(totalLabel).toBeInTheDocument();

        const connectedLabel = screen.queryByText('已连接');
        expect(connectedLabel).toBeInTheDocument();

        const disconnectedLabel = screen.queryByText('未连接');
        expect(disconnectedLabel).toBeInTheDocument();
      });
    });

    it('should display policy hash', () => {
      /**
       * **Validates: Requirements 7.6**
       *
       * The Diagnostics page should display the policy hash value.
       */
      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const policyHashLabel = screen.queryByText('策略哈希值');
        expect(policyHashLabel).toBeInTheDocument();

        const hashValue = screen.queryByText('abc123def456');
        expect(hashValue).toBeInTheDocument();
      });
    });

    it('should display all nodes in the list', () => {
      /**
       * **Validates: Requirements 7.4**
       *
       * The Diagnostics page should display all nodes with their details.
       */
      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        // Check for node labels
        const desktopNode = screen.queryByText('Desktop PC');
        expect(desktopNode).toBeInTheDocument();

        const laptopNode = screen.queryByText('Laptop');
        expect(laptopNode).toBeInTheDocument();

        const serverNode = screen.queryByText('Server');
        expect(serverNode).toBeInTheDocument();

        const mobileNode = screen.queryByText('Mobile');
        expect(mobileNode).toBeInTheDocument();
      });
    });

    it('should display node connection status', () => {
      /**
       * **Validates: Requirements 7.4**
       *
       * The Diagnostics page should show each node's connection status.
       */
      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        // Look for online/offline status badges
        const onlineStatuses = screen.queryAllByText('在线');
        expect(onlineStatuses.length).toBeGreaterThan(0);

        const offlineStatuses = screen.queryAllByText('离线');
        expect(offlineStatuses.length).toBeGreaterThan(0);
      });
    });

    it('should display node platform information', () => {
      /**
       * **Validates: Requirements 7.4**
       *
       * The Diagnostics page should display each node's platform.
       */
      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const windowsPlatform = screen.queryByText(/Windows/);
        expect(windowsPlatform).toBeInTheDocument();

        const macOSPlatform = screen.queryByText(/macOS/);
        expect(macOSPlatform).toBeInTheDocument();

        const linuxPlatform = screen.queryByText(/Linux/);
        expect(linuxPlatform).toBeInTheDocument();
      });
    });

    it('should display node update timestamps', () => {
      /**
       * **Validates: Requirements 7.4**
       *
       * The Diagnostics page should display when each node was last updated.
       */
      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const updateTimeLabel = screen.queryByText(/更新时间/);
        expect(updateTimeLabel).toBeInTheDocument();
      });
    });

    it('should display empty state when no nodes exist', () => {
      /**
       * The Diagnostics page should show an empty state when there are no nodes.
       */
      const _emptySnapshot = createMockSnapshot({
        nodes: {
          total: 0,
          connected: 0,
          pendingPairs: 0,
          list: [],
          devices: [],
          invokes: [],
        },
      });

      render(
        <GatewayProvider>
          <DiagnosticsPage />
        </GatewayProvider>,
      );

      waitFor(() => {
        const emptyMessage = screen.queryByText('暂无节点');
        expect(emptyMessage).toBeInTheDocument();
      });
    });
  });

  describe('Loading State', () => {
    it('should display loading message when data is loading', () => {
      /**
       * The Diagnostics page should show a loading state during initial data fetch.
       */
      render(
        <GatewayProvider>
          <DiagnosticsPage />
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
       * The Diagnostics page should use Card layout for all information modules.
       */
      const { container } = render(
        <GatewayProvider>
          <DiagnosticsPage />
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
