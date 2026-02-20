export type AgentRuntimeModelHealth = 'healthy' | 'degraded' | 'unavailable';
export interface AgentRuntimeModelState {
    agentName: string;
    model: string;
    providerID?: string;
    variant?: string;
    updatedAt: string;
    source: 'runtime' | 'default';
    active: boolean;
    healthStatus: AgentRuntimeModelHealth;
}
export declare class AgentModelRuntimeApi {
    private readonly projectDir;
    constructor(projectDir: string);
    list(): {
        activeAgentId: string | undefined;
        revision: number;
        agents: AgentRuntimeModelState[];
    };
    set(input: {
        agentName: string;
        model: unknown;
        variant?: unknown;
        providerID?: unknown;
        options?: unknown;
        apiKey?: unknown;
        baseURL?: unknown;
        activate?: boolean;
    }): {
        changed: boolean;
    };
    reset(input: {
        agentName: string;
        clearActive?: boolean;
        activeAgentId?: string;
    }): {
        changed: boolean;
    };
    private resolveHealthStatus;
}
