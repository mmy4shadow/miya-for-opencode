import { type SourcePackGovernanceRecord } from './governance';
export interface SourcePack {
    sourcePackID: string;
    name: string;
    skillName: string;
    repo?: string;
    localDir: string;
    branch: string;
    headRevision: string;
    latestRevision?: string;
    lastPulledAt?: string;
    trustLevel: 'allowlisted' | 'untrusted' | 'unknown';
    importPlan?: ImportPlan;
    pinnedRelease?: PinnedRelease;
    governance?: SourcePackGovernanceRecord;
}
export interface ImportPlan {
    sourcePackID: string;
    localDir: string;
    importMode: 'skills_only';
    permissionMode: 'sandbox_read_only';
    createdAt: string;
    updatedAt: string;
}
export interface PinnedRelease {
    sourcePackID: string;
    revision: string;
    previousRevision?: string;
    appliedAt: string;
}
export interface EcosystemBridgeConflict {
    type: 'skill_name_collision';
    skillName: string;
    sourcePackIDs: string[];
}
export interface EcosystemBridgeListResult {
    sourcePacks: SourcePack[];
    importPlans: ImportPlan[];
    pinnedReleases: PinnedRelease[];
    conflicts: EcosystemBridgeConflict[];
}
export interface SourcePackDiffResult {
    sourcePackID: string;
    localDir: string;
    headRevision: string;
    compareRevision: string;
    compareRef: string;
    ahead: number;
    behind: number;
    pendingCommits: string[];
    pinnedRelease?: PinnedRelease;
}
export interface SourcePackPullResult {
    sourcePackID: string;
    localDir: string;
    latestRevision: string;
    compareRef: string;
    pulledAt: string;
    governance?: SourcePackGovernanceRecord;
}
export interface SourcePackApplyResult {
    sourcePackID: string;
    localDir: string;
    appliedRevision: string;
    previousRevision?: string;
    detachedHead: boolean;
    governance?: SourcePackGovernanceRecord;
}
export interface SourcePackRollbackResult {
    sourcePackID: string;
    localDir: string;
    rolledBackTo: string;
    previousRevision: string;
    detachedHead: boolean;
    governance?: SourcePackGovernanceRecord;
}
interface GitCommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
type GitRunner = (args: string[], cwd: string) => GitCommandResult;
export interface EcosystemBridgeOptions {
    gitRunner?: GitRunner;
    now?: () => string;
    sourceRoots?: string[];
}
export declare function listEcosystemBridge(projectDir: string, options?: EcosystemBridgeOptions): EcosystemBridgeListResult;
export declare function pullSourcePack(projectDir: string, sourcePackID: string, options?: EcosystemBridgeOptions): SourcePackPullResult;
export declare function diffSourcePack(projectDir: string, sourcePackID: string, options?: EcosystemBridgeOptions): SourcePackDiffResult;
export declare function applySourcePack(projectDir: string, sourcePackID: string, input?: {
    revision?: string;
}, options?: EcosystemBridgeOptions): SourcePackApplyResult;
export declare function rollbackSourcePack(projectDir: string, sourcePackID: string, options?: EcosystemBridgeOptions): SourcePackRollbackResult;
export declare function verifySourcePackGovernance(projectDir: string, sourcePackID: string, options?: EcosystemBridgeOptions): {
    sourcePackID: string;
    localDir: string;
    revision: string;
    signatureValid: boolean;
    lockValid: boolean;
    compatibilityValid: boolean;
    smokeValid: boolean;
    governance?: SourcePackGovernanceRecord;
};
export {};
