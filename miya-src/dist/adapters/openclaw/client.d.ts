import type { EvidenceBundle, MiyaAdapter } from '../standard';
export interface OpenClawAdapterInput {
    method: string;
    params?: Record<string, unknown>;
    timeoutMs?: number;
}
interface OpenClawAdapterOutput {
    ok: boolean;
    result?: unknown;
    error?: {
        code: string;
        message: string;
        details?: unknown;
    };
}
export declare class OpenClawAdapter implements MiyaAdapter<OpenClawAdapterInput, OpenClawAdapterOutput> {
    private readonly projectDir;
    constructor(projectDir: string);
    validateInput(input: OpenClawAdapterInput): boolean;
    injectPermission(auditID: string): Record<string, unknown>;
    execute(input: OpenClawAdapterInput): Promise<OpenClawAdapterOutput>;
    normalizeOutput(raw: OpenClawAdapterOutput, auditID: string): EvidenceBundle;
}
export {};
