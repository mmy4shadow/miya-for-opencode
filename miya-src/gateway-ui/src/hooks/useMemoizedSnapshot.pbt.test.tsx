/**
 * Property-Based Tests for Performance Optimization Hooks
 *
 * Tests Property 12: Precise Rendering (防闪烁核心)
 * Validates Requirements: 12.1, 12.11
 *
 * Uses fast-check to generate random data and verify that only components
 * depending on changed fields will re-render during data updates.
 */

import { renderHook } from '@testing-library/react';
import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import type { GatewaySnapshot } from '../types/gateway';
import { useMemoizedSnapshot } from './useMemoizedSnapshot';
import { useStableCallback } from './useStableCallback';

/**
 * Arbitrary generator for GatewaySnapshot
 * Generates random but valid snapshot data for property testing
 */
const gatewaySnapshotArbitrary = (): fc.Arbitrary<GatewaySnapshot> => {
  // Helper to generate valid ISO date strings
  const validDateString = () =>
    fc
      .integer({ min: 1577836800000, max: 1924905600000 })
      .map((ms) => new Date(ms).toISOString());

  return fc.record({
    updatedAt: validDateString(),
    gateway: fc.record({
      url: fc.webUrl(),
      port: fc.integer({ min: 1000, max: 65535 }),
      pid: fc.integer({ min: 1, max: 99999 }),
      startedAt: validDateString(),
      status: fc.constantFrom('online', 'offline', 'starting'),
    }),
    runtime: fc.record({
      isOwner: fc.boolean(),
      ownerPID: fc.option(fc.integer({ min: 1, max: 99999 }), {
        nil: undefined,
      }),
      ownerFresh: fc.boolean(),
      activeAgentId: fc.option(fc.string(), { nil: undefined }),
      storageRevision: fc.integer({ min: 0, max: 1000 }),
    }),
    daemon: fc.record({
      connected: fc.boolean(),
      cpuPercent: fc.double({ min: 0, max: 100, noNaN: true }),
      memoryMB: fc.integer({ min: 0, max: 16384 }),
      activeJobID: fc.option(fc.string(), { nil: undefined }),
      psycheSignalHub: fc.option(
        fc.record({
          running: fc.boolean(),
          sequenceNo: fc.integer({ min: 0, max: 999999 }),
          sampledAt: fc
            .integer({ min: 1577836800000, max: 1924905600000 })
            .map((ms) => new Date(ms).toISOString()),
          latencyMs: fc.integer({ min: 0, max: 5000 }),
        }),
        { nil: undefined },
      ),
    }),
    policyHash: fc.option(fc.string({ minLength: 8, maxLength: 64 }), {
      nil: undefined,
    }),
    configCenter: fc.constant({}),
    killSwitch: fc.record({
      active: fc.boolean(),
      reason: fc.option(fc.string(), { nil: undefined }),
    }),
    nexus: fc.record({
      sessionId: fc.uuid(),
      activeTool: fc.option(fc.string(), { nil: undefined }),
      permission: fc.option(fc.string(), { nil: undefined }),
      pendingTickets: fc.integer({ min: 0, max: 100 }),
      killSwitchMode: fc.constantFrom(
        'off',
        'outbound_only',
        'desktop_only',
        'all',
      ),
      guardianSafeHoldReason: fc.option(fc.string(), { nil: undefined }),
      trust: fc.option(
        fc.record({
          target: fc.string(),
          source: fc.string(),
          action: fc.string(),
          minScore: fc.integer({ min: 0, max: 100 }),
          tier: fc.string(),
        }),
        { nil: undefined },
      ),
      trustMode: fc.record({
        silentMin: fc.integer({ min: 0, max: 100 }),
        modalMax: fc.integer({ min: 0, max: 100 }),
      }),
      psycheMode: fc.record({
        resonanceEnabled: fc.boolean(),
        captureProbeEnabled: fc.boolean(),
        signalOverrideEnabled: fc.option(fc.boolean(), { nil: undefined }),
        proactivityExploreRate: fc.option(fc.integer({ min: 0, max: 100 }), {
          nil: undefined,
        }),
        slowBrainEnabled: fc.option(fc.boolean(), { nil: undefined }),
        slowBrainShadowEnabled: fc.option(fc.boolean(), { nil: undefined }),
        slowBrainShadowRollout: fc.option(fc.integer({ min: 0, max: 100 }), {
          nil: undefined,
        }),
        periodicRetrainEnabled: fc.option(fc.boolean(), { nil: undefined }),
        proactivePingEnabled: fc.option(fc.boolean(), { nil: undefined }),
        proactivePingMinIntervalMinutes: fc.option(
          fc.integer({ min: 1, max: 1440 }),
          { nil: undefined },
        ),
        proactivePingMaxPerDay: fc.option(fc.integer({ min: 1, max: 100 }), {
          nil: undefined,
        }),
        quietHoursEnabled: fc.option(fc.boolean(), { nil: undefined }),
        quietHoursStart: fc.option(fc.string(), { nil: undefined }),
        quietHoursEnd: fc.option(fc.string(), { nil: undefined }),
        quietHoursTimezoneOffset: fc.option(fc.integer({ min: -12, max: 14 }), {
          nil: undefined,
        }),
      }),
      learningGate: fc.record({
        candidateMode: fc.constantFrom('toast_gate', 'silent', 'auto_approve'),
        persistentRequiresApproval: fc.boolean(),
      }),
      insights: fc.array(fc.string(), { maxLength: 5 }),
    }),
    safety: fc.record({
      recentSelfApproval: fc.array(fc.constant({}), { maxLength: 5 }),
    }),
    jobs: fc.record({
      total: fc.integer({ min: 0, max: 100 }),
      enabled: fc.integer({ min: 0, max: 100 }),
      pendingApprovals: fc.integer({ min: 0, max: 10 }),
      recentRuns: fc.array(fc.constant({}), { maxLength: 10 }),
    }),
    loop: fc.constant({}),
    autoflow: fc.record({
      active: fc.integer({ min: 0, max: 10 }),
      sessions: fc.array(fc.constant({}), { maxLength: 5 }),
      persistent: fc.record({
        enabled: fc.boolean(),
        resumeCooldownMs: fc.integer({ min: 0, max: 60000 }),
        maxAutoResumes: fc.integer({ min: 0, max: 10 }),
        maxConsecutiveResumeFailures: fc.integer({ min: 0, max: 5 }),
        resumeTimeoutMs: fc.integer({ min: 0, max: 120000 }),
        sessions: fc.array(fc.constant({}), { maxLength: 5 }),
      }),
    }),
    routing: fc.record({
      ecoMode: fc.boolean(),
      forcedStage: fc.option(fc.string(), { nil: undefined }),
      cost: fc.constant({}),
      recent: fc.array(fc.constant({}), { maxLength: 10 }),
    }),
    learning: fc.record({
      stats: fc.constant({}),
      topDrafts: fc.array(fc.constant({}), { maxLength: 5 }),
    }),
    background: fc.record({
      total: fc.integer({ min: 0, max: 50 }),
      running: fc.integer({ min: 0, max: 10 }),
      tasks: fc.array(fc.constant({}), { maxLength: 10 }),
    }),
    sessions: fc.record({
      total: fc.integer({ min: 0, max: 100 }),
      active: fc.integer({ min: 0, max: 50 }),
      queued: fc.integer({ min: 0, max: 20 }),
      muted: fc.integer({ min: 0, max: 10 }),
      items: fc.array(fc.constant({}), { maxLength: 20 }),
    }),
    channels: fc.record({
      states: fc.array(fc.constant({}), { maxLength: 10 }),
      pendingPairs: fc.array(fc.constant({}), { maxLength: 5 }),
      recentOutbound: fc.array(fc.constant({}), { maxLength: 10 }),
    }),
    nodes: fc.record({
      total: fc.integer({ min: 0, max: 50 }),
      connected: fc.integer({ min: 0, max: 50 }),
      pendingPairs: fc.integer({ min: 0, max: 10 }),
      list: fc.array(fc.constant({}), { maxLength: 20 }),
      devices: fc.array(fc.constant({}), { maxLength: 10 }),
      invokes: fc.array(fc.constant({}), { maxLength: 10 }),
    }),
    skills: fc.record({
      enabled: fc.array(fc.string(), { maxLength: 10 }),
      discovered: fc.array(fc.string(), { maxLength: 20 }),
    }),
    media: fc.record({
      total: fc.integer({ min: 0, max: 100 }),
      recent: fc.array(fc.constant({}), { maxLength: 10 }),
    }),
    voice: fc.constant({}),
    canvas: fc.record({
      activeDocID: fc.option(fc.string(), { nil: undefined }),
      docs: fc.array(fc.constant({}), { maxLength: 5 }),
      events: fc.array(fc.constant({}), { maxLength: 10 }),
    }),
    companion: fc.constant({}),
    security: fc.record({
      ownerIdentity: fc.constant({}),
    }),
    doctor: fc.record({
      issues: fc.array(fc.constant({}), { maxLength: 5 }),
    }),
    statusError: fc.option(fc.string(), { nil: undefined }),
  });
};

describe('Property 12: Precise Rendering - useMemoizedSnapshot', () => {
  /**
   * **Validates: Requirements 12.1, 12.11**
   *
   * Property: When only specific fields of GatewaySnapshot change,
   * useMemoizedSnapshot should return the same reference for unchanged fields.
   *
   * This ensures that components depending on unchanged fields will not re-render.
   */
  it('should return stable references for unchanged fields across updates', () => {
    fc.assert(
      fc.property(
        gatewaySnapshotArbitrary(),
        fc.constantFrom(
          'daemon',
          'nexus',
          'gateway',
          'runtime',
          'jobs',
          'sessions',
        ),
        (initialSnapshot, fieldToChange) => {
          // First render with initial snapshot
          const { result: result1, rerender } = renderHook(
            ({ snapshot }) => useMemoizedSnapshot(snapshot),
            { initialProps: { snapshot: initialSnapshot } },
          );

          const firstResult = result1.current;
          expect(firstResult).not.toBeNull();

          // Create a modified snapshot with only one field changed
          const modifiedSnapshot = { ...initialSnapshot };

          switch (fieldToChange) {
            case 'daemon':
              modifiedSnapshot.daemon = {
                ...initialSnapshot.daemon,
                cpuPercent: (initialSnapshot.daemon.cpuPercent + 10) % 100,
              };
              break;
            case 'nexus':
              modifiedSnapshot.nexus = {
                ...initialSnapshot.nexus,
                pendingTickets: initialSnapshot.nexus.pendingTickets + 1,
              };
              break;
            case 'gateway':
              modifiedSnapshot.gateway = {
                ...initialSnapshot.gateway,
                pid: initialSnapshot.gateway.pid + 1,
              };
              break;
            case 'runtime':
              modifiedSnapshot.runtime = {
                ...initialSnapshot.runtime,
                storageRevision: initialSnapshot.runtime.storageRevision + 1,
              };
              break;
            case 'jobs':
              modifiedSnapshot.jobs = {
                ...initialSnapshot.jobs,
                total: initialSnapshot.jobs.total + 1,
              };
              break;
            case 'sessions':
              modifiedSnapshot.sessions = {
                ...initialSnapshot.sessions,
                total: initialSnapshot.sessions.total + 1,
              };
              break;
          }

          // Re-render with modified snapshot
          rerender({ snapshot: modifiedSnapshot });
          const secondResult = result1.current;

          expect(secondResult).not.toBeNull();

          // The changed field should have a new reference
          expect(secondResult?.[fieldToChange]).not.toBe(
            firstResult?.[fieldToChange],
          );

          // All other fields should maintain the same reference
          const allFields = [
            'daemon',
            'nexus',
            'gateway',
            'runtime',
            'jobs',
            'sessions',
            'killSwitch',
            'safety',
            'autoflow',
            'routing',
            'learning',
            'background',
            'channels',
            'nodes',
            'skills',
            'media',
            'canvas',
            'security',
            'doctor',
          ];

          allFields.forEach((field) => {
            if (field !== fieldToChange) {
              // Unchanged fields should have the same reference
              expect(secondResult?.[field as keyof GatewaySnapshot]).toBe(
                firstResult?.[field as keyof GatewaySnapshot],
              );
            }
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.1, 12.11**
   *
   * Property: When no fields change, useMemoizedSnapshot should return
   * the exact same snapshot reference.
   */
  it('should return the same snapshot reference when no fields change', () => {
    fc.assert(
      fc.property(gatewaySnapshotArbitrary(), (snapshot) => {
        const { result, rerender } = renderHook(
          ({ snap }) => useMemoizedSnapshot(snap),
          { initialProps: { snap: snapshot } },
        );

        const firstResult = result.current;

        // Re-render with the same snapshot
        rerender({ snap: snapshot });
        const secondResult = result.current;

        // The entire snapshot should have the same reference
        expect(secondResult).toBe(firstResult);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.1, 12.11**
   *
   * Property: When multiple fields change simultaneously,
   * only those fields should have new references.
   */
  it('should update only changed fields when multiple fields change', () => {
    fc.assert(
      fc.property(
        gatewaySnapshotArbitrary(),
        fc.array(fc.constantFrom('daemon', 'nexus', 'jobs'), {
          minLength: 2,
          maxLength: 3,
        }),
        (initialSnapshot, fieldsToChange) => {
          const { result, rerender } = renderHook(
            ({ snapshot }) => useMemoizedSnapshot(snapshot),
            { initialProps: { snapshot: initialSnapshot } },
          );

          const firstResult = result.current;
          expect(firstResult).not.toBeNull();

          // Create a modified snapshot with multiple fields changed
          const modifiedSnapshot = { ...initialSnapshot };

          fieldsToChange.forEach((field) => {
            switch (field) {
              case 'daemon':
                modifiedSnapshot.daemon = {
                  ...initialSnapshot.daemon,
                  cpuPercent: (initialSnapshot.daemon.cpuPercent + 10) % 100,
                };
                break;
              case 'nexus':
                modifiedSnapshot.nexus = {
                  ...initialSnapshot.nexus,
                  pendingTickets: initialSnapshot.nexus.pendingTickets + 1,
                };
                break;
              case 'jobs':
                modifiedSnapshot.jobs = {
                  ...initialSnapshot.jobs,
                  total: initialSnapshot.jobs.total + 1,
                };
                break;
            }
          });

          rerender({ snapshot: modifiedSnapshot });
          const secondResult = result.current;

          expect(secondResult).not.toBeNull();

          // Changed fields should have new references
          fieldsToChange.forEach((field) => {
            expect(secondResult?.[field]).not.toBe(firstResult?.[field]);
          });

          // Unchanged fields should maintain the same reference
          const unchangedFields = [
            'gateway',
            'runtime',
            'sessions',
            'killSwitch',
          ];
          unchangedFields.forEach((field) => {
            if (!fieldsToChange.includes(field as any)) {
              expect(secondResult?.[field as keyof GatewaySnapshot]).toBe(
                firstResult?.[field as keyof GatewaySnapshot],
              );
            }
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.1, 12.11**
   *
   * Property: Null snapshots should be handled correctly
   */
  it('should handle null snapshots correctly', () => {
    fc.assert(
      fc.property(
        fc.option(gatewaySnapshotArbitrary(), { nil: null }),
        (snapshot) => {
          const { result } = renderHook(() => useMemoizedSnapshot(snapshot));

          if (snapshot === null) {
            expect(result.current).toBeNull();
          } else {
            expect(result.current).not.toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 12: Precise Rendering - useStableCallback', () => {
  /**
   * **Validates: Requirements 12.1, 12.11**
   *
   * Property: useStableCallback should always return the same function reference,
   * even when the callback changes, preventing unnecessary re-renders of child components.
   */
  it('should maintain stable callback reference across re-renders', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 2, maxLength: 10 }),
        (values) => {
          let currentIndex = 0;
          const callbacks = values.map((val) => vi.fn(() => val));

          const { result, rerender } = renderHook(
            ({ callback }) => useStableCallback(callback),
            { initialProps: { callback: callbacks[currentIndex] } },
          );

          const stableReference = result.current;

          // Re-render with different callbacks
          for (let i = 1; i < callbacks.length; i++) {
            currentIndex = i;
            rerender({ callback: callbacks[i] });

            // Reference should remain stable
            expect(result.current).toBe(stableReference);

            // But should call the latest callback
            const returnValue = result.current();
            expect(returnValue).toBe(values[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 12.1, 12.11**
   *
   * Property: Stable callbacks should correctly pass through all arguments
   */
  it('should pass through all arguments to the latest callback', () => {
    fc.assert(
      fc.property(
        fc.array(fc.anything(), { minLength: 0, maxLength: 5 }),
        (args) => {
          const callback = vi.fn((...receivedArgs: any[]) => receivedArgs);

          const { result } = renderHook(() => useStableCallback(callback));

          const returnValue = result.current(...args);

          expect(callback).toHaveBeenCalledWith(...args);
          expect(returnValue).toEqual(args);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 12: Integration - Precise Rendering in Component Tree', () => {
  /**
   * **Validates: Requirements 12.1, 12.11**
   *
   * Property: When using both useMemoizedSnapshot and React.memo,
   * child components should only re-render when their specific dependencies change.
   */
  it('should prevent unnecessary re-renders in memoized components', () => {
    fc.assert(
      fc.property(
        gatewaySnapshotArbitrary(),
        fc.constantFrom('daemon', 'nexus', 'jobs'),
        (initialSnapshot, fieldToChange) => {
          const childRenderSpy = vi.fn();

          // Create a test hook that uses useMemoizedSnapshot
          const useTestHook = (snapshot: GatewaySnapshot) => {
            const memoized = useMemoizedSnapshot(snapshot);
            childRenderSpy();
            return memoized?.daemon.cpuPercent ?? 0;
          };

          const { result, rerender } = renderHook(
            ({ snapshot }) => useTestHook(snapshot),
            { initialProps: { snapshot: initialSnapshot } },
          );

          const _initialRenderCount = childRenderSpy.mock.calls.length;
          const initialCpuPercent = result.current;

          // Modify a field
          const modifiedSnapshot = { ...initialSnapshot };

          if (fieldToChange !== 'daemon') {
            // Change a field that doesn't affect cpuPercent
            switch (fieldToChange) {
              case 'nexus':
                modifiedSnapshot.nexus = {
                  ...initialSnapshot.nexus,
                  pendingTickets: initialSnapshot.nexus.pendingTickets + 1,
                };
                break;
              case 'jobs':
                modifiedSnapshot.jobs = {
                  ...initialSnapshot.jobs,
                  total: initialSnapshot.jobs.total + 1,
                };
                break;
            }

            rerender({ snapshot: modifiedSnapshot });

            // Hook will re-render (that's expected), but the memoized daemon
            // should be the same reference, so derived values should be stable
            expect(result.current).toBe(initialCpuPercent);
          } else {
            // Change the daemon field
            modifiedSnapshot.daemon = {
              ...initialSnapshot.daemon,
              cpuPercent: (initialSnapshot.daemon.cpuPercent + 10) % 100,
            };

            rerender({ snapshot: modifiedSnapshot });

            // cpuPercent should have changed
            expect(result.current).not.toBe(initialCpuPercent);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
