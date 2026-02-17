import type { AutopilotPlan } from './types';
export declare function createAutopilotPlan(goal: string): AutopilotPlan;
export declare function attachCommandSteps(plan: AutopilotPlan, commands: string[], verificationCommand?: string): AutopilotPlan;
