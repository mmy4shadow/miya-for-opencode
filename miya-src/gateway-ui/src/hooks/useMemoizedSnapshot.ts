/**
 * useMemoizedSnapshot Hook
 *
 * Performs deep comparison on GatewaySnapshot fields and caches unchanged fields
 * to prevent unnecessary re-renders (Requirement 12.1, 12.11)
 *
 * This is a critical performance optimization that ensures only components
 * depending on changed fields will re-render during data updates.
 */

import { useMemo } from 'react';
import type { GatewaySnapshot } from '../types/gateway';

function stableDep(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * Memoize GatewaySnapshot with deep comparison
 *
 * Each top-level field is memoized independently, so only components
 * depending on changed fields will re-render.
 *
 * @param snapshot - The raw snapshot from GatewayProvider
 * @returns Optimized snapshot with memoized fields
 */
export function useMemoizedSnapshot(
  snapshot: GatewaySnapshot | null,
): GatewaySnapshot | null {
  // Memoize gateway field
  const memoizedGateway = useMemo(
    () => snapshot?.gateway,
    [stableDep(snapshot?.gateway)],
  );

  // Memoize runtime field
  const memoizedRuntime = useMemo(
    () => snapshot?.runtime,
    [stableDep(snapshot?.runtime)],
  );

  // Memoize daemon field
  const memoizedDaemon = useMemo(
    () => snapshot?.daemon,
    [stableDep(snapshot?.daemon)],
  );

  // Memoize killSwitch field
  const memoizedKillSwitch = useMemo(
    () => snapshot?.killSwitch,
    [stableDep(snapshot?.killSwitch)],
  );

  // Memoize nexus field (complex object with many sub-fields)
  const memoizedNexus = useMemo(
    () => snapshot?.nexus,
    [stableDep(snapshot?.nexus)],
  );

  // Memoize safety field
  const memoizedSafety = useMemo(
    () => snapshot?.safety,
    [stableDep(snapshot?.safety)],
  );

  // Memoize jobs field
  const memoizedJobs = useMemo(
    () => snapshot?.jobs,
    [stableDep(snapshot?.jobs)],
  );

  // Memoize autoflow field
  const memoizedAutoflow = useMemo(
    () => snapshot?.autoflow,
    [stableDep(snapshot?.autoflow)],
  );

  // Memoize routing field
  const memoizedRouting = useMemo(
    () => snapshot?.routing,
    [stableDep(snapshot?.routing)],
  );

  // Memoize learning field
  const memoizedLearning = useMemo(
    () => snapshot?.learning,
    [stableDep(snapshot?.learning)],
  );

  // Memoize background field
  const memoizedBackground = useMemo(
    () => snapshot?.background,
    [stableDep(snapshot?.background)],
  );

  // Memoize sessions field
  const memoizedSessions = useMemo(
    () => snapshot?.sessions,
    [stableDep(snapshot?.sessions)],
  );

  // Memoize channels field
  const memoizedChannels = useMemo(
    () => snapshot?.channels,
    [stableDep(snapshot?.channels)],
  );

  // Memoize nodes field
  const memoizedNodes = useMemo(
    () => snapshot?.nodes,
    [stableDep(snapshot?.nodes)],
  );

  // Memoize skills field
  const memoizedSkills = useMemo(
    () => snapshot?.skills,
    [stableDep(snapshot?.skills)],
  );

  // Memoize media field
  const memoizedMedia = useMemo(
    () => snapshot?.media,
    [stableDep(snapshot?.media)],
  );

  // Memoize canvas field
  const memoizedCanvas = useMemo(
    () => snapshot?.canvas,
    [stableDep(snapshot?.canvas)],
  );

  // Memoize security field
  const memoizedSecurity = useMemo(
    () => snapshot?.security,
    [stableDep(snapshot?.security)],
  );

  // Memoize doctor field
  const memoizedDoctor = useMemo(
    () => snapshot?.doctor,
    [stableDep(snapshot?.doctor)],
  );

  // Memoize simple fields
  const memoizedUpdatedAt = useMemo(
    () => snapshot?.updatedAt ?? '',
    [snapshot?.updatedAt],
  );
  const memoizedPolicyHash = useMemo(
    () => snapshot?.policyHash ?? '',
    [snapshot?.policyHash],
  );
  const memoizedConfigCenter = useMemo(
    () => snapshot?.configCenter,
    [stableDep(snapshot?.configCenter)],
  );
  const memoizedLoop = useMemo(
    () => snapshot?.loop,
    [stableDep(snapshot?.loop)],
  );
  const memoizedVoice = useMemo(
    () => snapshot?.voice,
    [stableDep(snapshot?.voice)],
  );
  const memoizedCompanion = useMemo(
    () => snapshot?.companion,
    [stableDep(snapshot?.companion)],
  );
  const memoizedStatusError = useMemo(
    () => snapshot?.statusError,
    [snapshot?.statusError],
  );

  // Return optimized snapshot with all memoized fields
  // If snapshot is null, return null
  return useMemo(
    () =>
      snapshot
        ? ({
            updatedAt: memoizedUpdatedAt,
            gateway: memoizedGateway,
            runtime: memoizedRuntime,
            daemon: memoizedDaemon,
            policyHash: memoizedPolicyHash,
            configCenter: memoizedConfigCenter,
            killSwitch: memoizedKillSwitch,
            nexus: memoizedNexus,
            safety: memoizedSafety,
            jobs: memoizedJobs,
            loop: memoizedLoop,
            autoflow: memoizedAutoflow,
            routing: memoizedRouting,
            learning: memoizedLearning,
            background: memoizedBackground,
            sessions: memoizedSessions,
            channels: memoizedChannels,
            nodes: memoizedNodes,
            skills: memoizedSkills,
            media: memoizedMedia,
            voice: memoizedVoice,
            canvas: memoizedCanvas,
            companion: memoizedCompanion,
            security: memoizedSecurity,
            doctor: memoizedDoctor,
            statusError: memoizedStatusError,
          } satisfies GatewaySnapshot)
        : null,
    [
      snapshot,
      memoizedUpdatedAt,
      memoizedGateway,
      memoizedRuntime,
      memoizedDaemon,
      memoizedPolicyHash,
      memoizedConfigCenter,
      memoizedKillSwitch,
      memoizedNexus,
      memoizedSafety,
      memoizedJobs,
      memoizedLoop,
      memoizedAutoflow,
      memoizedRouting,
      memoizedLearning,
      memoizedBackground,
      memoizedSessions,
      memoizedChannels,
      memoizedNodes,
      memoizedSkills,
      memoizedMedia,
      memoizedVoice,
      memoizedCanvas,
      memoizedCompanion,
      memoizedSecurity,
      memoizedDoctor,
      memoizedStatusError,
    ],
  );
}
