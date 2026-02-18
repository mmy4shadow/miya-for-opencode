import type { AutopilotCommandResult, AutopilotPlan } from './types';
export declare function summarizeAutopilotPlan(plan: AutopilotPlan): string;
export declare function summarizeVerification(result: AutopilotCommandResult | undefined): string;
