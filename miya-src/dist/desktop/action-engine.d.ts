import { z } from 'zod';
export declare const desktopPerceptionRouteSchemaV2: z.ZodEnum<{
    L0_ACTION_MEMORY: "L0_ACTION_MEMORY";
    L1_UIA: "L1_UIA";
    L2_OCR: "L2_OCR";
    L3_SOM_VLM: "L3_SOM_VLM";
}>;
export type DesktopPerceptionRouteV2 = z.infer<typeof desktopPerceptionRouteSchemaV2>;
export declare const desktopActionKindSchema: z.ZodEnum<{
    type: "type";
    focus: "focus";
    click: "click";
    hotkey: "hotkey";
    scroll: "scroll";
    drag: "drag";
    assert: "assert";
}>;
export type DesktopActionKind = z.infer<typeof desktopActionKindSchema>;
export declare const desktopSingleStepActionSchema: z.ZodEnum<{
    type: "type";
    done: "done";
    focus: "focus";
    click: "click";
    scroll: "scroll";
    assert: "assert";
    enter: "enter";
    retry: "retry";
}>;
export type DesktopSingleStepAction = z.infer<typeof desktopSingleStepActionSchema>;
export declare const desktopSingleStepDecisionSchema: z.ZodObject<{
    action: z.ZodEnum<{
        type: "type";
        done: "done";
        focus: "focus";
        click: "click";
        scroll: "scroll";
        assert: "assert";
        enter: "enter";
        retry: "retry";
    }>;
    coordinate: z.ZodNullable<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strict>>;
    content: z.ZodString;
}, z.core.$strict>;
export type DesktopSingleStepDecision = z.infer<typeof desktopSingleStepDecisionSchema>;
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
export declare function parseDesktopSingleStepDecision(input: unknown): DesktopSingleStepDecision;
export declare function buildDesktopSingleStepPromptKit(): DesktopSingleStepPromptKit;
export declare const desktopActionTargetSchema: z.ZodObject<{
    mode: z.ZodEnum<{
        text: "text";
        window: "window";
        coordinates: "coordinates";
        selector: "selector";
    }>;
    value: z.ZodOptional<z.ZodString>;
    point: z.ZodOptional<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const desktopActionSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<{
        type: "type";
        focus: "focus";
        click: "click";
        hotkey: "hotkey";
        scroll: "scroll";
        drag: "drag";
        assert: "assert";
    }>;
    route: z.ZodDefault<z.ZodEnum<{
        L0_ACTION_MEMORY: "L0_ACTION_MEMORY";
        L1_UIA: "L1_UIA";
        L2_OCR: "L2_OCR";
        L3_SOM_VLM: "L3_SOM_VLM";
    }>>;
    target: z.ZodOptional<z.ZodObject<{
        mode: z.ZodEnum<{
            text: "text";
            window: "window";
            coordinates: "coordinates";
            selector: "selector";
        }>;
        value: z.ZodOptional<z.ZodString>;
        point: z.ZodOptional<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    text: z.ZodOptional<z.ZodString>;
    keys: z.ZodOptional<z.ZodArray<z.ZodString>>;
    scrollDeltaY: z.ZodOptional<z.ZodNumber>;
    dragTo: z.ZodOptional<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strip>>;
    assert: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            text: "text";
            image: "image";
            window: "window";
        }>;
        expected: z.ZodString;
        contains: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    timeoutMs: z.ZodOptional<z.ZodNumber>;
    notes: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type DesktopActionV2 = z.infer<typeof desktopActionSchema>;
export declare function buildDesktopActionFromSingleStepDecision(input: {
    decision: DesktopSingleStepDecision;
    routeLevel?: DesktopPerceptionRouteV2;
    stepID?: string;
    fallbackHint?: string;
}): {
    executable: true;
    action: DesktopActionV2;
} | {
    executable: false;
    status: 'retry' | 'done';
};
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
export declare const desktopActionPlanSchemaV2: z.ZodObject<{
    protocol: z.ZodLiteral<"desktop_action_plan.v2">;
    planID: z.ZodString;
    createdAt: z.ZodString;
    source: z.ZodString;
    context: z.ZodObject<{
        appName: z.ZodOptional<z.ZodString>;
        windowHint: z.ZodOptional<z.ZodString>;
        routeLevel: z.ZodOptional<z.ZodEnum<{
            L0_ACTION_MEMORY: "L0_ACTION_MEMORY";
            L1_UIA: "L1_UIA";
            L2_OCR: "L2_OCR";
            L3_SOM_VLM: "L3_SOM_VLM";
        }>>;
    }, z.core.$strip>;
    safety: z.ZodObject<{
        inputMutex: z.ZodDefault<z.ZodBoolean>;
        abortOnUserInterference: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>;
    actions: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodEnum<{
            type: "type";
            focus: "focus";
            click: "click";
            hotkey: "hotkey";
            scroll: "scroll";
            drag: "drag";
            assert: "assert";
        }>;
        route: z.ZodDefault<z.ZodEnum<{
            L0_ACTION_MEMORY: "L0_ACTION_MEMORY";
            L1_UIA: "L1_UIA";
            L2_OCR: "L2_OCR";
            L3_SOM_VLM: "L3_SOM_VLM";
        }>>;
        target: z.ZodOptional<z.ZodObject<{
            mode: z.ZodEnum<{
                text: "text";
                window: "window";
                coordinates: "coordinates";
                selector: "selector";
            }>;
            value: z.ZodOptional<z.ZodString>;
            point: z.ZodOptional<z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        text: z.ZodOptional<z.ZodString>;
        keys: z.ZodOptional<z.ZodArray<z.ZodString>>;
        scrollDeltaY: z.ZodOptional<z.ZodNumber>;
        dragTo: z.ZodOptional<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strip>>;
        assert: z.ZodOptional<z.ZodObject<{
            type: z.ZodEnum<{
                text: "text";
                image: "image";
                window: "window";
            }>;
            expected: z.ZodString;
            contains: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
        timeoutMs: z.ZodOptional<z.ZodNumber>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
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
export declare function buildDesktopActionPlanV2FromRequest(request: DesktopActionPlanRequestV2): DesktopActionPlanV2;
export declare function buildDesktopSingleStepPlanFromDecision(input: DesktopSingleStepPlanInput): DesktopSingleStepPlanResult;
export declare function parseDesktopActionPlanV2(input: unknown): DesktopActionPlanV2;
export declare function buildDesktopOutboundHumanActions(input: {
    routeLevel: DesktopPerceptionRouteV2;
    appName: 'QQ' | 'WeChat';
    destination: string;
    hasText: boolean;
    hasMedia: boolean;
    selectedCandidateId?: number;
}): DesktopActionV2[];
