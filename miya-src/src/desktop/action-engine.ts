import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const desktopPerceptionRouteSchemaV2 = z.enum([
  'L0_ACTION_MEMORY',
  'L1_UIA',
  'L2_OCR',
  'L3_SOM_VLM',
]);

export type DesktopPerceptionRouteV2 = z.infer<typeof desktopPerceptionRouteSchemaV2>;

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
    if (action.kind === 'hotkey' && (!action.keys || action.keys.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'hotkey action requires keys',
      });
    }
    if (action.kind === 'scroll' && (!Number.isFinite(action.scrollDeltaY) || action.scrollDeltaY === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'scroll action requires non-zero scrollDeltaY',
      });
    }
    if (action.kind === 'drag') {
      if (!action.target || action.target.mode !== 'coordinates' || !action.target.point) {
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
  const raw = action && typeof action === 'object' ? (action as Record<string, unknown>) : {};
  const withID = {
    ...raw,
    id:
      typeof raw.id === 'string' && raw.id.trim().length > 0
        ? raw.id.trim()
        : `action_${index + 1}`,
    route:
      typeof raw.route === 'string' && desktopPerceptionRouteSchemaV2.safeParse(raw.route).success
        ? raw.route
        : routeLevel ?? 'L1_UIA',
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
      ? request.actions.map((item, index) => normalizePlanAction(item, index, routeLevel))
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

