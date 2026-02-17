import type { BackgroundTaskManager } from '../../background';
interface PersistentAutoflowEventInput {
    type?: string;
    properties?: {
        sessionID?: string;
        stopIntent?: {
            token?: string;
            source?: string;
        };
        status?: {
            type?: string;
            reason?: string;
            source?: string;
        };
        reason?: string;
        source?: string;
    };
}
export declare function createPersistentAutoflowHook(projectDir: string, manager: BackgroundTaskManager): {
    onEvent: (event: PersistentAutoflowEventInput) => Promise<import("../../autoflow/persistent").AutoflowPersistentEventResult>;
};
export {};
