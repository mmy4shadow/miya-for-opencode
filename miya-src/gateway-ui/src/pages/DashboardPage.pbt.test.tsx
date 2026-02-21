import { render, waitFor } from '@testing-library/react';
import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { GatewayProvider } from '../hooks/useGateway';
import { DashboardPage } from './DashboardPage';

/**
 * Property-Based Tests for DashboardPage
 *
 * These tests verify that the Dashboard page maintains content isolation
 * by ensuring it does NOT contain elements that have been moved to other pages.
 */

/**
 * Mock GatewayRpcClient to avoid real network calls
 * Returns a minimal valid GatewaySnapshot structure
 */
vi.mock('../gateway-client', () => ({
  GatewayRpcClient: class MockGatewayRpcClient {
    request = vi.fn().mockResolvedValue({
      updatedAt: new Date().toISOString(),
      gateway: {
        url: 'http://localhost',
        port: 3000,
        pid: 12345,
        startedAt: new Date().toISOString(),
        status: 'online' as const,
      },
      runtime: {
        isOwner: true,
        ownerFresh: true,
        storageRevision: 1,
      },
      daemon: {
        connected: true,
        cpuPercent: 10,
        memoryMB: 100,
      },
      policyHash: 'test-hash',
      configCenter: {},
      killSwitch: {
        active: false,
      },
      nexus: {
        sessionId: 'test-session',
        pendingTickets: 0,
        killSwitchMode: 'off' as const,
        insights: [],
        trustMode: {
          silentMin: 0,
          modalMax: 100,
        },
        psycheMode: {
          resonanceEnabled: false,
          captureProbeEnabled: false,
        },
        learningGate: {
          candidateMode: 'toast_gate' as const,
          persistentRequiresApproval: false,
        },
      },
      safety: {
        recentSelfApproval: [],
      },
      jobs: {
        total: 0,
        enabled: 0,
        pendingApprovals: 0,
        recentRuns: [],
      },
      loop: {},
      autoflow: {
        active: 0,
        sessions: [],
        persistent: {
          enabled: false,
          resumeCooldownMs: 0,
          maxAutoResumes: 0,
          maxConsecutiveResumeFailures: 0,
          resumeTimeoutMs: 0,
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
        recentOutbound: [],
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
    });
    dispose = vi.fn();
  },
}));

/**
 * Helper function to render Dashboard and wait for initial load
 */
async function renderDashboard() {
  const result = render(
    <GatewayProvider>
      <DashboardPage />
    </GatewayProvider>,
  );

  // Wait for the component to finish loading
  await waitFor(
    () => {
      const loadingText = result.queryByText('加载中...');
      expect(loadingText).not.toBeInTheDocument();
    },
    { timeout: 3000 },
  );

  return result;
}

describe('Property 5: Dashboard Content Isolation', () => {
  /**
   * **Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7**
   *
   * Property: The Dashboard page should NOT contain any of the following content:
   * - Psyche configuration forms (共鸣层, 捕获探针, 信号覆盖, etc.)
   * - Security switches (外发暂停, 桌控暂停, etc.)
   * - Policy domain status (策略域, 消息外发, 桌面控制, etc.)
   * - Execution sequences/evidence packs (执行序列, 证据包, etc.)
   * - Skill summaries (技能摘要, 已启用技能, etc.)
   * - Ecosystem bridge summaries (生态桥接, 桥接摘要, etc.)
   *
   * This property should hold regardless of the data state or rendering conditions.
   */

  it('should never display Psyche configuration content', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null), // We don't need random data, just multiple iterations
        async () => {
          const { container } = await renderDashboard();

          // Terms that should NOT appear on Dashboard (Psyche-related)
          const forbiddenPsycheTerms = [
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
            'proactivity',
            'slow brain',
            'shadow mode',
            'periodic retrain',
            'proactive ping',
          ];

          const pageText = container.textContent || '';

          forbiddenPsycheTerms.forEach((term) => {
            expect(pageText).not.toContain(term);
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should never display security switch controls', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const { container } = await renderDashboard();

        // Terms that should NOT appear on Dashboard (Security switches)
        const forbiddenSecurityTerms = [
          '外发暂停',
          '桌控暂停',
          '记忆读取暂停',
          'outbound pause',
          'desktop pause',
          'memory read pause',
        ];

        const pageText = container.textContent || '';

        forbiddenSecurityTerms.forEach((term) => {
          expect(pageText).not.toContain(term);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('should never display policy domain status', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const { container } = await renderDashboard();

        // Terms that should NOT appear on Dashboard (Policy domains)
        const forbiddenPolicyTerms = [
          '策略域',
          '消息外发',
          '桌面控制',
          '记忆读取',
          'policy domain',
          'message outbound',
          'desktop control domain',
        ];

        const pageText = container.textContent || '';

        forbiddenPolicyTerms.forEach((term) => {
          expect(pageText).not.toContain(term);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('should never display execution sequences or evidence packs', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const { container } = await renderDashboard();

        // Terms that should NOT appear on Dashboard (Execution/Evidence)
        const forbiddenExecutionTerms = [
          '执行序列',
          '证据包',
          '证据截图',
          '证据置信度',
          'execution sequence',
          'evidence pack',
          'evidence screenshot',
          'evidence confidence',
        ];

        const pageText = container.textContent || '';

        forbiddenExecutionTerms.forEach((term) => {
          expect(pageText).not.toContain(term);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('should never display skill summaries', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const { container } = await renderDashboard();

        // Terms that should NOT appear on Dashboard (Skills)
        const forbiddenSkillTerms = [
          '技能摘要',
          '技能列表',
          '已启用技能',
          'skill summary',
          'enabled skills',
          'discovered skills',
        ];

        const pageText = container.textContent || '';

        forbiddenSkillTerms.forEach((term) => {
          expect(pageText).not.toContain(term);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('should never display ecosystem bridge summaries', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const { container } = await renderDashboard();

        // Terms that should NOT appear on Dashboard (Ecosystem)
        const forbiddenEcosystemTerms = [
          '生态桥接',
          '桥接摘要',
          'ecosystem bridge',
          'bridge summary',
        ];

        const pageText = container.textContent || '';

        forbiddenEcosystemTerms.forEach((term) => {
          expect(pageText).not.toContain(term);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('should maintain content isolation across all forbidden categories', async () => {
    /**
     * Combined test that verifies ALL forbidden content is absent
     * This is a comprehensive check that runs 100 iterations
     */
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const { container } = await renderDashboard();

        // All forbidden terms combined
        const allForbiddenTerms = [
          // Psyche
          '共鸣层',
          '捕获探针',
          '信号覆盖',
          '主动探索率',
          '慢脑',
          '影子模式',
          '周期重训',
          '主动触达',
          '静默时段',
          // Security switches
          '外发暂停',
          '桌控暂停',
          '记忆读取暂停',
          // Policy domains
          '策略域',
          '消息外发',
          '桌面控制',
          '记忆读取',
          // Execution/Evidence
          '执行序列',
          '证据包',
          '证据截图',
          '证据置信度',
          // Skills
          '技能摘要',
          '技能列表',
          '已启用技能',
          // Ecosystem
          '生态桥接',
          '桥接摘要',
        ];

        const pageText = container.textContent || '';

        // Verify NONE of the forbidden terms appear
        const foundForbiddenTerms = allForbiddenTerms.filter((term) =>
          pageText.includes(term),
        );

        expect(foundForbiddenTerms).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
