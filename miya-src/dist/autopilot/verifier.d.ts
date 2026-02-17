import type { AutopilotPlan } from './types';
import type { AutopilotCommandResult } from './types';
export declare function summarizeAutopilotPlan(plan: AutopilotPlan): string;
export declare function summarizeVerification(result: AutopilotCommandResult | undefined): string;
