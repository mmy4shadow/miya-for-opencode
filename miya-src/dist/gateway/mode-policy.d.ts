export interface ModePolicyFreezeV1 {
    version: '2026-02-16.mode-policy.v1';
    unresolvedFallbackMode: 'work';
    workExecutionPersona: 'zero';
    workExecutionAddressing: 'strip_all';
    notes: string[];
}
export declare const MODE_POLICY_FREEZE_V1: ModePolicyFreezeV1;
export declare function stripWorkAffectionatePrefix(text: string): {
    text: string;
    stripped: boolean;
};
