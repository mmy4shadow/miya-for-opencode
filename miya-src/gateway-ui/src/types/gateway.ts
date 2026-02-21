/**
 * Gateway UI Type Definitions
 *
 * These types mirror the backend GatewaySnapshot structure
 * to maintain backward compatibility (Requirement 13.1, 13.2)
 */

export interface NexusTrustSnapshot {
  target: number;
  source: number;
  action: number;
  minScore: number;
  tier: 'high' | 'medium' | 'low';
}

export interface TrustModeConfig {
  silentMin: number;
  modalMax: number;
}

export interface PsycheModeConfig {
  resonanceEnabled: boolean;
  captureProbeEnabled: boolean;
  signalOverrideEnabled?: boolean;
  proactivityExploreRate?: number;
  slowBrainEnabled?: boolean;
  slowBrainShadowEnabled?: boolean;
  slowBrainShadowRollout?: number;
  periodicRetrainEnabled?: boolean;
  proactivePingEnabled?: boolean;
  proactivePingMinIntervalMinutes?: number;
  proactivePingMaxPerDay?: number;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  quietHoursTimezoneOffset?: number;
}

export interface LearningGateConfig {
  candidateMode: 'toast_gate' | 'silent_audit';
  persistentRequiresApproval: boolean;
}

export type KillSwitchMode =
  | 'all_stop'
  | 'outbound_only'
  | 'desktop_only'
  | 'off';

export interface PolicyDomainRow {
  domain: string;
  label: string;
  paused: boolean;
}

export interface GatewaySnapshot {
  updatedAt: string;
  gateway: {
    url: string;
    port: number;
    pid: number;
    startedAt: string;
    status: 'online' | 'offline' | 'error';
  };
  runtime: {
    isOwner: boolean;
    ownerPID?: number;
    ownerFresh: boolean;
    activeAgentId?: string;
    storageRevision: number;
  };
  daemon: {
    connected: boolean;
    cpuPercent?: number;
    memoryMB?: number;
    activeJobID?: string;
    psycheSignalHub?: {
      running: boolean;
      sequenceNo?: number;
      sampledAt?: string;
      latencyMs?: number;
    };
  };
  policyHash: string;
  configCenter: Record<string, unknown>;
  killSwitch: {
    active: boolean;
    reason?: string;
  };
  nexus: {
    sessionId: string;
    activeTool?: string;
    permission?: string;
    pendingTickets: number;
    killSwitchMode: KillSwitchMode;
    insights: Array<{ at: string; text: string; auditID?: string }>;
    trust?: NexusTrustSnapshot;
    trustMode: TrustModeConfig;
    psycheMode: PsycheModeConfig;
    learningGate: LearningGateConfig;
    guardianSafeHoldReason?: string;
  };
  safety: {
    recentSelfApproval: unknown[];
  };
  jobs: {
    total: number;
    enabled: number;
    pendingApprovals: number;
    recentRuns: unknown[];
  };
  loop: unknown;
  autoflow: {
    active: number;
    sessions: Array<{
      sessionID: string;
      phase: string;
      goal: string;
      fixRound: number;
      maxFixRounds: number;
      updatedAt: string;
      progressPct: number;
      retryReason?: string;
      lastError?: string;
      lastDag?: {
        total: number;
        completed: number;
        failed: number;
        blocked: number;
      };
    }>;
    persistent: {
      enabled: boolean;
      resumeCooldownMs: number;
      maxAutoResumes: number;
      maxConsecutiveResumeFailures: number;
      resumeTimeoutMs: number;
      sessions: Array<{
        sessionID: string;
        resumeAttempts: number;
        resumeFailures: number;
        userStopped: boolean;
        lastOutcomePhase?: string;
        lastOutcomeSummary?: string;
      }>;
    };
  };
  routing: {
    ecoMode: boolean;
    forcedStage?: string;
    cost: unknown;
    recent: unknown[];
  };
  learning: {
    stats: unknown;
    topDrafts: Array<{
      id: string;
      status: string;
      source: string;
      confidence: number;
      uses: number;
      hitRate: number;
      title: string;
    }>;
  };
  background: {
    total: number;
    running: number;
    tasks: Array<{
      id: string;
      description: string;
      agent: string;
      status: string;
      startedAt: string;
      completedAt?: string;
    }>;
  };
  sessions: {
    total: number;
    active: number;
    queued: number;
    muted: number;
    items: unknown[];
  };
  channels: {
    states: unknown[];
    pendingPairs: unknown[];
    recentOutbound: Array<{
      id: string;
      timestamp: string;
      channel: string;
      target: string;
      sendStatus: string;
      evidenceConfidence?: number;
      preScreenshot?: string;
      postScreenshot?: string;
    }>;
  };
  nodes: {
    total: number;
    connected: number;
    pendingPairs: number;
    list: Array<{
      id: string;
      label: string;
      connected: boolean;
      platform: string;
      updatedAt: string;
    }>;
    devices: unknown[];
    invokes: unknown[];
  };
  skills: {
    enabled: string[];
    discovered: unknown[];
  };
  media: {
    total: number;
    recent: unknown[];
  };
  voice: unknown;
  canvas: {
    activeDocID?: string;
    docs: unknown[];
    events: unknown[];
  };
  companion: unknown;
  security: {
    ownerIdentity: unknown;
  };
  doctor: {
    issues: Array<{
      code: string;
      severity: 'info' | 'warn' | 'error';
      message: string;
      fix: string;
    }>;
  };
  statusError?: string;
}
