import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from './App';

const requestMock = vi.fn();
const disposeMock = vi.fn();

vi.mock('./gateway-client', () => {
  return {
    GatewayRpcClient: class MockGatewayRpcClient {
      request(method: string, params?: Record<string, unknown>) {
        return requestMock(method, params);
      }

      dispose() {
        disposeMock();
      }
    },
  };
});

const BASE_STATUS_SNAPSHOT = {
  updatedAt: '2026-07-04T12:00:00.000Z',
  gateway: {
    status: 'running',
    url: 'http://127.0.0.1:9527',
  },
  daemon: {
    connected: true,
  },
  policyHash: 'policy-hash-test',
  sessions: {
    total: 0,
    active: 0,
    queued: 0,
    muted: 0,
  },
  jobs: {
    total: 0,
    enabled: 0,
    pendingApprovals: 0,
    recentRuns: [],
  },
  nexus: {
    killSwitchMode: 'off',
  },
  nodes: {
    total: 1,
    connected: 1,
    list: [
      {
        id: 'node-1',
        label: 'Main Node',
        connected: true,
        platform: 'windows',
        updatedAt: '2026-07-04T12:00:00.000Z',
      },
    ],
  },
  channels: {
    recentOutbound: [],
  },
} as const;

function resetBrowserState(pathname: string): void {
  window.history.replaceState({}, '', pathname);
  window.localStorage.clear();
}

beforeEach(() => {
  requestMock.mockImplementation(async (method: string) => {
    if (method === 'gateway.status.get') return BASE_STATUS_SNAPSHOT;
    if (method === 'policy.domains.list') {
      return {
        domains: [{ domain: 'outbound_send', status: 'running' }],
      };
    }
    if (method === 'cron.list') return [];
    if (method === 'cron.runs.list') return [];
    if (method === 'security.identity.status') return { mode: 'owner' };
    if (method === 'companion.memory.vector.list') return [];
    return {};
  });
  disposeMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('App component behavior', () => {
  test('does not crash on malformed encoded route segments', async () => {
    resetBrowserState('/tasks/%E0%A4%A');

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText('该任务不存在或已被清理，请返回列表刷新后重试。'),
      ).toBeInTheDocument();
    });
  });

  test('renders assertive and polite live regions for accessibility feedback', async () => {
    resetBrowserState('/');
    requestMock.mockImplementation(async (method: string) => {
      if (method === 'gateway.status.get') {
        throw new Error('failed to fetch');
      }
      return {};
    });
    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');

    const copyButtons = await screen.findAllByRole('button', {
      name: '复制 PowerShell 修复命令',
    });
    fireEvent.click(copyButtons[0]);

    await waitFor(() => {
      expect(container.querySelectorAll('[aria-live="polite"]').length).toBeGreaterThan(0);
    });
  });

  test('formats memory timestamps using runtime locale', async () => {
    const updatedAt = '2026-07-04T12:00:00.000Z';
    resetBrowserState('/memory');
    document.documentElement.lang = 'en-US';
    requestMock.mockImplementation(async (method: string) => {
      if (method === 'gateway.status.get') return BASE_STATUS_SNAPSHOT;
      if (method === 'policy.domains.list') {
        return {
          domains: [{ domain: 'outbound_send', status: 'running' }],
        };
      }
      if (method === 'cron.list') return [];
      if (method === 'cron.runs.list') return [];
      if (method === 'security.identity.status') return { mode: 'owner' };
      if (method === 'companion.memory.vector.list') {
        return [
          {
            id: 'mem-1',
            text: 'remember this',
            domain: 'work',
            status: 'active',
            isArchived: false,
            updatedAt,
          },
        ];
      }
      return {};
    });

    render(<App />);

    const expected = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(updatedAt));

    await waitFor(() => {
      expect(
        screen.getByText((text) =>
          text.includes('更新时间：') && text.includes(expected),
        ),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(updatedAt)).not.toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en-US');
  });
});
