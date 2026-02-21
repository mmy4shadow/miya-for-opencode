export type NegotiationFixability =
  | 'impossible'
  | 'rewrite'
  | 'reduce_scope'
  | 'need_evidence'
  | 'retry_later';

export interface NegotiationBudget {
  autoRetry: number;
  humanEdit: number;
}

export interface NegotiationBudgetState {
  key: string;
  fixability: NegotiationFixability;
  budget: NegotiationBudget;
  autoUsed: number;
  humanUsed: number;
  updatedAt: string;
}

export interface ApplyNegotiationBudgetInput {
  key: string;
  fixability: NegotiationFixability;
  budget: NegotiationBudget;
  attemptType?: 'auto' | 'human';
}

export interface ApplyNegotiationBudgetResult {
  allowed: boolean;
  state: NegotiationBudgetState;
  reason?:
    | 'fixability_impossible'
    | 'auto_retry_exhausted'
    | 'human_edit_exhausted';
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeBudget(input: NegotiationBudget): NegotiationBudget {
  const autoRetry = Number.isFinite(input.autoRetry)
    ? Math.max(0, Math.floor(input.autoRetry))
    : 0;
  const humanEdit = Number.isFinite(input.humanEdit)
    ? Math.max(0, Math.floor(input.humanEdit))
    : 0;
  return { autoRetry, humanEdit };
}

export function applyNegotiationBudget(
  store: Map<string, NegotiationBudgetState>,
  input: ApplyNegotiationBudgetInput,
): ApplyNegotiationBudgetResult {
  const budget = sanitizeBudget(input.budget);
  const fixability = input.fixability;
  const existing = store.get(input.key);
  const state: NegotiationBudgetState = existing
    ? {
        ...existing,
        fixability,
        budget:
          fixability === 'impossible' ? { autoRetry: 0, humanEdit: 0 } : budget,
        updatedAt: nowIso(),
      }
    : {
        key: input.key,
        fixability,
        budget:
          fixability === 'impossible' ? { autoRetry: 0, humanEdit: 0 } : budget,
        autoUsed: 0,
        humanUsed: 0,
        updatedAt: nowIso(),
      };

  // Initial proposal does not consume retry budget.
  if (!input.attemptType) {
    store.set(input.key, state);
    return { allowed: true, state };
  }

  if (state.fixability === 'impossible') {
    store.set(input.key, state);
    return { allowed: false, reason: 'fixability_impossible', state };
  }

  if (input.attemptType === 'auto') {
    if (state.autoUsed >= state.budget.autoRetry) {
      store.set(input.key, state);
      return { allowed: false, reason: 'auto_retry_exhausted', state };
    }
    state.autoUsed += 1;
  } else {
    if (state.humanUsed >= state.budget.humanEdit) {
      store.set(input.key, state);
      return { allowed: false, reason: 'human_edit_exhausted', state };
    }
    state.humanUsed += 1;
  }

  state.updatedAt = nowIso();
  store.set(input.key, state);
  return { allowed: true, state };
}
