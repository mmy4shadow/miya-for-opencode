import * as fs from 'node:fs';
import type { PsycheDecision, PsycheUrgency } from './consult';
import type { SentinelSignals, SentinelState } from './state-machine';

function nowUnixSec(): number {
  return Math.floor(Date.now() / 1000);
}

function appendJsonl(path: string, payload: unknown): void {
  fs.appendFileSync(path, `${JSON.stringify(payload)}\n`, 'utf-8');
}

export function appendPsycheObservation(
  trainingDataLogPath: string,
  input: {
    at: string;
    state: SentinelState;
    intent: string;
    urgency: PsycheUrgency;
    channel?: string;
    userInitiated: boolean;
    confidence: number;
    decision: PsycheDecision;
    shouldProbeScreen: boolean;
    reasons: string[];
    signals?: SentinelSignals;
  },
): void {
  appendJsonl(trainingDataLogPath, {
    t: nowUnixSec(),
    type: 'observation',
    obs: {
      at: input.at,
      state: input.state,
      intent: input.intent,
      urgency: input.urgency,
      channel: input.channel ?? 'none',
      userInitiated: input.userInitiated,
      confidence: input.confidence,
      decision: input.decision,
      shouldProbeScreen: input.shouldProbeScreen,
      reasons: input.reasons,
      signals: input.signals ?? {},
    },
  });
}

export function appendPsycheOutcome(
  trainingDataLogPath: string,
  input: {
    at: string;
    consultAuditID: string;
    state: SentinelState;
    intent: string;
    urgency: PsycheUrgency;
    channel?: string;
    userInitiated: boolean;
    delivered: boolean;
    blockedReason?: string;
    explicitFeedback: 'positive' | 'negative' | 'none';
    userReplyWithinSec?: number;
    score: number;
    reward: 'positive' | 'negative';
  },
): void {
  appendJsonl(trainingDataLogPath, {
    t: nowUnixSec(),
    type: 'action_outcome',
    action: {
      at: input.at,
      consultAuditID: input.consultAuditID,
      state: input.state,
      intent: input.intent,
      urgency: input.urgency,
      channel: input.channel ?? 'none',
      userInitiated: input.userInitiated,
      delivered: input.delivered,
      blockedReason: input.blockedReason ?? '',
      explicitFeedback: input.explicitFeedback,
      userReplyWithinSec: input.userReplyWithinSec,
      score: Number(input.score.toFixed(3)),
      reward: input.reward,
    },
  });
}
