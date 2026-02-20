/**
 * Unit tests for GatewayProvider and useGateway hook
 * 
 * Tests state initialization, refresh method, and error handling
 * Requirements: 13.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { GatewayProvider, useGateway } from './useGateway';
import type { GatewaySnapshot } from '../types/gateway';

// Create a mock request function that can be controlled per test
let mockRequest = vi.fn();
let mockDispose = vi.fn();

// Mock the GatewayRpcClient
vi.mock('../gateway-client', () => {
  return {
    GatewayRpcClient: vi.fn(function(this: any) {
      this.request = (...args: unknown[]) => mockRequest(...args);
      this.dispose = () => mockDispose();
    }),
  };
});

// Mock useMemoizedSnapshot to return the snapshot as-is for testing
vi.mock('./useMemoizedSnapshot', () => ({
  useMemoizedSnapshot: (snapshot: GatewaySnapshot | null) => snapshot,
}));

const createMockSnapshot = (overrides?: Partial<GatewaySnapshot>): GatewaySnapshot => ({
  updatedAt: '2025-01-21T00:00:00Z',
  gateway: {
    url: 'http://localhost:3000',
    port: 3000,
    pid: 12345,
    startedAt: '2025-01-21T00:00:00Z',
    status: 'online',
  },
  runtime: {
    isOwner: true,
    ownerFresh: true,
    storageRevision: 1,
  },
  daemon: { 
    connected: true,
    cpuPercent: 25,
    memoryMB: 512,
  },
  policyHash: 'test-hash',
  configCenter: {},
  killSwitch: { active: false },
  nexus: {
    sessionId: 'test-session',
    killSwitchMode: 'off',
    pendingTickets: 0,
    insights: [],
    trustMode: { silentMin: 70, modalMax: 30 },
    psycheMode: { resonanceEnabled: true, captureProbeEnabled: true },
    learningGate: { candidateMode: 'toast_gate', persistentRequiresApproval: true },
  },
  safety: { recentSelfApproval: [] },
  jobs: { total: 0, enabled: 0, pendingApprovals: 0, recentRuns: [] },
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
  routing: { ecoMode: false, cost: {}, recent: [] },
  learning: { stats: {}, topDrafts: [] },
  background: { total: 0, running: 0, tasks: [] },
  sessions: { total: 0, active: 0, queued: 0, muted: 0, items: [] },
  channels: { states: [], pendingPairs: [], recentOutbound: [] },
  nodes: { total: 0, connected: 0, pendingPairs: 0, list: [], devices: [], invokes: [] },
  skills: { enabled: [], discovered: [] },
  media: { total: 0, recent: [] },
  voice: {},
  canvas: { docs: [], events: [] },
  companion: {},
  security: { ownerIdentity: {} },
  doctor: { issues: [] },
  ...overrides,
});

describe('GatewayProvider - State Initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest = vi.fn().mockResolvedValue(createMockSnapshot());
    mockDispose = vi.fn();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('should throw error when useGateway is used outside provider', () => {
    const TestComponent = () => {
      useGateway();
      return <div>Test</div>;
    };

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useGateway must be used within GatewayProvider');

    consoleError.mockRestore();
  });

  it('should initialize with loading state', () => {
    const TestComponent = () => {
      const { loading, snapshot, connected, error } = useGateway();
      return (
        <div>
          <div data-testid="loading">{loading ? 'true' : 'false'}</div>
          <div data-testid="snapshot">{snapshot ? 'exists' : 'null'}</div>
          <div data-testid="connected">{connected ? 'true' : 'false'}</div>
          <div data-testid="error">{error || 'null'}</div>
        </div>
      );
    };

    render(
      <GatewayProvider pollingInterval={999999}>
        <TestComponent />
      </GatewayProvider>
    );

    expect(screen.getByTestId('loading').textContent).toBe('true');
    expect(screen.getByTestId('snapshot').textContent).toBe('null');
    expect(screen.getByTestId('connected').textContent).toBe('false');
    expect(screen.getByTestId('error').textContent).toBe('null');
  });

  it('should load snapshot on mount and update state', async () => {
    const mockSnapshot = createMockSnapshot();
    mockRequest.mockResolvedValue(mockSnapshot);

    const TestComponent = () => {
      const { loading, snapshot, connected } = useGateway();
      return (
        <div>
          <div data-testid="loading">{loading ? 'true' : 'false'}</div>
          <div data-testid="connected">{connected ? 'true' : 'false'}</div>
          <div data-testid="session-id">{snapshot?.nexus.sessionId || 'none'}</div>
        </div>
      );
    };

    render(
      <GatewayProvider pollingInterval={999999}>
        <TestComponent />
      </GatewayProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('connected').textContent).toBe('true');
    expect(screen.getByTestId('session-id').textContent).toBe('test-session');
    expect(mockRequest).toHaveBeenCalledWith('getSnapshot', {});
  });

  it('should provide all required context methods', () => {
    const TestComponent = () => {
      const context = useGateway();
      return (
        <div>
          <div data-testid="has-refresh">{typeof context.refresh === 'function' ? 'true' : 'false'}</div>
          <div data-testid="has-setKillSwitch">{typeof context.setKillSwitch === 'function' ? 'true' : 'false'}</div>
          <div data-testid="has-updatePsycheMode">{typeof context.updatePsycheMode === 'function' ? 'true' : 'false'}</div>
          <div data-testid="has-updateTrustMode">{typeof context.updateTrustMode === 'function' ? 'true' : 'false'}</div>
          <div data-testid="has-togglePolicyDomain">{typeof context.togglePolicyDomain === 'function' ? 'true' : 'false'}</div>
        </div>
      );
    };

    render(
      <GatewayProvider pollingInterval={999999}>
        <TestComponent />
      </GatewayProvider>
    );

    expect(screen.getByTestId('has-refresh').textContent).toBe('true');
    expect(screen.getByTestId('has-setKillSwitch').textContent).toBe('true');
    expect(screen.getByTestId('has-updatePsycheMode').textContent).toBe('true');
    expect(screen.getByTestId('has-updateTrustMode').textContent).toBe('true');
    expect(screen.getByTestId('has-togglePolicyDomain').textContent).toBe('true');
  });

  it('should accept custom wsPath and tokenProvider props', async () => {
    const customTokenProvider = vi.fn(() => 'custom-token');
    mockRequest.mockResolvedValue(createMockSnapshot());

    const TestComponent = () => {
      const { connected } = useGateway();
      return <div data-testid="connected">{connected ? 'true' : 'false'}</div>;
    };

    render(
      <GatewayProvider 
        wsPath="/custom/ws" 
        tokenProvider={customTokenProvider}
        pollingInterval={999999}
      >
        <TestComponent />
      </GatewayProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('connected').textContent).toBe('true');
    });
  });
});

describe('GatewayProvider - Refresh Method', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockReset().mockResolvedValue(createMockSnapshot());
    mockDispose = vi.fn();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('should provide refresh method that fetches new snapshot', async () => {
    let callCount = 0;
    mockRequest.mockImplementation(() => {
      callCount++;
      return Promise.resolve(createMockSnapshot({ 
        nexus: { 
          ...createMockSnapshot().nexus, 
          sessionId: `session-${callCount}` 
        } 
      }));
    });

    const TestComponent = () => {
      const { snapshot, refresh } = useGateway();
      return (
        <div>
          <div data-testid="session-id">{snapshot?.nexus.sessionId || 'none'}</div>
          <button onClick={() => refresh()} data-testid="refresh-btn">Refresh</button>
        </div>
      );
    };

    render(
      <GatewayProvider pollingInterval={999999}>
        <TestComponent />
      </GatewayProvider>
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByTestId('session-id').textContent).toBe('session-1');
    });

    const initialCallCount = mockRequest.mock.calls.length;

    // Trigger manual refresh
    await act(async () => {
      screen.getByTestId('refresh-btn').click();
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    // Should have called request at least one more time after refresh
    expect(mockRequest.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it('should update connected state after successful refresh', async () => {
    mockRequest.mockResolvedValue(createMockSnapshot({ daemon: { connected: true } }));

    const TestComponent = () => {
      const { connected, refresh } = useGateway();
      return (
        <div>
          <div data-testid="connected">{connected ? 'true' : 'false'}</div>
          <button onClick={() => refresh()} data-testid="refresh-btn">Refresh</button>
        </div>
      );
    };

    render(
      <GatewayProvider pollingInterval={999999}>
        <TestComponent />
      </GatewayProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('connected').textContent).toBe('true');
    });

    await act(async () => {
      screen.getByTestId('refresh-btn').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('connected').textContent).toBe('true');
    });
  });

  it('should clear error state after successful refresh', async () => {
    let firstCall = true;
    mockRequest.mockImplementation(() => {
      if (firstCall) {
        firstCall = false;
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve(createMockSnapshot());
    });

    const TestComponent = () => {
      const { error, refresh } = useGateway();
      return (
        <div>
          <div data-testid="error">{error || 'null'}</div>
          <button onClick={() => refresh()} data-testid="refresh-btn">Refresh</button>
        </div>
      );
    };

    render(
      <GatewayProvider pollingInterval={999999}>
        <TestComponent />
      </GatewayProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Network error');
    });

    await act(async () => {
      screen.getByTestId('refresh-btn').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('null');
    });
  });
});

describe('GatewayProvider - Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockReset();
    mockDispose = vi.fn();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('should handle network errors and set error state', async () => {
    mockRequest.mockRejectedValue(new Error('Connection failed'));

    const TestComponent = () => {
      const { loading, error, connected } = useGateway();
      return (
        <div>
          <div data-testid="loading">{loading ? 'true' : 'false'}</div>
          <div data-testid="error">{error || 'null'}</div>
          <div data-testid="connected">{connected ? 'true' : 'false'}</div>
        </div>
      );
    };

    render(
      <GatewayProvider pollingInterval={999999}>
        <TestComponent />
      </GatewayProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('error').textContent).toBe('Connection failed');
    expect(screen.getByTestId('connected').textContent).toBe('false');
  });

  it('should preserve previous snapshot on error (Requirement 12.5)', async () => {
    let firstCall = true;
    mockRequest.mockImplementation(() => {
      if (firstCall) {
        firstCall = false;
        return Promise.resolve(createMockSnapshot({ 
          nexus: { ...createMockSnapshot().nexus, sessionId: 'session-1' } 
        }));
      }
      return Promise.reject(new Error('Network error'));
    });

    const TestComponent = () => {
      const { snapshot, error, refresh } = useGateway();
      return (
        <div>
          <div data-testid="session-id">{snapshot?.nexus.sessionId || 'none'}</div>
          <div data-testid="error">{error || 'null'}</div>
          <button onClick={() => refresh()} data-testid="refresh-btn">Refresh</button>
        </div>
      );
    };

    render(
      <GatewayProvider pollingInterval={999999}>
        <TestComponent />
      </GatewayProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('session-id').textContent).toBe('session-1');
    });

    await act(async () => {
      screen.getByTestId('refresh-btn').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Network error');
    });

    // Snapshot should still be preserved
    expect(screen.getByTestId('session-id').textContent).toBe('session-1');
  });

  it('should handle non-Error exceptions', async () => {
    mockRequest.mockRejectedValue('String error');

    const TestComponent = () => {
      const { error } = useGateway();
      return <div data-testid="error">{error || 'null'}</div>;
    };

    render(
      <GatewayProvider pollingInterval={999999}>
        <TestComponent />
      </GatewayProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('String error');
    });
  });

  it('should set loading to false even on initial error', async () => {
    mockRequest.mockRejectedValue(new Error('Initial load failed'));

    const TestComponent = () => {
      const { loading, error } = useGateway();
      return (
        <div>
          <div data-testid="loading">{loading ? 'true' : 'false'}</div>
          <div data-testid="error">{error || 'null'}</div>
        </div>
      );
    };

    render(
      <GatewayProvider pollingInterval={999999}>
        <TestComponent />
      </GatewayProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('error').textContent).toBe('Initial load failed');
  });

  it('should cleanup resources on unmount', async () => {
    mockRequest.mockResolvedValue(createMockSnapshot());

    const TestComponent = () => {
      const { connected } = useGateway();
      return <div data-testid="connected">{connected ? 'true' : 'false'}</div>;
    };

    const { unmount } = render(
      <GatewayProvider pollingInterval={999999}>
        <TestComponent />
      </GatewayProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('connected').textContent).toBe('true');
    });

    unmount();

    expect(mockDispose).toHaveBeenCalled();
  });
});

