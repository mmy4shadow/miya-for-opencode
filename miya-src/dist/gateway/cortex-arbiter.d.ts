import type { RouteExecutionPlan } from '../router';
import type { GatewayMode } from './sanitizer';
import type { ModeKernelResult } from './mode-kernel';
export interface SafetySignal {
    blocked: boolean;
    reason?: string;
}
export interface UserExplicitIntent {
    preference: 'none' | 'work' | 'chat' | 'mixed' | 'defer';
    confidence: number;
    why: string[];
}
export interface LeftBrainActionPlan {
    objective: string;
    executeWork: boolean;
    risk: 'low' | 'medium' | 'high';
    requiredGates: string[];
    why: string[];
}
export interface RightBrainResponsePlan {
    tone: 'neutral' | 'warm' | 'supportive';
    suggestions: string[];
    highRiskToolSuggestion: boolean;
    why: string[];
}
export interface CortexArbiterInput {
    modeKernel: ModeKernelResult;
    safety: SafetySignal;
    userExplicit: UserExplicitIntent;
    leftBrain: LeftBrainActionPlan;
    rightBrain: RightBrainResponsePlan;
}
export interface CortexArbiterResult {
    mode: GatewayMode;
    executeWork: boolean;
    rightBrainSuppressed: boolean;
    responseHints: string[];
    priorityTrail: Array<'Safety' | 'User explicit' | 'Work objective' | 'Emotional optimization'>;
    why: string[];
    executionTrack: 'left_brain_single_track';
}
export declare function detectUserExplicitIntent(text: string): UserExplicitIntent;
export declare function buildLeftBrainActionPlan(input: {
    routePlan: Pick<RouteExecutionPlan, 'intent' | 'complexity' | 'stage' | 'executionMode' | 'reasons'>;
    modeKernel: ModeKernelResult;
}): LeftBrainActionPlan;
export declare function buildRightBrainResponsePlan(input: {
    text: string;
    modeKernel: ModeKernelResult;
}): RightBrainResponsePlan;
export declare function arbitrateCortex(input: CortexArbiterInput): CortexArbiterResult;
