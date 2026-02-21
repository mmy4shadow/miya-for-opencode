import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

if (typeof globalThis.window === 'undefined') {
  GlobalRegistrator.register({ url: 'http://localhost/' });
}

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

const { cleanup, fireEvent, render, screen, waitFor } = await import(
  '@testing-library/react'
);
const { default: App } = await import('./App');

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
  skills: {
    enabled: [],
    discovered: [],
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

afterAll(() => {
  if (typeof globalThis.window === 'undefined') {
    GlobalRegistrator.unregister();
  }
});

describe('App component behavior', () => {
  test('does not crash on malformed encoded route segments', async () => {
    resetBrowserState('/tasks/%E0%A4%A');

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText('该任务不存在或已被清理，请返回列表刷新后重试。'),
      ).not.toBeNull();
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
      expect(screen.getByRole('alert')).not.toBeNull();
    });
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe(
      'assertive',
    );

    const copyButtons = await screen.findAllByRole('button', {
      name: '复制 PowerShell 修复命令',
    });
    fireEvent.click(copyButtons[0]);

    await waitFor(() => {
      expect(
        container.querySelectorAll('[aria-live="polite"]').length,
      ).toBeGreaterThan(0);
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
        screen.getByText(
          (text) => text.includes('更新时间：') && text.includes(expected),
        ),
      ).not.toBeNull();
    });
    expect(screen.queryByText(updatedAt)).toBeNull();
    expect(document.documentElement.lang).toBe('en-US');
  });

  test('shows completeness panels for workflow, recovery, transparency and audit', async () => {
    resetBrowserState('/');
    requestMock.mockImplementation(async (method: string) => {
      if (method === 'gateway.status.get') {
        return {
          ...BASE_STATUS_SNAPSHOT,
          daemon: {
            connected: true,
            activeJobID: 'train.voice',
            activeJobProgress: 0.63,
          },
          statusError: {
            message: 'daemon reconnect required',
          },
          nexus: {
            killSwitchMode: 'off',
            pendingTickets: 2,
            permission: 'desktop_control',
            insights: [
              {
                at: '2026-07-04T12:01:00.000Z',
                text: 'manual intervention note',
                auditID: 'audit-1',
              },
            ],
          },
          channels: {
            recentOutbound: [
              {
                id: 'audit-1',
                channel: 'qq',
                destination: 'owner-001',
                message: 'outbound_blocked:psyche_deferred',
                recipientTextCheck: 'ok',
                sendStatusCheck: 'blocked',
                receiptStatus: 'none',
              },
            ],
          },
          skills: {
            enabled: ['skill-a', 'skill-b'],
            discovered: [
              { id: 'skill-a' },
              { id: 'skill-b' },
              { id: 'skill-c' },
            ],
          },
        };
      }
      if (method === 'policy.domains.list') {
        return {
          domains: [{ domain: 'outbound_send', status: 'running' }],
        };
      }
      if (method === 'cron.list')
        return [{ id: 'train.voice', name: 'Voice Train' }];
      if (method === 'cron.runs.list') return [];
      if (method === 'security.identity.status') return { mode: 'owner' };
      if (method === 'companion.memory.vector.list') return [];
      return {};
    });

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          name: '用户工作流完整性与权限请求清晰度',
        }),
      ).not.toBeNull();
    });
    expect(
      screen.getByRole('heading', {
        name: '错误恢复路径完整性与配置可发现性',
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole('heading', {
        name: '训练进度可见性与技能管理用户体验',
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole('heading', {
        name: '桌面控制操作透明度与审计追踪',
      }),
    ).not.toBeNull();
    expect(screen.getByText('系统时间线')).not.toBeNull();
    expect(screen.getByText('Evidence Pack V5（外发证据预览）')).not.toBeNull();
    expect(screen.getByText('进度：63%')).not.toBeNull();
  });

  test('surfaces actionable error for oversized memory import payload', async () => {
    resetBrowserState('/memory');
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
    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '记忆库' })).not.toBeNull();
    });

    const importInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    expect(importInput).not.toBeNull();
    if (!importInput) return;

    const oversizedFile = {
      size: 2 * 1024 * 1024 + 1,
      text: async () => JSON.stringify([]),
    } as unknown as File;
    fireEvent.change(importInput, {
      target: { files: [oversizedFile] },
    });

    await waitFor(() => {
      expect(
        screen.getAllByText((text) =>
          text.includes('memory_import_file_too_large'),
        ).length,
      ).toBeGreaterThan(0);
    });
  });

  test('reports partial import failures with actionable context', async () => {
    resetBrowserState('/memory');
    let importCallCount = 0;
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
      if (method === 'companion.memory.add') {
        importCallCount += 1;
        if (importCallCount === 2) {
          throw new Error('memory_write_denied');
        }
        return { ok: true };
      }
      return {};
    });
    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '记忆库' })).not.toBeNull();
    });

    const importInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    expect(importInput).not.toBeNull();
    if (!importInput) return;

    const importFile = {
      size: 64,
      text: async () => JSON.stringify([{ text: 'one' }, { text: 'two' }]),
    } as unknown as File;
    fireEvent.change(importInput, {
      target: { files: [importFile] },
    });

    await waitFor(() => {
      expect(
        screen.getAllByText((text) =>
          text.includes('partial_failure:memory_import'),
        ).length,
      ).toBeGreaterThan(0);
    });
    expect(importCallCount).toBe(2);
  });

  test('exposes quick log export action on task list page', async () => {
    resetBrowserState('/tasks');
    const originalCreateObjectURL = (
      URL as typeof URL & {
        createObjectURL?: (obj: Blob) => string;
      }
    ).createObjectURL;
    const originalRevokeObjectURL = (
      URL as typeof URL & {
        revokeObjectURL?: (url: string) => void;
      }
    ).revokeObjectURL;
    const createObjectURLSpy = vi.fn(() => 'blob:mock-task-log');
    const revokeObjectURLSpy = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURLSpy,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURLSpy,
      writable: true,
      configurable: true,
    });
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    requestMock.mockImplementation(async (method: string) => {
      if (method === 'gateway.status.get') return BASE_STATUS_SNAPSHOT;
      if (method === 'policy.domains.list') {
        return {
          domains: [{ domain: 'outbound_send', status: 'running' }],
        };
      }
      if (method === 'cron.list') return [{ id: 'job-1', name: 'Task 1' }];
      if (method === 'cron.runs.list') {
        return [
          {
            id: 'run-1',
            jobId: 'job-1',
            jobName: 'Task 1',
            trigger: 'manual',
            startedAt: '2026-07-04T12:00:00.000Z',
            endedAt: '2026-07-04T12:01:00.000Z',
            status: 'success',
            exitCode: 0,
            timedOut: false,
            stdout: 'done',
            stderr: '',
          },
        ];
      }
      if (method === 'security.identity.status') return { mode: 'owner' };
      if (method === 'companion.memory.vector.list') return [];
      return {};
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '作业中心' })).not.toBeNull();
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: '导出最近日志',
      }),
    );

    await waitFor(() => {
      expect(screen.getByText('成功：已导出任务日志：run-1')).not.toBeNull();
    });
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalled();
    expect(anchorClickSpy).toHaveBeenCalled();
    if (originalCreateObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', {
        value: originalCreateObjectURL,
        writable: true,
        configurable: true,
      });
    }
    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        value: originalRevokeObjectURL,
        writable: true,
        configurable: true,
      });
    }
  });
});
