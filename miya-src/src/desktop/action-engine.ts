import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const desktopPerceptionRouteSchemaV2 = z.enum([
  'L0_ACTION_MEMORY',
  'L1_UIA',
  'L2_OCR',
  'L3_SOM_VLM',
]);

export type DesktopPerceptionRouteV2 = z.infer<
  typeof desktopPerceptionRouteSchemaV2
>;

export const desktopActionKindSchema = z.enum([
  'focus',
  'click',
  'type',
  'hotkey',
  'scroll',
  'drag',
  'assert',
]);

export type DesktopActionKind = z.infer<typeof desktopActionKindSchema>;

export const desktopSingleStepActionSchema = z.enum([
  'focus',
  'click',
  'type',
  'enter',
  'scroll',
  'assert',
  'retry',
  'done',
]);

export type DesktopSingleStepAction = z.infer<
  typeof desktopSingleStepActionSchema
>;

const desktopSingleStepCoordinateSchema = z
  .object({
    x: z.number().int().min(0).max(32_767),
    y: z.number().int().min(0).max(32_767),
  })
  .strict();

const desktopSingleStepDecisionSchemaInternal = z
  .object({
    action: desktopSingleStepActionSchema,
    coordinate: desktopSingleStepCoordinateSchema.nullable(),
    content: z.string().max(4_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasCoordinate = Boolean(value.coordinate);
    const hasContent = value.content.trim().length > 0;
    if (
      (value.action === 'focus' || value.action === 'click') &&
      !hasCoordinate &&
      !hasContent
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.action} requires coordinate or content`,
      });
    }
    if ((value.action === 'type' || value.action === 'assert') && !hasContent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.action} requires content`,
      });
    }
  });

export const desktopSingleStepDecisionSchema =
  desktopSingleStepDecisionSchemaInternal;

export type DesktopSingleStepDecision = z.infer<
  typeof desktopSingleStepDecisionSchema
>;

export interface DesktopSingleStepPromptKit {
  protocol: 'desktop_single_step_prompt.v1';
  ruleVersion: '2026-02-17';
  responseSchema: {
    type: 'json_object';
    required: ['action', 'coordinate', 'content'];
    forbidExtraKeys: true;
  };
  rules: string[];
  fewShot: Array<{
    observation: string;
    output: DesktopSingleStepDecision;
  }>;
}

function parseJsonObjectFromText(input: string): unknown {
  const text = input.trim();
  if (!text) throw new Error('single_step_decision_empty');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const sliced = text.slice(start, end + 1);
      return JSON.parse(sliced) as unknown;
    }
    throw new Error('single_step_decision_not_json');
  }
}

function normalizeSingleStepAction(raw: string): DesktopSingleStepAction {
  const normalized = raw.trim().toLowerCase();
  const mapped: Record<string, DesktopSingleStepAction> = {
    focus: 'focus',
    activate: 'focus',
    click: 'click',
    tap: 'click',
    type: 'type',
    input: 'type',
    enter: 'enter',
    send: 'enter',
    scroll: 'scroll',
    assert: 'assert',
    verify: 'assert',
    retry: 'retry',
    done: 'done',
    complete: 'done',
    completed: 'done',
    finish: 'done',
    finished: 'done',
    stop: 'done',
  };
  const action = mapped[normalized];
  if (!action) throw new Error(`single_step_action_unsupported:${raw}`);
  return action;
}

export function parseDesktopSingleStepDecision(
  input: unknown,
): DesktopSingleStepDecision {
  const rawObject =
    typeof input === 'string'
      ? parseJsonObjectFromText(input)
      : input && typeof input === 'object'
        ? input
        : (() => {
            throw new Error('single_step_decision_invalid');
          })();
  const raw = rawObject as Record<string, unknown>;
  const allowedKeys = new Set(['action', 'coordinate', 'content']);
  const unexpectedKey = Object.keys(raw).find((key) => !allowedKeys.has(key));
  if (unexpectedKey) {
    throw new Error(`single_step_decision_extra_field:${unexpectedKey}`);
  }
  const normalized = {
    action: normalizeSingleStepAction(String(raw.action ?? '')),
    coordinate: raw.coordinate == null ? null : raw.coordinate,
    content:
      typeof raw.content === 'string' ? raw.content : String(raw.content ?? ''),
  };
  return desktopSingleStepDecisionSchema.parse(normalized);
}

export function buildDesktopSingleStepPromptKit(): DesktopSingleStepPromptKit {
  return {
    protocol: 'desktop_single_step_prompt.v1',
    ruleVersion: '2026-02-17',
    responseSchema: {
      type: 'json_object',
      required: ['action', 'coordinate', 'content'],
      forbidExtraKeys: true,
    },
    rules: [
      '只能输出 JSON 对象，且仅允许 action/coordinate/content 三个字段。',
      '先定位元素再操作：需要点击或输入时，优先给出 coordinate（x/y）。',
      '执行输入前必须确保焦点已激活；若无法确认焦点，先输出 focus。',
      '找不到元素时不要猜测，输出 {"action":"retry","coordinate":null,"content":"element_not_found"}。',
      '若当前目标已完成，输出 {"action":"done","coordinate":null,"content":"completed"}，禁止继续多余操作。',
      '每次只决策下一步，不做多步计划，不输出解释文本。',
    ],
    fewShot: [
      {
        observation: '窗口: QQ 聊天框已激活，发送按钮在(1720,980)',
        output: {
          action: 'click',
          coordinate: { x: 1720, y: 980 },
          content: 'send_button',
        },
      },
      {
        observation: '输入框未激活，消息内容为“晚上8点开会”',
        output: {
          action: 'focus',
          coordinate: { x: 860, y: 996 },
          content: 'chat_input',
        },
      },
      {
        observation: 'OCR 未识别到联系人“Alice”',
        output: {
          action: 'retry',
          coordinate: null,
          content: 'element_not_found',
        },
      },
      {
        observation: '已看到“发送成功”提示且最后一条消息是目标内容',
        output: {
          action: 'done',
          coordinate: null,
          content: 'completed',
        },
      },
    ],
  };
}

const desktopPointSchema = z.object({
  x: z.number().int().min(0).max(32_767),
  y: z.number().int().min(0).max(32_767),
});

export const desktopActionTargetSchema = z
  .object({
    mode: z.enum(['window', 'coordinates', 'text', 'selector']),
    value: z.string().trim().min(1).max(300).optional(),
    point: desktopPointSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'coordinates' && !value.point) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'coordinates target requires point',
      });
    }
    if (value.mode !== 'coordinates' && !value.value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.mode} target requires value`,
      });
    }
  });

const desktopActionAssertSchema = z.object({
  type: z.enum(['window', 'text', 'image']),
  expected: z.string().trim().min(1).max(300),
  contains: z.boolean().default(true),
});

export const desktopActionSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    kind: desktopActionKindSchema,
    route: desktopPerceptionRouteSchemaV2.default('L1_UIA'),
    target: desktopActionTargetSchema.optional(),
    text: z.string().max(4_000).optional(),
    keys: z.array(z.string().trim().min(1).max(20)).min(1).max(5).optional(),
    scrollDeltaY: z.number().int().min(-9_600).max(9_600).optional(),
    dragTo: desktopPointSchema.optional(),
    assert: desktopActionAssertSchema.optional(),
    timeoutMs: z.number().int().min(50).max(60_000).optional(),
    notes: z.string().trim().max(240).optional(),
  })
  .superRefine((action, ctx) => {
    if (action.kind === 'focus' && !action.target) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'focus action requires target',
      });
    }
    if (action.kind === 'click' && !action.target) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'click action requires target',
      });
    }
    if (action.kind === 'type' && !action.text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'type action requires text',
      });
    }
    if (
      action.kind === 'hotkey' &&
      (!action.keys || action.keys.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'hotkey action requires keys',
      });
    }
    if (
      action.kind === 'scroll' &&
      (!Number.isFinite(action.scrollDeltaY) || action.scrollDeltaY === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'scroll action requires non-zero scrollDeltaY',
      });
    }
    if (action.kind === 'drag') {
      if (
        !action.target ||
        action.target.mode !== 'coordinates' ||
        !action.target.point
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'drag action requires coordinates target',
        });
      }
      if (!action.dragTo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'drag action requires dragTo',
        });
      }
    }
    if (action.kind === 'assert' && !action.assert) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'assert action requires assert payload',
      });
    }
  });

export type DesktopActionV2 = z.infer<typeof desktopActionSchema>;

function parseScrollDelta(content: string): number {
  const text = content.trim().toLowerCase();
  const fromNumber = Number(text);
  if (Number.isFinite(fromNumber) && fromNumber !== 0) {
    return Math.max(-9_600, Math.min(9_600, Math.floor(fromNumber)));
  }
  if (text.includes('up') || text.includes('上')) return 720;
  return -720;
}

function targetFromDecision(input: {
  decision: DesktopSingleStepDecision;
  fallbackHint?: string;
}): z.infer<typeof desktopActionTargetSchema> | undefined {
  const coordinate = input.decision.coordinate;
  if (coordinate) {
    return {
      mode: 'coordinates',
      point: {
        x: coordinate.x,
        y: coordinate.y,
      },
    };
  }
  const hint = input.decision.content.trim() || input.fallbackHint?.trim();
  if (!hint) return undefined;
  return {
    mode: 'text',
    value: hint,
  };
}

export function buildDesktopActionFromSingleStepDecision(input: {
  decision: DesktopSingleStepDecision;
  routeLevel?: DesktopPerceptionRouteV2;
  stepID?: string;
  fallbackHint?: string;
}):
  | { executable: true; action: DesktopActionV2 }
  | { executable: false; status: 'retry' | 'done' } {
  const routeLevel = input.routeLevel ?? 'L1_UIA';
  const stepID = input.stepID?.trim() || 'single_step_action';
  const decision = input.decision;
  if (decision.action === 'retry')
    return { executable: false, status: 'retry' };
  if (decision.action === 'done') return { executable: false, status: 'done' };
  if (decision.action === 'focus') {
    return {
      executable: true,
      action: desktopActionSchema.parse({
        id: stepID,
        kind: 'focus',
        route: routeLevel,
        target:
          targetFromDecision({
            decision,
            fallbackHint: input.fallbackHint,
          }) ??
          ({
            mode: 'window',
            value: input.fallbackHint?.trim() || 'Desktop',
          } as const),
      }),
    };
  }
  if (decision.action === 'click') {
    return {
      executable: true,
      action: desktopActionSchema.parse({
        id: stepID,
        kind: 'click',
        route: routeLevel,
        target: targetFromDecision({
          decision,
          fallbackHint: input.fallbackHint,
        }),
      }),
    };
  }
  if (decision.action === 'type') {
    return {
      executable: true,
      action: desktopActionSchema.parse({
        id: stepID,
        kind: 'type',
        route: routeLevel,
        target: targetFromDecision({
          decision,
          fallbackHint: input.fallbackHint,
        }),
        text: decision.content,
      }),
    };
  }
  if (decision.action === 'enter') {
    return {
      executable: true,
      action: desktopActionSchema.parse({
        id: stepID,
        kind: 'hotkey',
        route: routeLevel,
        keys: ['enter'],
      }),
    };
  }
  if (decision.action === 'scroll') {
    return {
      executable: true,
      action: desktopActionSchema.parse({
        id: stepID,
        kind: 'scroll',
        route: routeLevel,
        scrollDeltaY: parseScrollDelta(decision.content),
      }),
    };
  }
  return {
    executable: true,
    action: desktopActionSchema.parse({
      id: stepID,
      kind: 'assert',
      route: routeLevel,
      assert: {
        type: 'text',
        expected: decision.content,
        contains: true,
      },
    }),
  };
}

export interface DesktopSingleStepPlanInput {
  source?: string;
  appName?: string;
  windowHint?: string;
  routeLevel?: DesktopPerceptionRouteV2;
  safety?: {
    inputMutex?: boolean;
    abortOnUserInterference?: boolean;
  };
  stepIndex?: number;
  enforceFocusBeforeAction?: boolean;
  decision: DesktopSingleStepDecision;
}

export interface DesktopSingleStepPlanResult {
  decision: DesktopSingleStepDecision;
  executable: boolean;
  status: 'ready' | 'retry' | 'done';
  plan?: DesktopActionPlanV2;
}

const desktopActionSafetySchema = z.object({
  inputMutex: z.boolean().default(true),
  abortOnUserInterference: z.boolean().default(true),
});

export const desktopActionPlanSchemaV2 = z.object({
  protocol: z.literal('desktop_action_plan.v2'),
  planID: z.string().trim().min(1).max(120),
  createdAt: z.string().trim().min(1).max(80),
  source: z.string().trim().min(1).max(120),
  context: z.object({
    appName: z.string().trim().max(120).optional(),
    windowHint: z.string().trim().max(240).optional(),
    routeLevel: desktopPerceptionRouteSchemaV2.optional(),
  }),
  safety: desktopActionSafetySchema,
  actions: z.array(desktopActionSchema).min(1).max(50),
});

export type DesktopActionPlanV2 = z.infer<typeof desktopActionPlanSchemaV2>;

export interface DesktopActionPlanRequestV2 {
  source?: string;
  appName?: string;
  windowHint?: string;
  routeLevel?: DesktopPerceptionRouteV2;
  safety?: {
    inputMutex?: boolean;
    abortOnUserInterference?: boolean;
  };
  actions?: unknown[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePlanAction(
  action: unknown,
  index: number,
  routeLevel?: DesktopPerceptionRouteV2,
): DesktopActionV2 {
  const raw =
    action && typeof action === 'object'
      ? (action as Record<string, unknown>)
      : {};
  const withID = {
    ...raw,
    id:
      typeof raw.id === 'string' && raw.id.trim().length > 0
        ? raw.id.trim()
        : `action_${index + 1}`,
    route:
      typeof raw.route === 'string' &&
      desktopPerceptionRouteSchemaV2.safeParse(raw.route).success
        ? raw.route
        : (routeLevel ?? 'L1_UIA'),
  };
  return desktopActionSchema.parse(withID);
}

function defaultActions(input: {
  appName?: string;
  windowHint?: string;
  routeLevel?: DesktopPerceptionRouteV2;
}): DesktopActionV2[] {
  const targetWindow = input.windowHint || input.appName || 'Desktop';
  return [
    desktopActionSchema.parse({
      id: 'focus_window',
      kind: 'focus',
      route: input.routeLevel ?? 'L1_UIA',
      target: {
        mode: 'window',
        value: targetWindow,
      },
      notes: 'Bring target window to foreground before further actions.',
    }),
    desktopActionSchema.parse({
      id: 'assert_window',
      kind: 'assert',
      route: input.routeLevel ?? 'L1_UIA',
      assert: {
        type: 'window',
        expected: targetWindow,
        contains: true,
      },
    }),
  ];
}

export function buildDesktopActionPlanV2FromRequest(
  request: DesktopActionPlanRequestV2,
): DesktopActionPlanV2 {
  const routeLevel = request.routeLevel;
  const actions =
    Array.isArray(request.actions) && request.actions.length > 0
      ? request.actions.map((item, index) =>
          normalizePlanAction(item, index, routeLevel),
        )
      : defaultActions({
          appName: request.appName,
          windowHint: request.windowHint,
          routeLevel,
        });
  const safety = desktopActionSafetySchema.parse({
    inputMutex: request.safety?.inputMutex,
    abortOnUserInterference: request.safety?.abortOnUserInterference,
  });
  return desktopActionPlanSchemaV2.parse({
    protocol: 'desktop_action_plan.v2',
    planID: `dap_${randomUUID()}`,
    createdAt: nowIso(),
    source: request.source?.trim() || 'miya.desktop.v2',
    context: {
      appName: request.appName?.trim() || undefined,
      windowHint: request.windowHint?.trim() || undefined,
      routeLevel,
    },
    safety,
    actions,
  });
}

export function buildDesktopSingleStepPlanFromDecision(
  input: DesktopSingleStepPlanInput,
): DesktopSingleStepPlanResult {
  const decision = desktopSingleStepDecisionSchema.parse(input.decision);
  const routeLevel = input.routeLevel ?? 'L1_UIA';
  const stepIndex = Math.max(1, Math.floor(Number(input.stepIndex ?? 1) || 1));
  const targetHint = input.windowHint?.trim() || input.appName?.trim() || '';
  const converted = buildDesktopActionFromSingleStepDecision({
    decision,
    routeLevel,
    stepID: `step_${stepIndex}_main`,
    fallbackHint: targetHint || undefined,
  });

  if (!converted.executable) {
    return {
      decision,
      executable: false,
      status: converted.status,
    };
  }

  const actions: DesktopActionV2[] = [];
  const shouldAutoFocus =
    input.enforceFocusBeforeAction !== false &&
    converted.action.kind !== 'focus' &&
    converted.action.kind !== 'assert' &&
    targetHint.length > 0;
  if (shouldAutoFocus) {
    actions.push(
      desktopActionSchema.parse({
        id: `step_${stepIndex}_focus_guard`,
        kind: 'focus',
        route: routeLevel,
        target: {
          mode: 'window',
          value: targetHint,
        },
        notes: 'Auto focus guard before executing single-step action.',
      }),
    );
  }
  actions.push(converted.action);

  return {
    decision,
    executable: true,
    status: 'ready',
    plan: buildDesktopActionPlanV2FromRequest({
      source: input.source?.trim() || 'miya.desktop.single_step',
      appName: input.appName?.trim() || undefined,
      windowHint: input.windowHint?.trim() || undefined,
      routeLevel,
      safety: input.safety,
      actions,
    }),
  };
}

export function parseDesktopActionPlanV2(input: unknown): DesktopActionPlanV2 {
  return desktopActionPlanSchemaV2.parse(input);
}

export function buildDesktopOutboundHumanActions(input: {
  routeLevel: DesktopPerceptionRouteV2;
  appName: 'QQ' | 'WeChat';
  destination: string;
  hasText: boolean;
  hasMedia: boolean;
  selectedCandidateId?: number;
}): DesktopActionV2[] {
  const actions: DesktopActionV2[] = [
    desktopActionSchema.parse({
      id: 'focus_window',
      kind: 'focus',
      route: input.routeLevel,
      target: {
        mode: 'window',
        value: input.appName,
      },
    }),
    desktopActionSchema.parse({
      id: 'select_destination',
      kind: 'click',
      route: input.routeLevel,
      target: input.selectedCandidateId
        ? {
            mode: 'selector',
            value: `som_candidate_${input.selectedCandidateId}`,
          }
        : {
            mode: 'text',
            value: input.destination,
          },
    }),
  ];

  if (input.hasMedia) {
    actions.push(
      desktopActionSchema.parse({
        id: 'paste_media',
        kind: 'hotkey',
        route: input.routeLevel,
        keys: ['ctrl', 'v'],
      }),
    );
  }

  if (input.hasText) {
    actions.push(
      desktopActionSchema.parse({
        id: 'type_text',
        kind: 'type',
        route: input.routeLevel,
        text: '<payload_text>',
      }),
    );
  }

  actions.push(
    desktopActionSchema.parse({
      id: 'submit_send',
      kind: 'hotkey',
      route: input.routeLevel,
      keys: ['enter'],
    }),
  );
  actions.push(
    desktopActionSchema.parse({
      id: 'assert_receipt',
      kind: 'assert',
      route: input.routeLevel,
      assert: {
        type: 'window',
        expected: input.destination,
        contains: true,
      },
    }),
  );

  return actions;
}
