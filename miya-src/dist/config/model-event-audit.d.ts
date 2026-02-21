import type { AgentModelSelectionFromEvent } from './agent-model-persistence';
export declare function shouldAuditModelEvent(event: unknown): boolean;
export declare function appendModelEventAudit(projectDir: string, input: {
    event: unknown;
    selections?: AgentModelSelectionFromEvent[];
}): void;
