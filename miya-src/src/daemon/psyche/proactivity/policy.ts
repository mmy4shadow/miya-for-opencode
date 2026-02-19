import * as fs from 'node:fs';
import type { ProactivityContextVector } from './context-vector';
import {
  evaluateProactivityCounterfactual,
  type ProactivityAction,
} from './counterfactual';
import type { PsycheDecision, PsycheUrgency } from '../consult';
import type { SentinelState } from '../state-machine';

export interface ProactivityPolicyInput {
  at: string;
  intent: string;
  channel?: string;
  userInitiated: boolean;
  urgency: PsycheUrgency;
  state: SentinelState;
  baseDecision: PsycheDecision;
  context: ProactivityContextVector;
}

export interface ProactivityPolicyResult {
  action: ProactivityAction;
  decision: PsycheDecision;
  waitSec: number;
  scoreNow: number;
  scoreWait: number;
  reasonCodes: string[];
  scores: Record<ProactivityAction, number>;
}

export interface ProactivityDecisionLog {
  at: string;
  intent: string;
  channel?: string;
  userInitiated: boolean;
  urgency: PsycheUrgency;
  state: SentinelState;
  baseDecision: PsycheDecision;
  action: ProactivityAction;
  decision: PsycheDecision;
  waitSec: number;
  scoreNow: number;
  scoreWait: number;
  reasonCodes: string[];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Number(value.toFixed(4))));
}

export function resolveProactivityPolicy(
  input: ProactivityPolicyInput,
): ProactivityPolicyResult {
  const counterfactual = evaluateProactivityCounterfactual({
    state: input.state,
    urgency: input.urgency,
    baseDecision: input.baseDecision,
    userInitiated: input.userInitiated,
    context: input.context,
  });
  let decision: PsycheDecision = input.baseDecision;
  let action: ProactivityAction = counterfactual.action;
  let waitSec = counterfactual.waitSec;

  // Keep hard deny unchanged.
  if (input.baseDecision === 'deny') {
    decision = 'deny';
    action = 'skip';
    waitSec = 0;
  } else if (input.userInitiated) {
    decision = 'allow';
    action = 'send_now';
    waitSec = 0;
  } else if (input.urgency === 'critical' && input.baseDecision === 'allow') {
    decision = 'allow';
    action = 'send_now';
    waitSec = 0;
  } else if (input.baseDecision === 'allow') {
    if (counterfactual.action === 'skip') {
      decision = 'defer';
      action = 'wait_30m';
      waitSec = 30 * 60;
    } else if (counterfactual.action !== 'send_now') {
      decision = 'defer';
      action = counterfactual.action;
      waitSec = counterfactual.waitSec;
    }
  } else if (input.baseDecision === 'defer') {
    // Preserve safe-hold defaults; only extend retry hint when model strongly prefers longer wait.
    if (counterfactual.action === 'wait_30m') {
      waitSec = Math.max(waitSec, 30 * 60);
    } else if (counterfactual.action === 'wait_15m') {
      waitSec = Math.max(waitSec, 15 * 60);
    } else {
      waitSec = Math.max(waitSec, 5 * 60);
    }
    decision = 'defer';
  }
  return {
    action,
    decision,
    waitSec: Math.max(0, Math.floor(waitSec)),
    scoreNow: clamp(counterfactual.scoreNow, -1, 1),
    scoreWait: clamp(counterfactual.scoreWait, -1, 1),
    reasonCodes: counterfactual.reasonCodes.slice(0, 8),
    scores: counterfactual.scores,
  };
}

export function appendProactivityDecision(
  filePath: string,
  row: ProactivityDecisionLog,
): void {
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf-8');
}
