import { describe, expect, test } from 'bun:test';
import {
  buildDesktopActionPlanV2FromRequest,
  buildDesktopOutboundHumanActions,
  parseDesktopActionPlanV2,
} from './action-engine';

describe('desktop action engine v2', () => {
  test('builds outbound human-like actions with additive route metadata', () => {
    const actions = buildDesktopOutboundHumanActions({
      routeLevel: 'L2_OCR',
      appName: 'QQ',
      destination: 'Project-Group',
      hasText: true,
      hasMedia: true,
      selectedCandidateId: 7,
    });

    expect(actions.length).toBeGreaterThanOrEqual(5);
    expect(actions[0]?.kind).toBe('focus');
    expect(actions[1]?.kind).toBe('click');
    expect(actions.some((item) => item.kind === 'type')).toBe(true);
    expect(actions.some((item) => item.kind === 'hotkey')).toBe(true);
    expect(actions[actions.length - 1]?.kind).toBe('assert');
    expect(actions[1]?.target?.value).toBe('som_candidate_7');
  });

  test('parses and normalizes custom action plans', () => {
    const plan = buildDesktopActionPlanV2FromRequest({
      source: 'test',
      appName: 'Notepad',
      windowHint: 'readme.txt',
      routeLevel: 'L1_UIA',
      actions: [
        {
          kind: 'focus',
          target: {
            mode: 'window',
            value: 'Notepad',
          },
        },
        {
          id: 'type_text',
          kind: 'type',
          text: 'hello',
        },
        {
          id: 'assert_window',
          kind: 'assert',
          assert: {
            type: 'window',
            expected: 'Notepad',
          },
        },
      ],
    });

    const parsed = parseDesktopActionPlanV2(plan);
    expect(parsed.protocol).toBe('desktop_action_plan.v2');
    expect(parsed.actions.length).toBe(3);
    expect(parsed.actions[0]?.id).toBe('action_1');
    expect(parsed.actions[1]?.id).toBe('type_text');
    expect(parsed.context.appName).toBe('Notepad');
  });
});

