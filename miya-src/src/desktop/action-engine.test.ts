import { describe, expect, test } from 'bun:test';
import {
  buildDesktopActionPlanV2FromRequest,
  buildDesktopOutboundHumanActions,
  buildDesktopSingleStepPlanFromDecision,
  buildDesktopSingleStepPromptKit,
  parseDesktopActionPlanV2,
  parseDesktopSingleStepDecision,
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

  test('accepts non-coordinate targets for click/focus and text assertion', () => {
    const plan = buildDesktopActionPlanV2FromRequest({
      source: 'test.selector',
      appName: 'Browser',
      routeLevel: 'L2_OCR',
      actions: [
        {
          id: 'focus_window',
          kind: 'focus',
          target: {
            mode: 'window',
            value: 'Chrome',
          },
        },
        {
          id: 'click_send',
          kind: 'click',
          target: {
            mode: 'selector',
            value: 'name=Send;control=button',
          },
        },
        {
          id: 'assert_text',
          kind: 'assert',
          assert: {
            type: 'text',
            expected: 'Message sent',
            contains: true,
          },
        },
      ],
    });
    const parsed = parseDesktopActionPlanV2(plan);
    expect(parsed.actions[1]?.target?.mode).toBe('selector');
    expect(parsed.actions[2]?.assert?.type).toBe('text');
  });

  test('parses strict single-step json decision and rejects extra fields', () => {
    const parsed = parseDesktopSingleStepDecision(
      '{"action":"click","coordinate":{"x":1440,"y":962},"content":"send"}',
    );
    expect(parsed.action).toBe('click');
    expect(parsed.coordinate?.x).toBe(1440);

    expect(() =>
      parseDesktopSingleStepDecision(
        '{"action":"click","coordinate":{"x":1,"y":2},"content":"x","extra":"forbidden"}',
      ),
    ).toThrow();
  });

  test('builds single-step plan with auto focus guard before type action', () => {
    const result = buildDesktopSingleStepPlanFromDecision({
      source: 'test.single-step',
      appName: 'QQ',
      windowHint: 'Alice',
      routeLevel: 'L2_OCR',
      stepIndex: 3,
      decision: parseDesktopSingleStepDecision({
        action: 'type',
        coordinate: null,
        content: 'hello world',
      }),
    });
    expect(result.status).toBe('ready');
    expect(result.executable).toBe(true);
    expect(result.plan?.actions.length).toBe(2);
    expect(result.plan?.actions[0]?.kind).toBe('focus');
    expect(result.plan?.actions[1]?.kind).toBe('type');
  });

  test('exposes prompt kit with rules and few-shot examples', () => {
    const kit = buildDesktopSingleStepPromptKit();
    expect(kit.protocol).toBe('desktop_single_step_prompt.v1');
    expect(kit.rules.length).toBeGreaterThanOrEqual(5);
    expect(kit.fewShot.length).toBeGreaterThanOrEqual(4);
    expect(kit.responseSchema.required).toEqual([
      'action',
      'coordinate',
      'content',
    ]);
  });
});
