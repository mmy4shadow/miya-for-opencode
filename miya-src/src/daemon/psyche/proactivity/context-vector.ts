import type { InteractionStatsSnapshot } from './interaction-stats';
import type {
  PsycheRiskSummary,
  PsycheUrgency,
} from '../consult';
import type { SentinelSignals, SentinelState } from '../state-machine';
import type { TrustTier } from '../trust';

export interface ProactivityContextInput {
  atMs: number;
  state: SentinelState;
  urgency: PsycheUrgency;
  userInitiated: boolean;
  fastBrainScore: number;
  resonanceScore: number;
  trustMinScore: number;
  trustTier: TrustTier;
  risk: PsycheRiskSummary;
  signals?: SentinelSignals;
  interaction: InteractionStatsSnapshot;
}

export interface ProactivityContextVector {
  vector: number[];
  featureMap: Record<string, number>;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function z01(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) return 0;
  return clamp01((value - min) / (max - min));
}

function stateOneHot(state: SentinelState): Record<string, number> {
  return {
    state_focus: state === 'FOCUS' ? 1 : 0,
    state_consume: state === 'CONSUME' ? 1 : 0,
    state_play: state === 'PLAY' ? 1 : 0,
    state_away: state === 'AWAY' ? 1 : 0,
    state_unknown: state === 'UNKNOWN' ? 1 : 0,
  };
}

function urgencyOneHot(urgency: PsycheUrgency): Record<string, number> {
  return {
    urgency_low: urgency === 'low' ? 1 : 0,
    urgency_medium: urgency === 'medium' ? 1 : 0,
    urgency_high: urgency === 'high' ? 1 : 0,
    urgency_critical: urgency === 'critical' ? 1 : 0,
  };
}

function trustTierOneHot(tier: TrustTier): Record<string, number> {
  return {
    trust_tier_high: tier === 'high' ? 1 : 0,
    trust_tier_medium: tier === 'medium' ? 1 : 0,
    trust_tier_low: tier === 'low' ? 1 : 0,
  };
}

function cyclicalTimeFeatures(atMs: number): Record<string, number> {
  const date = new Date(atMs);
  const hour = date.getUTCHours();
  const day = date.getUTCDay();
  const hourRad = (2 * Math.PI * hour) / 24;
  const dayRad = (2 * Math.PI * day) / 7;
  return {
    hour_sin: Number(Math.sin(hourRad).toFixed(4)),
    hour_cos: Number(Math.cos(hourRad).toFixed(4)),
    day_sin: Number(Math.sin(dayRad).toFixed(4)),
    day_cos: Number(Math.cos(dayRad).toFixed(4)),
  };
}

export function buildProactivityContextVector(
  input: ProactivityContextInput,
): ProactivityContextVector {
  const signals = input.signals ?? {};
  const map: Record<string, number> = {
    ...stateOneHot(input.state),
    ...urgencyOneHot(input.urgency),
    ...trustTierOneHot(input.trustTier),
    ...cyclicalTimeFeatures(input.atMs),
    user_initiated: input.userInitiated ? 1 : 0,
    fast_brain_score: clamp01(input.fastBrainScore),
    resonance_score: clamp01(input.resonanceScore),
    trust_min_score: clamp01(z01(input.trustMinScore, 0, 100)),
    risk_false_idle: input.risk.falseIdleUncertain ? 1 : 0,
    risk_drm_capture: input.risk.drmCaptureBlocked ? 1 : 0,
    risk_probe_limited: input.risk.probeRateLimited ? 1 : 0,
    risk_probe_requested: input.risk.probeRequested ? 1 : 0,
    idle_norm: z01(Number(signals.idleSec ?? 0), 0, 900),
    apm_norm: z01(Number(signals.apm ?? 0), 0, 240),
    switch_norm: z01(Number(signals.windowSwitchPerMin ?? 0), 0, 40),
    audio_active: signals.audioActive || signals.audioSessionActive ? 1 : 0,
    fullscreen: signals.fullscreen ? 1 : 0,
    gamepad_active: signals.gamepadActive || signals.xinputActive ? 1 : 0,
    raw_input_active: signals.rawInputActive ? 1 : 0,
    reply_rate_24h: clamp01(input.interaction.window24h.replyRate),
    user_initiated_rate_24h: clamp01(input.interaction.window24h.userInitiatedRate),
    negative_feedback_rate_24h: clamp01(
      input.interaction.window24h.negativeFeedbackRate,
    ),
    proactive_allow_1h_norm: z01(input.interaction.window1h.proactiveAllows, 0, 20),
    proactive_defer_1h_norm: z01(input.interaction.window1h.proactiveDefers, 0, 20),
    proactive_allow_24h_norm: z01(input.interaction.window24h.proactiveAllows, 0, 120),
    proactive_defer_24h_norm: z01(input.interaction.window24h.proactiveDefers, 0, 120),
    delivered_24h_norm: z01(input.interaction.window24h.delivered, 0, 80),
    outcomes_24h_norm: z01(input.interaction.window24h.outcomes, 0, 120),
    median_reply_norm: z01(Number(input.interaction.window24h.medianReplySec ?? 0), 0, 1800),
  };
  const keys = Object.keys(map).sort();
  const vector = keys.map((key) => map[key] ?? 0);
  return {
    vector,
    featureMap: map,
  };
}
