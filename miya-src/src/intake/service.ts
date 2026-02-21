import {
  flattenConfig,
  readConfig,
} from '../settings';
import { createIntakeId, readIntakeState, writeIntakeState } from './store';
import type {
  IntakeEvaluationEvent,
  IntakeListEntry,
  IntakeProposal,
  IntakeScope,
  IntakeSource,
  IntakeState,
  IntakeTrigger,
} from './types';

interface IntakeRuntimeConfig {
  enabled: boolean;
  autoWhitelistOnApprove: boolean;
  autoBlacklistOnReject: boolean;
  defaultRejectScope: IntakeScope;
  windowN: number;
  hardDenyWhenUsefulLessThanRejected: boolean;
  downrankThresholdRatioX100: number;
  downrankExplorePercent: number;
  silentAuditTrustScoreMin: number;
  sourceUnit: 'DOMAIN_PATH_PREFIX' | 'DOMAIN' | 'PATH_PREFIX';
}

export interface IntakeSourceInput {
  domain?: string;
  path?: string;
  selector?: string;
  contentHash?: string;
  sourceKey?: string;
  url?: string;
}

export interface ProposeIntakeInput {
  trigger: IntakeTrigger;
  source: IntakeSourceInput;
  summaryPoints?: string[];
  originalPlan?: string;
  suggestedChange?: string;
  benefits?: string[];
  risks?: string[];
  evidence?: string[];
  proposedChanges?: unknown;
}

export interface DecideIntakeInput {
  proposalId: string;
  decision:
    | 'approve'
    | 'approve_whitelist'
    | 'reject'
    | 'reject_blacklist'
    | 'reject_block_scope'
    | 'trial_once';
  scope?: IntakeScope;
  reason?: string;
}

interface ResolvedSource {
  source: IntakeSource;
  pageKey: string;
  pathPrefixKey: string;
  fingerprint: string;
  sourceUnitKey: string;
}

interface EvaluateInput {
  sourceUnitKey: string;
}

export interface IntakeStatsResult {
  sourceUnitKey: string;
  windowSize: number;
  usefulCount: number;
  rejectedCount: number;
  trialCount: number;
  consideredEvents: number;
  trustScore: number;
  verdict: 'insufficient_data' | 'hard_deny' | 'downrank' | 'normal';
  recommendedExplorePercent: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asScope(value: unknown, fallback: IntakeScope): IntakeScope {
  if (
    value === 'CONTENT_FINGERPRINT' ||
    value === 'PAGE' ||
    value === 'PATH_PREFIX' ||
    value === 'DOMAIN'
  ) {
    return value;
  }
  return fallback;
}

function asSourceUnit(
  value: unknown,
  fallback: 'DOMAIN_PATH_PREFIX' | 'DOMAIN' | 'PATH_PREFIX',
): 'DOMAIN_PATH_PREFIX' | 'DOMAIN' | 'PATH_PREFIX' {
  if (
    value === 'DOMAIN_PATH_PREFIX' ||
    value === 'DOMAIN' ||
    value === 'PATH_PREFIX'
  ) {
    return value;
  }
  return fallback;
}

function readIntakeConfig(projectDir: string): IntakeRuntimeConfig {
  const config = flattenConfig(readConfig(projectDir));
  return {
    enabled: asBool(config['intake.enabled'], true),
    autoWhitelistOnApprove: asBool(
      config['intake.policy.autoWhitelistOnApprove'],
      true,
    ),
    autoBlacklistOnReject: asBool(
      config['intake.policy.autoBlacklistOnReject'],
      true,
    ),
    defaultRejectScope: asScope(
      config['intake.policy.defaultRejectScope'],
      'CONTENT_FINGERPRINT',
    ),
    windowN: Math.max(1, Math.trunc(asNum(config['intake.stats.windowN'], 10))),
    hardDenyWhenUsefulLessThanRejected: asBool(
      config['intake.stats.hardDenyWhenUsefulLessThanRejected'],
      true,
    ),
    downrankThresholdRatioX100: Math.max(
      1,
      Math.trunc(asNum(config['intake.stats.downrankThresholdRatioX100'], 150)),
    ),
    downrankExplorePercent: Math.max(
      0,
      Math.min(
        100,
        Math.trunc(asNum(config['intake.stats.downrankExplorePercent'], 30)),
      ),
    ),
    silentAuditTrustScoreMin: Math.max(
      0,
      Math.min(
        1,
        asNum(config['intake.policy.silentAuditTrustScoreMin'], 85) / 100,
      ),
    ),
    sourceUnit: asSourceUnit(
      config['intake.stats.sourceUnit'],
      'DOMAIN_PATH_PREFIX',
    ),
  };
}

function normalizeDomain(input?: string, urlInput?: string): string {
  const raw = (input ?? '').trim();
  if (raw.length > 0) {
    const maybeUrl = raw.includes('://') ? raw : `https://${raw}`;
    try {
      return new URL(maybeUrl).hostname.toLowerCase();
    } catch {
      return raw
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .toLowerCase();
    }
  }

  const urlRaw = (urlInput ?? '').trim();
  if (urlRaw.length === 0) return 'unknown';
  try {
    return new URL(urlRaw).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
}

function normalizePath(input?: string, urlInput?: string): string {
  const raw = (input ?? '').trim();
  if (raw.length > 0) {
    const noQuery = raw.split('?')[0]?.split('#')[0] ?? raw;
    if (noQuery.startsWith('/')) return noQuery;
    return `/${noQuery}`;
  }

  const urlRaw = (urlInput ?? '').trim();
  if (urlRaw.length === 0) return '/';
  try {
    const pathname = new URL(urlRaw).pathname || '/';
    return pathname.startsWith('/') ? pathname : `/${pathname}`;
  } catch {
    return '/';
  }
}

function normalizePathPrefix(pathValue: string): string {
  const normalized = normalizePath(pathValue);
  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return '/';
  return `/${segments[0]}`;
}

function safeArray(input: unknown, limit = 10): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (!text) continue;
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function buildFingerprint(source: IntakeSource): string {
  return [
    source.domain,
    source.path,
    source.selector ?? '-',
    source.contentHash ?? '-',
  ].join('|');
}

function resolveSource(
  config: IntakeRuntimeConfig,
  sourceInput: IntakeSourceInput,
): ResolvedSource {
  const domain = normalizeDomain(sourceInput.domain, sourceInput.url);
  const pathValue = normalizePath(sourceInput.path, sourceInput.url);
  const selector = sourceInput.selector?.trim() || undefined;
  const contentHash = sourceInput.contentHash?.trim() || undefined;
  const sourceKey = sourceInput.sourceKey?.trim() || undefined;

  const source: IntakeSource = {
    domain,
    path: pathValue,
    selector,
    contentHash,
    sourceKey,
  };
  const pageKey = `${domain}${pathValue}`;
  const pathPrefix = normalizePathPrefix(pathValue);
  const pathPrefixKey = `${domain}${pathPrefix}`;
  const fingerprint = buildFingerprint(source);

  const sourceUnitKey =
    sourceKey && sourceKey.length > 0
      ? sourceKey
      : config.sourceUnit === 'DOMAIN'
        ? domain
        : config.sourceUnit === 'PATH_PREFIX'
          ? pathPrefixKey
          : pathPrefixKey;

  return {
    source,
    pageKey,
    pathPrefixKey,
    fingerprint,
    sourceUnitKey,
  };
}

function matchListEntry(
  entry: IntakeListEntry,
  source: ResolvedSource,
): boolean {
  if (entry.scope === 'CONTENT_FINGERPRINT') {
    return entry.value === source.fingerprint;
  }
  if (entry.scope === 'PAGE') {
    return entry.value === source.pageKey;
  }
  if (entry.scope === 'PATH_PREFIX') {
    return source.pageKey.startsWith(entry.value);
  }
  return entry.value === source.source.domain;
}

function addUniqueRule(
  list: IntakeListEntry[],
  scope: IntakeScope,
  value: string,
  reason: string,
): IntakeListEntry {
  const existing = list.find((entry) => entry.scope === scope && entry.value === value);
  if (existing) return existing;
  const next: IntakeListEntry = {
    id: createIntakeId('rule'),
    scope,
    value,
    reason,
    createdAt: nowIso(),
  };
  list.unshift(next);
  return next;
}

function scopeValueFromSource(scope: IntakeScope, source: ResolvedSource): string {
  if (scope === 'CONTENT_FINGERPRINT') return source.fingerprint;
  if (scope === 'PAGE') return source.pageKey;
  if (scope === 'PATH_PREFIX') return source.pathPrefixKey;
  return source.source.domain;
}

function appendEvent(
  state: IntakeState,
  event: Omit<IntakeEvaluationEvent, 'id' | 'timestamp'>,
): IntakeEvaluationEvent {
  const next: IntakeEvaluationEvent = {
    id: createIntakeId('event'),
    timestamp: nowIso(),
    ...event,
  };
  state.events.unshift(next);
  return next;
}

function findProposal(state: IntakeState, proposalId: string): IntakeProposal | undefined {
  return state.proposals.find((proposal) => proposal.id === proposalId);
}

function decideOutcome(decision: DecideIntakeInput['decision']): IntakeEvaluationEvent['outcome'] {
  if (decision === 'trial_once') return 'trial';
  if (decision.startsWith('approve')) return 'useful';
  return 'rejected';
}

function evaluateStatsForEvents(
  config: IntakeRuntimeConfig,
  sourceUnitKey: string,
  events: IntakeEvaluationEvent[],
): IntakeStatsResult {
  const related = events.filter((event) => event.sourceUnitKey === sourceUnitKey);
  const window = related.slice(0, config.windowN);
  const usefulCount = window.filter((event) => event.outcome === 'useful').length;
  const rejectedCount = window.filter((event) => event.outcome === 'rejected').length;
  const trialCount = window.filter((event) => event.outcome === 'trial').length;
  const considered = usefulCount + rejectedCount;
  const trustScore = considered > 0 ? usefulCount / considered : 0;

  let verdict: IntakeStatsResult['verdict'] = 'insufficient_data';
  let explorePercent = 100;

  if (considered >= config.windowN) {
    if (
      config.hardDenyWhenUsefulLessThanRejected &&
      usefulCount < rejectedCount
    ) {
      verdict = 'hard_deny';
      explorePercent = 0;
    } else if (
      rejectedCount > 0 &&
      usefulCount * 100 < config.downrankThresholdRatioX100 * rejectedCount
    ) {
      verdict = 'downrank';
      explorePercent = config.downrankExplorePercent;
    } else {
      verdict = 'normal';
      explorePercent = 100;
    }
  }

  return {
    sourceUnitKey,
    windowSize: config.windowN,
    usefulCount,
    rejectedCount,
    trialCount,
    consideredEvents: considered,
    trustScore,
    verdict,
    recommendedExplorePercent: explorePercent,
  };
}

export function listIntakeData(projectDir: string): IntakeState {
  return readIntakeState(projectDir);
}

export function proposeIntake(
  projectDir: string,
  input: ProposeIntakeInput,
): {
  status: 'disabled' | 'auto_allowed' | 'auto_rejected' | 'pending';
  proposal?: IntakeProposal;
  matchedRule?: IntakeListEntry;
  stats?: IntakeStatsResult;
} {
  const config = readIntakeConfig(projectDir);
  const state = readIntakeState(projectDir);
  const source = resolveSource(config, input.source);
  const stats = evaluateStatsForEvents(config, source.sourceUnitKey, state.events);

  if (!config.enabled) {
    return { status: 'disabled', stats };
  }

  const blackRule = state.blacklist.find((entry) => matchListEntry(entry, source));
  if (blackRule) {
    const proposal: IntakeProposal = {
      id: createIntakeId('intake'),
      status: 'auto_rejected',
      trigger: input.trigger,
      source: source.source,
      sourceFingerprint: source.fingerprint,
      sourceUnitKey: source.sourceUnitKey,
      summaryPoints: safeArray(input.summaryPoints, 3),
      originalPlan: (input.originalPlan ?? '').trim(),
      suggestedChange: (input.suggestedChange ?? '').trim(),
      benefits: safeArray(input.benefits),
      risks: safeArray(input.risks),
      evidence: safeArray(input.evidence, 20),
      proposedChanges: input.proposedChanges,
      requestedAt: nowIso(),
      resolvedAt: nowIso(),
      resolution: {
        decision: 'auto_rejected_by_blacklist',
        scope: blackRule.scope,
        reason: blackRule.reason,
      },
    };
    state.proposals.unshift(proposal);
    writeIntakeState(projectDir, state);
    return { status: 'auto_rejected', proposal, matchedRule: blackRule, stats };
  }

  const whiteRule = state.whitelist.find((entry) => matchListEntry(entry, source));
  if (whiteRule) {
    const proposal: IntakeProposal = {
      id: createIntakeId('intake'),
      status: 'auto_allowed',
      trigger: input.trigger,
      source: source.source,
      sourceFingerprint: source.fingerprint,
      sourceUnitKey: source.sourceUnitKey,
      summaryPoints: safeArray(input.summaryPoints, 3),
      originalPlan: (input.originalPlan ?? '').trim(),
      suggestedChange: (input.suggestedChange ?? '').trim(),
      benefits: safeArray(input.benefits),
      risks: safeArray(input.risks),
      evidence: safeArray(input.evidence, 20),
      proposedChanges: input.proposedChanges,
      requestedAt: nowIso(),
      resolvedAt: nowIso(),
      resolution: {
        decision: 'auto_allowed_by_whitelist',
        scope: whiteRule.scope,
        reason: whiteRule.reason,
      },
    };
    state.proposals.unshift(proposal);
    writeIntakeState(projectDir, state);
    return { status: 'auto_allowed', proposal, matchedRule: whiteRule, stats };
  }

  if (
    (input.trigger === 'directive_content' ||
      input.trigger === 'read_only_research') &&
    stats.consideredEvents >= Math.max(3, Math.floor(config.windowN / 2)) &&
    stats.trustScore >= config.silentAuditTrustScoreMin
  ) {
    const proposal: IntakeProposal = {
      id: createIntakeId('intake'),
      status: 'auto_allowed',
      trigger: input.trigger,
      source: source.source,
      sourceFingerprint: source.fingerprint,
      sourceUnitKey: source.sourceUnitKey,
      summaryPoints: safeArray(input.summaryPoints, 3),
      originalPlan: (input.originalPlan ?? '').trim(),
      suggestedChange: (input.suggestedChange ?? '').trim(),
      benefits: safeArray(input.benefits),
      risks: safeArray(input.risks),
      evidence: safeArray(input.evidence, 20),
      proposedChanges: input.proposedChanges,
      requestedAt: nowIso(),
      resolvedAt: nowIso(),
      resolution: {
        decision: 'auto_allowed_by_silent_threshold',
        scope: 'DOMAIN',
        reason: `trust_score=${stats.trustScore.toFixed(2)}`,
      },
    };
    state.proposals.unshift(proposal);
    appendEvent(state, {
      proposalId: proposal.id,
      sourceUnitKey: proposal.sourceUnitKey,
      sourceFingerprint: proposal.sourceFingerprint,
      outcome: 'useful',
      decision: 'auto_allowed_by_silent_threshold',
    });
    writeIntakeState(projectDir, state);
    return { status: 'auto_allowed', proposal, stats };
  }

  const proposal: IntakeProposal = {
    id: createIntakeId('intake'),
    status: 'pending',
    trigger: input.trigger,
    source: source.source,
    sourceFingerprint: source.fingerprint,
    sourceUnitKey: source.sourceUnitKey,
    summaryPoints: safeArray(input.summaryPoints, 3),
    originalPlan: (input.originalPlan ?? '').trim(),
    suggestedChange: (input.suggestedChange ?? '').trim(),
    benefits: safeArray(input.benefits),
    risks: safeArray(input.risks),
    evidence: safeArray(input.evidence, 20),
    proposedChanges: input.proposedChanges,
    requestedAt: nowIso(),
  };
  state.proposals.unshift(proposal);
  writeIntakeState(projectDir, state);
  return { status: 'pending', proposal, stats };
}

export function decideIntake(
  projectDir: string,
  input: DecideIntakeInput,
): {
  ok: boolean;
  message: string;
  proposal?: IntakeProposal;
  stats?: IntakeStatsResult;
  createdRule?: IntakeListEntry;
} {
  const config = readIntakeConfig(projectDir);
  const state = readIntakeState(projectDir);
  const proposal = findProposal(state, input.proposalId);
  if (!proposal) {
    return { ok: false, message: 'proposal_not_found' };
  }
  if (proposal.status !== 'pending') {
    return { ok: false, message: `proposal_not_pending:${proposal.status}`, proposal };
  }

  const resolvedSource = resolveSource(config, proposal.source);
  let createdRule: IntakeListEntry | undefined;
  let nextStatus: IntakeProposal['status'] = 'pending';
  let scope: IntakeScope | undefined;
  const reason = input.reason?.trim() || input.decision;

  if (input.decision === 'trial_once') {
    nextStatus = 'trial';
  } else if (input.decision === 'approve_whitelist') {
    nextStatus = 'approved';
    scope = 'CONTENT_FINGERPRINT';
    createdRule = addUniqueRule(
      state.whitelist,
      scope,
      scopeValueFromSource(scope, resolvedSource),
      reason,
    );
  } else if (input.decision === 'approve') {
    nextStatus = 'approved';
    if (config.autoWhitelistOnApprove) {
      scope = 'CONTENT_FINGERPRINT';
      createdRule = addUniqueRule(
        state.whitelist,
        scope,
        scopeValueFromSource(scope, resolvedSource),
        reason,
      );
    }
  } else if (input.decision === 'reject_block_scope') {
    nextStatus = 'rejected';
    scope = input.scope ?? config.defaultRejectScope;
    createdRule = addUniqueRule(
      state.blacklist,
      scope,
      scopeValueFromSource(scope, resolvedSource),
      reason,
    );
  } else if (input.decision === 'reject_blacklist') {
    nextStatus = 'rejected';
    scope = 'CONTENT_FINGERPRINT';
    createdRule = addUniqueRule(
      state.blacklist,
      scope,
      scopeValueFromSource(scope, resolvedSource),
      reason,
    );
  } else {
    nextStatus = 'rejected';
    if (config.autoBlacklistOnReject) {
      scope = config.defaultRejectScope;
      createdRule = addUniqueRule(
        state.blacklist,
        scope,
        scopeValueFromSource(scope, resolvedSource),
        reason,
      );
    }
  }

  proposal.status = nextStatus;
  proposal.resolvedAt = nowIso();
  proposal.resolution = {
    decision: input.decision,
    scope,
    reason,
  };

  appendEvent(state, {
    proposalId: proposal.id,
    sourceUnitKey: proposal.sourceUnitKey,
    sourceFingerprint: proposal.sourceFingerprint,
    outcome: decideOutcome(input.decision),
    decision: input.decision,
  });

  const stats = evaluateStatsForEvents(config, proposal.sourceUnitKey, state.events);
  writeIntakeState(projectDir, state);

  return {
    ok: true,
    message: 'ok',
    proposal,
    createdRule,
    stats,
  };
}

export function intakeStats(
  projectDir: string,
  input: EvaluateInput,
): IntakeStatsResult {
  const config = readIntakeConfig(projectDir);
  const state = readIntakeState(projectDir);
  return evaluateStatsForEvents(config, input.sourceUnitKey, state.events);
}

export function resolveSourceUnitKey(
  projectDir: string,
  source: IntakeSourceInput,
): string {
  const config = readIntakeConfig(projectDir);
  return resolveSource(config, source).sourceUnitKey;
}

export function intakeSummary(projectDir: string): {
  pending: number;
  whitelist: number;
  blacklist: number;
  recentEvents: IntakeEvaluationEvent[];
  pendingItems: IntakeProposal[];
} {
  const state = readIntakeState(projectDir);
  return {
    pending: state.proposals.filter((item) => item.status === 'pending').length,
    whitelist: state.whitelist.length,
    blacklist: state.blacklist.length,
    recentEvents: state.events.slice(0, 20),
    pendingItems: state.proposals
      .filter((item) => item.status === 'pending')
      .slice(0, 20),
  };
}

