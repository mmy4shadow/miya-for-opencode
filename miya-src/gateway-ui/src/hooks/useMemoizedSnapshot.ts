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

/**
 * Memoize GatewaySnapshot with deep comparison
 * 
 * Each top-level field is memoized independently, so only components
 * depending on changed fields will re-render.
 * 
 * @param snapshot - The raw snapshot from GatewayProvider
 * @returns Optimized snapshot with memoized fields
 */
export function useMemoizedSnapshot(snapshot: GatewaySnapshot | null): GatewaySnapshot | null {
  // Memoize gateway field
  const memoizedGateway = useMemo(
    () => snapshot?.gateway,
    [
      snapshot?.gateway?.url ?? null,
      snapshot?.gateway?.port ?? null,
      snapshot?.gateway?.pid ?? null,
      snapshot?.gateway?.startedAt ?? null,
      snapshot?.gateway?.status ?? null,
    ]
  );

  // Memoize runtime field
  const memoizedRuntime = useMemo(
    () => snapshot?.runtime,
    [
      snapshot?.runtime?.isOwner ?? null,
      snapshot?.runtime?.ownerPID ?? null,
      snapshot?.runtime?.ownerFresh ?? null,
      snapshot?.runtime?.activeAgentId ?? null,
      snapshot?.runtime?.storageRevision ?? null,
    ]
  );

  // Memoize daemon field
  const memoizedDaemon = useMemo(
    () => snapshot?.daemon,
    [
      snapshot?.daemon?.connected ?? null,
      snapshot?.daemon?.cpuPercent ?? null,
      snapshot?.daemon?.memoryMB ?? null,
      snapshot?.daemon?.activeJobID ?? null,
      snapshot?.daemon?.psycheSignalHub?.running ?? null,
      snapshot?.daemon?.psycheSignalHub?.sequenceNo ?? null,
      snapshot?.daemon?.psycheSignalHub?.sampledAt ?? null,
      snapshot?.daemon?.psycheSignalHub?.latencyMs ?? null,
    ]
  );

  // Memoize killSwitch field
  const memoizedKillSwitch = useMemo(
    () => snapshot?.killSwitch,
    [
      snapshot?.killSwitch?.active ?? null,
      snapshot?.killSwitch?.reason ?? null,
    ]
  );

  // Memoize nexus field (complex object with many sub-fields)
  const memoizedNexus = useMemo(
    () => snapshot?.nexus,
    [
      snapshot?.nexus?.sessionId ?? null,
      snapshot?.nexus?.activeTool ?? null,
      snapshot?.nexus?.permission ?? null,
      snapshot?.nexus?.pendingTickets ?? null,
      snapshot?.nexus?.killSwitchMode ?? null,
      snapshot?.nexus?.guardianSafeHoldReason ?? null,
      // Trust snapshot
      snapshot?.nexus?.trust?.target ?? null,
      snapshot?.nexus?.trust?.source ?? null,
      snapshot?.nexus?.trust?.action ?? null,
      snapshot?.nexus?.trust?.minScore ?? null,
      snapshot?.nexus?.trust?.tier ?? null,
      // Trust mode config
      snapshot?.nexus?.trustMode?.silentMin ?? null,
      snapshot?.nexus?.trustMode?.modalMax ?? null,
      // Psyche mode config (many fields)
      snapshot?.nexus?.psycheMode?.resonanceEnabled ?? null,
      snapshot?.nexus?.psycheMode?.captureProbeEnabled ?? null,
      snapshot?.nexus?.psycheMode?.signalOverrideEnabled ?? null,
      snapshot?.nexus?.psycheMode?.proactivityExploreRate ?? null,
      snapshot?.nexus?.psycheMode?.slowBrainEnabled ?? null,
      snapshot?.nexus?.psycheMode?.slowBrainShadowEnabled ?? null,
      snapshot?.nexus?.psycheMode?.slowBrainShadowRollout ?? null,
      snapshot?.nexus?.psycheMode?.periodicRetrainEnabled ?? null,
      snapshot?.nexus?.psycheMode?.proactivePingEnabled ?? null,
      snapshot?.nexus?.psycheMode?.proactivePingMinIntervalMinutes ?? null,
      snapshot?.nexus?.psycheMode?.proactivePingMaxPerDay ?? null,
      snapshot?.nexus?.psycheMode?.quietHoursEnabled ?? null,
      snapshot?.nexus?.psycheMode?.quietHoursStart ?? null,
      snapshot?.nexus?.psycheMode?.quietHoursEnd ?? null,
      snapshot?.nexus?.psycheMode?.quietHoursTimezoneOffset ?? null,
      // Learning gate config
      snapshot?.nexus?.learningGate?.candidateMode ?? null,
      snapshot?.nexus?.learningGate?.persistentRequiresApproval ?? null,
      // Insights array - use JSON.stringify for deep comparison
      JSON.stringify(snapshot?.nexus?.insights ?? null),
    ]
  );

  // Memoize safety field
  const memoizedSafety = useMemo(
    () => snapshot?.safety,
    [JSON.stringify(snapshot?.safety?.recentSelfApproval ?? null)]
  );

  // Memoize jobs field
  const memoizedJobs = useMemo(
    () => snapshot?.jobs,
    [
      snapshot?.jobs?.total ?? null,
      snapshot?.jobs?.enabled ?? null,
      snapshot?.jobs?.pendingApprovals ?? null,
      JSON.stringify(snapshot?.jobs?.recentRuns ?? null),
    ]
  );

  // Memoize autoflow field
  const memoizedAutoflow = useMemo(
    () => snapshot?.autoflow,
    [
      snapshot?.autoflow?.active ?? null,
      JSON.stringify(snapshot?.autoflow?.sessions ?? null),
      snapshot?.autoflow?.persistent?.enabled ?? null,
      snapshot?.autoflow?.persistent?.resumeCooldownMs ?? null,
      snapshot?.autoflow?.persistent?.maxAutoResumes ?? null,
      snapshot?.autoflow?.persistent?.maxConsecutiveResumeFailures ?? null,
      snapshot?.autoflow?.persistent?.resumeTimeoutMs ?? null,
      JSON.stringify(snapshot?.autoflow?.persistent?.sessions ?? null),
    ]
  );

  // Memoize routing field
  const memoizedRouting = useMemo(
    () => snapshot?.routing,
    [
      snapshot?.routing?.ecoMode ?? null,
      snapshot?.routing?.forcedStage ?? null,
      JSON.stringify(snapshot?.routing?.cost ?? null),
      JSON.stringify(snapshot?.routing?.recent ?? null),
    ]
  );

  // Memoize learning field
  const memoizedLearning = useMemo(
    () => snapshot?.learning,
    [
      JSON.stringify(snapshot?.learning?.stats ?? null),
      JSON.stringify(snapshot?.learning?.topDrafts ?? null),
    ]
  );

  // Memoize background field
  const memoizedBackground = useMemo(
    () => snapshot?.background,
    [
      snapshot?.background?.total ?? null,
      snapshot?.background?.running ?? null,
      JSON.stringify(snapshot?.background?.tasks ?? null),
    ]
  );

  // Memoize sessions field
  const memoizedSessions = useMemo(
    () => snapshot?.sessions,
    [
      snapshot?.sessions?.total ?? null,
      snapshot?.sessions?.active ?? null,
      snapshot?.sessions?.queued ?? null,
      snapshot?.sessions?.muted ?? null,
      JSON.stringify(snapshot?.sessions?.items ?? null),
    ]
  );

  // Memoize channels field
  const memoizedChannels = useMemo(
    () => snapshot?.channels,
    [
      JSON.stringify(snapshot?.channels?.states ?? null),
      JSON.stringify(snapshot?.channels?.pendingPairs ?? null),
      JSON.stringify(snapshot?.channels?.recentOutbound ?? null),
    ]
  );

  // Memoize nodes field
  const memoizedNodes = useMemo(
    () => snapshot?.nodes,
    [
      snapshot?.nodes?.total ?? null,
      snapshot?.nodes?.connected ?? null,
      snapshot?.nodes?.pendingPairs ?? null,
      JSON.stringify(snapshot?.nodes?.list ?? null),
      JSON.stringify(snapshot?.nodes?.devices ?? null),
      JSON.stringify(snapshot?.nodes?.invokes ?? null),
    ]
  );

  // Memoize skills field
  const memoizedSkills = useMemo(
    () => snapshot?.skills,
    [
      JSON.stringify(snapshot?.skills?.enabled ?? null),
      JSON.stringify(snapshot?.skills?.discovered ?? null),
    ]
  );

  // Memoize media field
  const memoizedMedia = useMemo(
    () => snapshot?.media,
    [
      snapshot?.media?.total ?? null,
      JSON.stringify(snapshot?.media?.recent ?? null),
    ]
  );

  // Memoize canvas field
  const memoizedCanvas = useMemo(
    () => snapshot?.canvas,
    [
      snapshot?.canvas?.activeDocID ?? null,
      JSON.stringify(snapshot?.canvas?.docs ?? null),
      JSON.stringify(snapshot?.canvas?.events ?? null),
    ]
  );

  // Memoize security field
  const memoizedSecurity = useMemo(
    () => snapshot?.security,
    [JSON.stringify(snapshot?.security?.ownerIdentity ?? null)]
  );

  // Memoize doctor field
  const memoizedDoctor = useMemo(
    () => snapshot?.doctor,
    [JSON.stringify(snapshot?.doctor?.issues ?? null)]
  );

  // Memoize simple fields
  const memoizedUpdatedAt = useMemo(() => snapshot?.updatedAt, [snapshot?.updatedAt]);
  const memoizedPolicyHash = useMemo(() => snapshot?.policyHash, [snapshot?.policyHash]);
  const memoizedConfigCenter = useMemo(
    () => snapshot?.configCenter,
    [JSON.stringify(snapshot?.configCenter)]
  );
  const memoizedLoop = useMemo(() => snapshot?.loop, [JSON.stringify(snapshot?.loop)]);
  const memoizedVoice = useMemo(() => snapshot?.voice, [JSON.stringify(snapshot?.voice)]);
  const memoizedCompanion = useMemo(() => snapshot?.companion, [JSON.stringify(snapshot?.companion)]);
  const memoizedStatusError = useMemo(() => snapshot?.statusError, [snapshot?.statusError]);

  // Return optimized snapshot with all memoized fields
  // If snapshot is null, return null
  return useMemo(
    () => snapshot ? ({
      updatedAt: memoizedUpdatedAt!,
      gateway: memoizedGateway!,
      runtime: memoizedRuntime!,
      daemon: memoizedDaemon!,
      policyHash: memoizedPolicyHash!,
      configCenter: memoizedConfigCenter!,
      killSwitch: memoizedKillSwitch!,
      nexus: memoizedNexus!,
      safety: memoizedSafety!,
      jobs: memoizedJobs!,
      loop: memoizedLoop!,
      autoflow: memoizedAutoflow!,
      routing: memoizedRouting!,
      learning: memoizedLearning!,
      background: memoizedBackground!,
      sessions: memoizedSessions!,
      channels: memoizedChannels!,
      nodes: memoizedNodes!,
      skills: memoizedSkills!,
      media: memoizedMedia!,
      voice: memoizedVoice!,
      canvas: memoizedCanvas!,
      companion: memoizedCompanion!,
      security: memoizedSecurity!,
      doctor: memoizedDoctor!,
      statusError: memoizedStatusError,
    }) : null,
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
    ]
  );
}
