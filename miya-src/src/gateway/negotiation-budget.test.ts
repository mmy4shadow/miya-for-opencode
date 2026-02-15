import { describe, expect, test } from 'bun:test';
import { applyNegotiationBudget } from './negotiation-budget';

describe('negotiation budget', () => {
  test('blocks any retry when fixability is impossible', () => {
    const store = new Map();
    const init = applyNegotiationBudget(store, {
      key: 'n-1',
      fixability: 'impossible',
      budget: { autoRetry: 1, humanEdit: 1 },
    });
    expect(init.allowed).toBe(true);

    const retried = applyNegotiationBudget(store, {
      key: 'n-1',
      fixability: 'impossible',
      budget: { autoRetry: 1, humanEdit: 1 },
      attemptType: 'auto',
    });
    expect(retried.allowed).toBe(false);
    expect(retried.reason).toBe('fixability_impossible');
  });

  test('allows max 1 auto + 1 human by default budget', () => {
    const store = new Map();
    applyNegotiationBudget(store, {
      key: 'n-2',
      fixability: 'retry_later',
      budget: { autoRetry: 1, humanEdit: 1 },
    });
    const a1 = applyNegotiationBudget(store, {
      key: 'n-2',
      fixability: 'retry_later',
      budget: { autoRetry: 1, humanEdit: 1 },
      attemptType: 'auto',
    });
    expect(a1.allowed).toBe(true);

    const a2 = applyNegotiationBudget(store, {
      key: 'n-2',
      fixability: 'retry_later',
      budget: { autoRetry: 1, humanEdit: 1 },
      attemptType: 'auto',
    });
    expect(a2.allowed).toBe(false);
    expect(a2.reason).toBe('auto_retry_exhausted');

    const h1 = applyNegotiationBudget(store, {
      key: 'n-2',
      fixability: 'retry_later',
      budget: { autoRetry: 1, humanEdit: 1 },
      attemptType: 'human',
    });
    expect(h1.allowed).toBe(true);

    const h2 = applyNegotiationBudget(store, {
      key: 'n-2',
      fixability: 'retry_later',
      budget: { autoRetry: 1, humanEdit: 1 },
      attemptType: 'human',
    });
    expect(h2.allowed).toBe(false);
    expect(h2.reason).toBe('human_edit_exhausted');
  });
});

