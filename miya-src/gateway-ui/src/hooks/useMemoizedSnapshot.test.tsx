/**
 * Unit tests for useMemoizedSnapshot hook
 *
 * Tests deep comparison and memoization of GatewaySnapshot fields
 * Requirements: 12.1, 12.11
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GatewaySnapshot } from '../types/gateway';
import { useMemoizedSnapshot } from './useMemoizedSnapshot';

// Helper to create a minimal valid snapshot
function createMockSnapshot(
  overrides?: Partial<GatewaySnapshot>,
): GatewaySnapshot {
  return {
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
      cpuPercent: 25.5,
      memoryMB: 512,
    },
    policyHash: 'test-hash-123',
    configCenter: {},
    killSwitch: {
      active: false,
    },
    nexus: {
      sessionId: 'session-123',
      pendingTickets: 0,
      killSwitchMode: 'off',
      insights: [],
      trustMode: {
        silentMin: 70,
        modalMax: 30,
      },
      psycheMode: {
        resonanceEnabled: true,
        captureProbeEnabled: true,
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
      enabled: 8,
      pendingApprovals: 2,
      recentRuns: [],
    },
    loop: null,
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
      cost: null,
      recent: [],
    },
    learning: {
      stats: null,
      topDrafts: [],
    },
    background: {
      total: 0,
      running: 0,
      tasks: [],
    },
    sessions: {
      total: 1,
      active: 1,
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
      total: 2,
      connected: 2,
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
    voice: null,
    canvas: {
      docs: [],
      events: [],
    },
    companion: null,
    security: {
      ownerIdentity: null,
    },
    doctor: {
      issues: [],
    },
    ...overrides,
  };
}

describe('useMemoizedSnapshot', () => {
  it('should return null when snapshot is null', () => {
    const { result } = renderHook(() => useMemoizedSnapshot(null));
    expect(result.current).toBeNull();
  });

  it('should return memoized snapshot with all fields', () => {
    const snapshot = createMockSnapshot();
    const { result } = renderHook(() => useMemoizedSnapshot(snapshot));

    expect(result.current).not.toBeNull();
    expect(result.current?.gateway).toBeDefined();
    expect(result.current?.daemon).toBeDefined();
    expect(result.current?.nexus).toBeDefined();
    expect(result.current?.jobs).toBeDefined();
  });

  it('should preserve gateway field when unchanged', () => {
    const snapshot1 = createMockSnapshot();
    const { result, rerender } = renderHook(
      ({ snap }) => useMemoizedSnapshot(snap),
      { initialProps: { snap: snapshot1 } },
    );

    const firstGateway = result.current?.gateway;

    // Create new snapshot with same gateway data but different object reference
    const snapshot2 = createMockSnapshot({
      updatedAt: '2025-01-21T00:01:00Z', // Different timestamp
    });

    rerender({ snap: snapshot2 });

    // Gateway should be the same reference (memoized)
    expect(result.current?.gateway).toBe(firstGateway);
  });

  it('should update gateway field when changed', () => {
    const snapshot1 = createMockSnapshot();
    const { result, rerender } = renderHook(
      ({ snap }) => useMemoizedSnapshot(snap),
      { initialProps: { snap: snapshot1 } },
    );

    const firstGateway = result.current?.gateway;

    // Create new snapshot with different gateway status
    const snapshot2 = createMockSnapshot({
      gateway: {
        ...snapshot1.gateway,
        status: 'offline',
      },
    });

    rerender({ snap: snapshot2 });

    // Gateway should be a different reference (updated)
    expect(result.current?.gateway).not.toBe(firstGateway);
    expect(result.current?.gateway.status).toBe('offline');
  });

  it('should preserve daemon field when unchanged', () => {
    const snapshot1 = createMockSnapshot();
    const { result, rerender } = renderHook(
      ({ snap }) => useMemoizedSnapshot(snap),
      { initialProps: { snap: snapshot1 } },
    );

    const firstDaemon = result.current?.daemon;

    // Create new snapshot with different unrelated field
    const snapshot2 = createMockSnapshot({
      updatedAt: '2025-01-21T00:01:00Z',
    });

    rerender({ snap: snapshot2 });

    // Daemon should be the same reference (memoized)
    expect(result.current?.daemon).toBe(firstDaemon);
  });

  it('should update daemon field when cpuPercent changes', () => {
    const snapshot1 = createMockSnapshot();
    const { result, rerender } = renderHook(
      ({ snap }) => useMemoizedSnapshot(snap),
      { initialProps: { snap: snapshot1 } },
    );

    const firstDaemon = result.current?.daemon;

    // Create new snapshot with different CPU percentage
    const snapshot2 = createMockSnapshot({
      daemon: {
        ...snapshot1.daemon,
        cpuPercent: 50.0,
      },
    });

    rerender({ snap: snapshot2 });

    // Daemon should be a different reference (updated)
    expect(result.current?.daemon).not.toBe(firstDaemon);
    expect(result.current?.daemon.cpuPercent).toBe(50.0);
  });

  it('should preserve nexus field when psycheMode unchanged', () => {
    const snapshot1 = createMockSnapshot();
    const { result, rerender } = renderHook(
      ({ snap }) => useMemoizedSnapshot(snap),
      { initialProps: { snap: snapshot1 } },
    );

    const firstNexus = result.current?.nexus;

    // Create new snapshot with different unrelated field
    const snapshot2 = createMockSnapshot({
      updatedAt: '2025-01-21T00:01:00Z',
    });

    rerender({ snap: snapshot2 });

    // Nexus should be the same reference (memoized)
    expect(result.current?.nexus).toBe(firstNexus);
  });

  it('should update nexus field when psycheMode changes', () => {
    const snapshot1 = createMockSnapshot();
    const { result, rerender } = renderHook(
      ({ snap }) => useMemoizedSnapshot(snap),
      { initialProps: { snap: snapshot1 } },
    );

    const firstNexus = result.current?.nexus;

    // Create new snapshot with different psycheMode
    const snapshot2 = createMockSnapshot({
      nexus: {
        ...snapshot1.nexus,
        psycheMode: {
          ...snapshot1.nexus.psycheMode,
          resonanceEnabled: false,
        },
      },
    });

    rerender({ snap: snapshot2 });

    // Nexus should be a different reference (updated)
    expect(result.current?.nexus).not.toBe(firstNexus);
    expect(result.current?.nexus.psycheMode.resonanceEnabled).toBe(false);
  });

  it('should preserve jobs field when unchanged', () => {
    const snapshot1 = createMockSnapshot();
    const { result, rerender } = renderHook(
      ({ snap }) => useMemoizedSnapshot(snap),
      { initialProps: { snap: snapshot1 } },
    );

    const firstJobs = result.current?.jobs;

    // Create new snapshot with different unrelated field
    const snapshot2 = createMockSnapshot({
      updatedAt: '2025-01-21T00:01:00Z',
    });

    rerender({ snap: snapshot2 });

    // Jobs should be the same reference (memoized)
    expect(result.current?.jobs).toBe(firstJobs);
  });

  it('should update jobs field when total changes', () => {
    const snapshot1 = createMockSnapshot();
    const { result, rerender } = renderHook(
      ({ snap }) => useMemoizedSnapshot(snap),
      { initialProps: { snap: snapshot1 } },
    );

    const firstJobs = result.current?.jobs;

    // Create new snapshot with different jobs total
    const snapshot2 = createMockSnapshot({
      jobs: {
        ...snapshot1.jobs,
        total: 15,
      },
    });

    rerender({ snap: snapshot2 });

    // Jobs should be a different reference (updated)
    expect(result.current?.jobs).not.toBe(firstJobs);
    expect(result.current?.jobs.total).toBe(15);
  });

  it('should preserve nodes field when unchanged', () => {
    const snapshot1 = createMockSnapshot();
    const { result, rerender } = renderHook(
      ({ snap }) => useMemoizedSnapshot(snap),
      { initialProps: { snap: snapshot1 } },
    );

    const firstNodes = result.current?.nodes;

    // Create new snapshot with different unrelated field
    const snapshot2 = createMockSnapshot({
      updatedAt: '2025-01-21T00:01:00Z',
    });

    rerender({ snap: snapshot2 });

    // Nodes should be the same reference (memoized)
    expect(result.current?.nodes).toBe(firstNodes);
  });

  it('should update nodes field when connected count changes', () => {
    const snapshot1 = createMockSnapshot();
    const { result, rerender } = renderHook(
      ({ snap }) => useMemoizedSnapshot(snap),
      { initialProps: { snap: snapshot1 } },
    );

    const firstNodes = result.current?.nodes;

    // Create new snapshot with different connected count
    const snapshot2 = createMockSnapshot({
      nodes: {
        ...snapshot1.nodes,
        connected: 1,
      },
    });

    rerender({ snap: snapshot2 });

    // Nodes should be a different reference (updated)
    expect(result.current?.nodes).not.toBe(firstNodes);
    expect(result.current?.nodes.connected).toBe(1);
  });

  it('should handle complex nested changes in nexus.insights', () => {
    const snapshot1 = createMockSnapshot();
    const { result, rerender } = renderHook(
      ({ snap }) => useMemoizedSnapshot(snap),
      { initialProps: { snap: snapshot1 } },
    );

    const firstNexus = result.current?.nexus;

    // Create new snapshot with different insights array
    const snapshot2 = createMockSnapshot({
      nexus: {
        ...snapshot1.nexus,
        insights: [{ at: '2025-01-21T00:00:00Z', text: 'New insight' }],
      },
    });

    rerender({ snap: snapshot2 });

    // Nexus should be a different reference (updated)
    expect(result.current?.nexus).not.toBe(firstNexus);
    expect(result.current?.nexus.insights).toHaveLength(1);
  });

  it('should preserve multiple fields when only one changes', () => {
    const snapshot1 = createMockSnapshot();
    const { result, rerender } = renderHook(
      ({ snap }) => useMemoizedSnapshot(snap),
      { initialProps: { snap: snapshot1 } },
    );

    const firstGateway = result.current?.gateway;
    const firstDaemon = result.current?.daemon;
    const firstNexus = result.current?.nexus;

    // Create new snapshot with only jobs changed
    const snapshot2 = createMockSnapshot({
      jobs: {
        ...snapshot1.jobs,
        total: 20,
      },
    });

    rerender({ snap: snapshot2 });

    // Gateway, daemon, and nexus should be the same references (memoized)
    expect(result.current?.gateway).toBe(firstGateway);
    expect(result.current?.daemon).toBe(firstDaemon);
    expect(result.current?.nexus).toBe(firstNexus);

    // Only jobs should be updated
    expect(result.current?.jobs.total).toBe(20);
  });

  it('should handle partial snapshot with undefined fields gracefully', () => {
    // Create a minimal snapshot with many undefined fields
    const partialSnapshot: GatewaySnapshot = {
      updatedAt: '2025-01-21T00:00:00Z',
      gateway: undefined as any,
      runtime: undefined as any,
      daemon: undefined as any,
      policyHash: undefined as any,
      configCenter: undefined as any,
      killSwitch: undefined as any,
      nexus: undefined as any,
      safety: undefined as any,
      jobs: undefined as any,
      loop: null,
      autoflow: undefined as any,
      routing: undefined as any,
      learning: undefined as any,
      background: undefined as any,
      sessions: undefined as any,
      channels: undefined as any,
      nodes: undefined as any,
      skills: undefined as any,
      media: undefined as any,
      voice: null,
      canvas: undefined as any,
      companion: null,
      security: undefined as any,
      doctor: undefined as any,
      statusError: undefined,
    };

    // Should not throw errors when rendering with partial data
    const { result } = renderHook(() => useMemoizedSnapshot(partialSnapshot));

    expect(result.current).not.toBeNull();
    expect(result.current?.updatedAt).toBe('2025-01-21T00:00:00Z');
    expect(result.current?.gateway).toBeUndefined();
    expect(result.current?.daemon).toBeUndefined();
  });

  it('should handle snapshot with nested undefined properties', () => {
    // Create snapshot with some fields present but nested properties undefined
    const snapshot: GatewaySnapshot = {
      ...createMockSnapshot(),
      daemon: {
        connected: true,
        cpuPercent: 25.5,
        memoryMB: 512,
        psycheSignalHub: undefined as any, // Nested undefined
      },
      nexus: {
        sessionId: 'session-123',
        pendingTickets: 0,
        killSwitchMode: 'off',
        insights: [],
        trust: undefined as any, // Nested undefined
        trustMode: undefined as any, // Nested undefined
        psycheMode: undefined as any, // Nested undefined
        learningGate: undefined as any, // Nested undefined
      },
      autoflow: {
        active: 0,
        sessions: [],
        persistent: undefined as any, // Nested undefined
      },
    };

    // Should not throw errors when rendering with nested undefined
    const { result } = renderHook(() => useMemoizedSnapshot(snapshot));

    expect(result.current).not.toBeNull();
    expect(result.current?.daemon.connected).toBe(true);
    expect(result.current?.nexus.sessionId).toBe('session-123');
    expect(result.current?.autoflow.active).toBe(0);
  });
});
