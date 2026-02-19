import type { ProactivityContextVector } from './context-vector';
import type { PsycheDecision, PsycheUrgency } from '../consult';
import type { SentinelState } from '../state-machine';

export type ProactivityAction =
  | 'send_now'
  | 'wait_5m'
  | 'wait_15m'
  | 'wait_30m'
  | 'skip';

export interface CounterfactualInput {
  state: SentinelState;
  urgency: PsycheUrgency;
  baseDecision: PsycheDecision;
  userInitiated: boolean;
  context: ProactivityContextVector;
}

export interface CounterfactualResult {
  action: ProactivityAction;
  waitSec: number;
  scoreNow: number;
  scoreWait: number;
  scores: Record<ProactivityAction, number>;
  reasonCodes: string[];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Number(value.toFixed(4))));
}

function get(map: Record<string, number>, key: string, fallback = 0): number {
  const value = map[key];
  if (!Number.isFinite(value)) return fallback;
  return value;
}

function interruptionCost(input: CounterfactualInput): number {
  const map = input.context.featureMap;
  const focusPressure =
    get(map, 'state_focus') * 0.34 +
    get(map, 'state_play') * 0.22 +
    get(map, 'state_unknown') * 0.26;
  const riskPenalty =
    get(map, 'risk_false_idle') * 0.14 +
    get(map, 'risk_probe_limited') * 0.09 +
    get(map, 'risk_drm_capture') * 0.06;
  const feedbackPenalty = get(map, 'negative_feedback_rate_24h') * 0.28;
  return clamp(focusPressure + riskPenalty + feedbackPenalty, 0, 1.2);
}

function expectedReplyValue(input: CounterfactualInput): number {
  const map = input.context.featureMap;
  const replyRate = get(map, 'reply_rate_24h');
  const resonance = get(map, 'resonance_score');
  const trust = get(map, 'trust_min_score');
  const fastBrain = get(map, 'fast_brain_score');
  const urgencyBoost =
    input.urgency === 'critical' ? 0.24 : input.urgency === 'high' ? 0.12 : 0;
  return clamp(
    replyRate * 0.36 +
      resonance * 0.28 +
      trust * 0.2 +
      fastBrain * 0.16 +
      urgencyBoost,
    0,
    1.4,
  );
}

function scoreForWait(
  input: CounterfactualInput,
  waitSec: number,
  nowScore: number,
): number {
  const map = input.context.featureMap;
  const focusPressure =
    get(map, 'state_focus') + get(map, 'state_play') + get(map, 'state_unknown');
  const waitGain = clamp(
    focusPressure * 0.22 +
      get(map, 'switch_norm') * 0.12 +
      get(map, 'negative_feedback_rate_24h') * 0.2,
    0,
    0.45,
  );
  const timeCost = clamp(waitSec / 3600, 0, 0.5);
  const urgencyPenalty =
    input.urgency === 'critical'
      ? 0.3
      : input.urgency === 'high'
        ? 0.17
        : input.urgency === 'medium'
          ? 0.07
          : 0.02;
  return clamp(nowScore + waitGain - timeCost - urgencyPenalty, -1, 1);
}

export function evaluateProactivityCounterfactual(
  input: CounterfactualInput,
): CounterfactualResult {
  if (input.userInitiated) {
    return {
      action: 'send_now',
      waitSec: 0,
      scoreNow: 1,
      scoreWait: 0,
      scores: {
        send_now: 1,
        wait_5m: 0,
        wait_15m: -0.1,
        wait_30m: -0.2,
        skip: -0.4,
      },
      reasonCodes: ['user_initiated'],
    };
  }
  if (input.baseDecision === 'deny') {
    return {
      action: 'skip',
      waitSec: 0,
      scoreNow: -1,
      scoreWait: -0.6,
      scores: {
        send_now: -1,
        wait_5m: -0.8,
        wait_15m: -0.7,
        wait_30m: -0.65,
        skip: -0.4,
      },
      reasonCodes: ['base_decision_deny'],
    };
  }

  const replyValue = expectedReplyValue(input);
  const cost = interruptionCost(input);
  const scoreNow = clamp(replyValue - cost, -1, 1);
  const scores: Record<ProactivityAction, number> = {
    send_now: scoreNow,
    wait_5m: scoreForWait(input, 5 * 60, scoreNow),
    wait_15m: scoreForWait(input, 15 * 60, scoreNow),
    wait_30m: scoreForWait(input, 30 * 60, scoreNow),
    skip: clamp(-0.25 - get(input.context.featureMap, 'reply_rate_24h') * 0.25, -1, 1),
  };

  let action: ProactivityAction = 'send_now';
  for (const candidate of ['wait_5m', 'wait_15m', 'wait_30m', 'skip'] as ProactivityAction[]) {
    if (scores[candidate] > scores[action]) action = candidate;
  }
  const waitSec =
    action === 'wait_5m'
      ? 5 * 60
      : action === 'wait_15m'
        ? 15 * 60
        : action === 'wait_30m'
          ? 30 * 60
          : 0;
  const reasonCodes: string[] = [];
  if (action !== 'send_now') reasonCodes.push(`choose_${action}`);
  if (get(input.context.featureMap, 'state_focus') > 0) reasonCodes.push('focus_pressure');
  if (get(input.context.featureMap, 'negative_feedback_rate_24h') >= 0.3) {
    reasonCodes.push('negative_feedback_guard');
  }
  if (get(input.context.featureMap, 'risk_false_idle') > 0) {
    reasonCodes.push('false_idle_uncertain');
  }
  return {
    action,
    waitSec,
    scoreNow: scores.send_now,
    scoreWait: Math.max(scores.wait_5m, scores.wait_15m, scores.wait_30m),
    scores,
    reasonCodes,
  };
}
