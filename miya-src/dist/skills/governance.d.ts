export interface SourcePackCompatibilityMatrix {
    ok: boolean;
    currentVersion: string;
    minVersion?: string;
    maxVersion?: string;
    notes?: string;
}
export interface SourcePackSignatureRecord {
    algorithm: 'sha256';
    digest: string;
    verifiedAt: string;
}
export interface SourcePackVersionLockRecord {
    revision: string;
    lockedAt: string;
}
export interface SourcePackSmokeRecord {
    ok: boolean;
    requiredFiles: string[];
    missingFiles: string[];
    checkedAt: string;
}
export interface SourcePackRegressionRecord {
    ok: boolean;
    requiredFiles: string[];
    missingFiles: string[];
    requireTestArtifacts: boolean;
    testArtifacts: string[];
    checkedAt: string;
}
export interface SourcePackSecurityRecord {
    ok: boolean;
    strict: boolean;
    requirePermissionMetadata: boolean;
    checkedSkillFiles: string[];
    missingPermissionMetadata: string[];
    disallowedPermissions: Array<{
        skillFile: string;
        permission: string;
    }>;
    checkedAt: string;
}
export interface SourcePackGovernanceRecord {
    sourcePackID: string;
    revision: string;
    lock: SourcePackVersionLockRecord;
    signature: SourcePackSignatureRecord;
    compatibility: SourcePackCompatibilityMatrix;
    smoke: SourcePackSmokeRecord;
    regression?: SourcePackRegressionRecord;
    security?: SourcePackSecurityRecord;
    updatedAt: string;
}
export declare function refreshSourcePackGovernance(projectDir: string, input: {
    sourcePackID: string;
    localDir: string;
    revision: string;
}): SourcePackGovernanceRecord;
export declare function getSourcePackGovernance(projectDir: string, sourcePackID: string): SourcePackGovernanceRecord | undefined;
export declare function verifySourcePackGovernance(projectDir: string, input: {
    sourcePackID: string;
    localDir: string;
    revision: string;
    strict?: boolean;
}): {
    signatureValid: boolean;
    lockValid: boolean;
    compatibilityValid: boolean;
    smokeValid: boolean;
    regressionValid: boolean;
    securityValid: boolean;
    record?: SourcePackGovernanceRecord;
};
