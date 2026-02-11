import type { PluginInput } from '@opencode-ai/plugin';
import { type ToolDefinition } from '@opencode-ai/plugin';
import { listRecentSelfApprovalRecords, readKillSwitch } from './store';
export interface PermissionAskInput {
    sessionID: string;
    permission: string;
    patterns?: string[];
    metadata?: Record<string, unknown>;
    messageID?: string;
    toolCallID?: string;
    tool?: {
        messageID?: string;
        callID?: string;
    };
}
export declare function handlePermissionAsk(projectDir: string, input: PermissionAskInput): Promise<{
    status: 'allow' | 'deny';
    reason: string;
}>;
export declare function getSafetySnapshot(projectDir: string): {
    kill: ReturnType<typeof readKillSwitch>;
    recent: ReturnType<typeof listRecentSelfApprovalRecords>;
};
export declare function createSafetyTools(ctx: PluginInput): Record<string, ToolDefinition>;
