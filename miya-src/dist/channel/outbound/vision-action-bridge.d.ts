import { z } from 'zod';
export type DesktopPerceptionRoute = 'L0_ACTION_MEMORY' | 'L1_UIA' | 'L2_OCR' | 'L3_SOM_VLM';
export type AutomationRisk = 'LOW' | 'MEDIUM' | 'HIGH';
declare const desktopIntentSchema: z.ZodObject<{
    kind: z.ZodLiteral<"desktop_outbound_send">;
    channel: z.ZodEnum<{
        qq: "qq";
        wechat: "wechat";
    }>;
    appName: z.ZodEnum<{
        QQ: "QQ";
        WeChat: "WeChat";
    }>;
    destination: z.ZodString;
    payloadHash: z.ZodString;
    hasText: z.ZodBoolean;
    hasMedia: z.ZodBoolean;
    risk: z.ZodDefault<z.ZodEnum<{
        LOW: "LOW";
        HIGH: "HIGH";
        MEDIUM: "MEDIUM";
    }>>;
}, z.core.$strip>;
declare const somCandidateSchema: z.ZodObject<{
    id: z.ZodNumber;
    label: z.ZodOptional<z.ZodString>;
    coarse: z.ZodObject<{
        row: z.ZodNumber;
        col: z.ZodNumber;
    }, z.core.$strip>;
    roi: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, z.core.$strip>;
    center: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strip>;
    confidence: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
declare const desktopScreenStateSchema: z.ZodObject<{
    windowFingerprint: z.ZodOptional<z.ZodString>;
    captureMethod: z.ZodDefault<z.ZodEnum<{
        unknown: "unknown";
        wgc_hwnd: "wgc_hwnd";
        print_window: "print_window";
        dxgi_duplication: "dxgi_duplication";
        uia_only: "uia_only";
    }>>;
    display: z.ZodObject<{
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, z.core.$strip>;
    uiaAvailable: z.ZodBoolean;
    ocrAvailable: z.ZodBoolean;
    somCandidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        label: z.ZodOptional<z.ZodString>;
        coarse: z.ZodObject<{
            row: z.ZodNumber;
            col: z.ZodNumber;
        }, z.core.$strip>;
        roi: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
        }, z.core.$strip>;
        center: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strip>;
        confidence: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    ocrText: z.ZodOptional<z.ZodString>;
    ocrBoxes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
        text: z.ZodString;
        confidence: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
    lastOcrFingerprint: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
declare const actionPlanStepSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<{
        focus_window: "focus_window";
        submit_send: "submit_send";
        resolve_target: "resolve_target";
        prepare_media: "prepare_media";
        commit_media: "commit_media";
        prepare_text: "prepare_text";
        commit_text: "commit_text";
        verify_receipt: "verify_receipt";
    }>;
    via: z.ZodEnum<{
        L0_ACTION_MEMORY: "L0_ACTION_MEMORY";
        L1_UIA: "L1_UIA";
        L2_OCR: "L2_OCR";
        L3_SOM_VLM: "L3_SOM_VLM";
    }>;
    verify: z.ZodArray<z.ZodEnum<{
        uia_hit_test: "uia_hit_test";
        pixel_fingerprint: "pixel_fingerprint";
        window_fingerprint: "window_fingerprint";
    }>>;
}, z.core.$strip>;
declare const desktopActionPlanSchema: z.ZodObject<{
    protocol: z.ZodLiteral<"vision_action_bridge.v1">;
    intent: z.ZodObject<{
        kind: z.ZodLiteral<"desktop_outbound_send">;
        channel: z.ZodEnum<{
            qq: "qq";
            wechat: "wechat";
        }>;
        appName: z.ZodEnum<{
            QQ: "QQ";
            WeChat: "WeChat";
        }>;
        destination: z.ZodString;
        payloadHash: z.ZodString;
        hasText: z.ZodBoolean;
        hasMedia: z.ZodBoolean;
        risk: z.ZodDefault<z.ZodEnum<{
            LOW: "LOW";
            HIGH: "HIGH";
            MEDIUM: "MEDIUM";
        }>>;
    }, z.core.$strip>;
    screen_state: z.ZodObject<{
        windowFingerprint: z.ZodOptional<z.ZodString>;
        captureMethod: z.ZodDefault<z.ZodEnum<{
            unknown: "unknown";
            wgc_hwnd: "wgc_hwnd";
            print_window: "print_window";
            dxgi_duplication: "dxgi_duplication";
            uia_only: "uia_only";
        }>>;
        display: z.ZodObject<{
            width: z.ZodNumber;
            height: z.ZodNumber;
        }, z.core.$strip>;
        uiaAvailable: z.ZodBoolean;
        ocrAvailable: z.ZodBoolean;
        somCandidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodNumber;
            label: z.ZodOptional<z.ZodString>;
            coarse: z.ZodObject<{
                row: z.ZodNumber;
                col: z.ZodNumber;
            }, z.core.$strip>;
            roi: z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
                width: z.ZodNumber;
                height: z.ZodNumber;
            }, z.core.$strip>;
            center: z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, z.core.$strip>;
            confidence: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>;
        ocrText: z.ZodOptional<z.ZodString>;
        ocrBoxes: z.ZodOptional<z.ZodArray<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
            text: z.ZodString;
            confidence: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>;
        lastOcrFingerprint: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    action_plan: z.ZodObject<{
        routeLevel: z.ZodEnum<{
            L0_ACTION_MEMORY: "L0_ACTION_MEMORY";
            L1_UIA: "L1_UIA";
            L2_OCR: "L2_OCR";
            L3_SOM_VLM: "L3_SOM_VLM";
        }>;
        replaySkillId: z.ZodOptional<z.ZodString>;
        memoryHit: z.ZodBoolean;
        tokenPolicy: z.ZodObject<{
            defaultNoVlm: z.ZodLiteral<true>;
            roiOnlyWhenVlm: z.ZodLiteral<true>;
            promptTemplate: z.ZodLiteral<"som_candidate_index_v1">;
            schemaMode: z.ZodLiteral<"json_only">;
            maxVlmCallsPerStep: z.ZodNumber;
        }, z.core.$strip>;
        som: z.ZodObject<{
            enabled: z.ZodBoolean;
            selectionSource: z.ZodEnum<{
                none: "none";
                memory: "memory";
                heuristic: "heuristic";
                vlm: "vlm";
            }>;
            selectedCandidateId: z.ZodOptional<z.ZodNumber>;
            vlmCallsBudget: z.ZodNumber;
            vlmCallsPlanned: z.ZodNumber;
            candidates: z.ZodArray<z.ZodObject<{
                id: z.ZodNumber;
                label: z.ZodOptional<z.ZodString>;
                coarse: z.ZodObject<{
                    row: z.ZodNumber;
                    col: z.ZodNumber;
                }, z.core.$strip>;
                roi: z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                    width: z.ZodNumber;
                    height: z.ZodNumber;
                }, z.core.$strip>;
                center: z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                }, z.core.$strip>;
                confidence: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        brains: z.ZodObject<{
            fastBrain: z.ZodObject<{
                role: z.ZodLiteral<"FAST_ACTION_MEMORY_REPLAY">;
                active: z.ZodBoolean;
                replaySkillId: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
            slowBrain: z.ZodObject<{
                role: z.ZodLiteral<"SLOW_TASK_PLANNER">;
                active: z.ZodBoolean;
                planningRoute: z.ZodOptional<z.ZodEnum<{
                    L1_UIA: "L1_UIA";
                    L2_OCR: "L2_OCR";
                    L3_SOM_VLM: "L3_SOM_VLM";
                }>>;
                promoteReplaySkillOnSuccess: z.ZodLiteral<true>;
            }, z.core.$strip>;
        }, z.core.$strip>;
        humanActions: z.ZodArray<z.ZodObject<{
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
        steps: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<{
                focus_window: "focus_window";
                submit_send: "submit_send";
                resolve_target: "resolve_target";
                prepare_media: "prepare_media";
                commit_media: "commit_media";
                prepare_text: "prepare_text";
                commit_text: "commit_text";
                verify_receipt: "verify_receipt";
            }>;
            via: z.ZodEnum<{
                L0_ACTION_MEMORY: "L0_ACTION_MEMORY";
                L1_UIA: "L1_UIA";
                L2_OCR: "L2_OCR";
                L3_SOM_VLM: "L3_SOM_VLM";
            }>;
            verify: z.ZodArray<z.ZodEnum<{
                uia_hit_test: "uia_hit_test";
                pixel_fingerprint: "pixel_fingerprint";
                window_fingerprint: "window_fingerprint";
            }>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type DesktopAutomationIntent = z.infer<typeof desktopIntentSchema>;
export type DesktopSomCandidate = z.infer<typeof somCandidateSchema>;
export type DesktopScreenState = z.infer<typeof desktopScreenStateSchema>;
export type DesktopActionPlan = z.infer<typeof desktopActionPlanSchema>;
export interface DesktopReplaySkillRecord {
    id: string;
    key: string;
    channel: DesktopAutomationIntent['channel'];
    appName: DesktopAutomationIntent['appName'];
    destination: string;
    routeLevel: DesktopPerceptionRoute;
    stepKinds: Array<z.infer<typeof actionPlanStepSchema>['kind']>;
    verifyPolicy: string[];
    somCandidateId?: number;
    windowFingerprint?: string;
    successCount: number;
    avgLatencyMs: number;
    createdAt: string;
    updatedAt: string;
    lastSuccessAt?: string;
}
export interface DesktopActionOutcomeInput {
    intent: DesktopAutomationIntent;
    screenState: DesktopScreenState;
    actionPlan: DesktopActionPlan;
    sent: boolean;
    latencyMs: number;
    vlmCallsUsed?: number;
    somSucceeded?: boolean;
    highRiskMisfire?: boolean;
}
export interface DesktopAutomationKpiSnapshot {
    totalRuns: number;
    successfulRuns: number;
    vlmCallRatio: number;
    somPathHitRate: number;
    reuseTaskP95Ms: number;
    firstTaskP95Ms: number;
    highRiskMisfireRate: number;
    reuseRuns: number;
    firstRuns: number;
    acceptance?: DesktopAutomationAcceptanceSnapshot;
}
export interface DesktopAutomationAcceptanceSnapshot {
    pass: boolean;
    thresholds: {
        maxVlmCallRatio: number;
        minSomPathHitRate: number;
        maxReuseTaskP95Ms: number;
        maxHighRiskMisfireRate: number;
    };
    checks: {
        vlmCallRatio: boolean;
        somPathHitRate: boolean;
        reuseTaskP95Ms: boolean;
        highRiskMisfireRate: boolean;
    };
    sample: {
        totalRuns: number;
        somRuns: number;
        reuseRuns: number;
        highRiskRuns: number;
    };
}
export declare function listDesktopReplaySkills(projectDir: string, limit?: number): DesktopReplaySkillRecord[];
export declare function buildDesktopActionPlan(input: {
    projectDir: string;
    intent: DesktopAutomationIntent;
    screenState: DesktopScreenState;
}): DesktopActionPlan;
export declare function recordDesktopActionOutcome(projectDir: string, input: DesktopActionOutcomeInput): void;
export declare function readDesktopAutomationKpi(projectDir: string): DesktopAutomationKpiSnapshot;
export declare function readDesktopAutomationAcceptance(projectDir: string): DesktopAutomationAcceptanceSnapshot;
export {};
