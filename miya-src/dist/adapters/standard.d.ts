export interface EvidenceBundle {
    kind: string;
    version: string;
    adapter: string;
    auditID: string;
    ok: boolean;
    summary: string;
    raw?: unknown;
    diagnostics?: Record<string, unknown>;
}
export interface MiyaAdapter<TInput = unknown, TOutput = unknown> {
    validateInput(input: TInput): boolean;
    injectPermission(auditID: string): Record<string, unknown>;
    execute(input: TInput): Promise<TOutput>;
    normalizeOutput(raw: TOutput, auditID: string): EvidenceBundle;
}
export interface AdapterRpcRequest {
    id: string;
    method: string;
    params: Record<string, unknown>;
}
export interface AdapterRpcResponse {
    id: string;
    ok: boolean;
    result?: unknown;
    error?: {
        code: string;
        message: string;
        details?: unknown;
    };
}
export declare function toAdapterEvidence(input: {
    adapter: string;
    auditID: string;
    ok: boolean;
    summary: string;
    raw?: unknown;
    diagnostics?: Record<string, unknown>;
}): EvidenceBundle;
