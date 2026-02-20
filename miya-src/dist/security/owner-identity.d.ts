export type InteractionMode = 'owner' | 'guest' | 'unknown';
export interface VoiceprintThresholds {
    ownerMinScore: number;
    guestMaxScore: number;
    ownerMinLiveness: number;
    guestMaxLiveness: number;
    ownerMinDiarizationRatio: number;
    minSampleDurationSec: number;
    farTarget: number;
    frrTarget: number;
}
export interface OwnerIdentityState {
    initialized: boolean;
    passwordHash?: string;
    passphraseHash?: string;
    voiceprintModelPath: string;
    voiceprintSampleDir: string;
    voiceprintEmbeddingID?: string;
    voiceprintThresholds: VoiceprintThresholds;
    mode: InteractionMode;
    lastSpeakerAt?: string;
    updatedAt: string;
}
export declare function readOwnerIdentityState(projectDir: string): OwnerIdentityState;
export declare function writeOwnerIdentityState(projectDir: string, state: OwnerIdentityState): OwnerIdentityState;
export declare function initOwnerIdentity(projectDir: string, input: {
    password: string;
    passphrase: string;
    voiceprintEmbeddingID?: string;
    voiceprintModelPath?: string;
    voiceprintSampleDir?: string;
    voiceprintThresholds?: Partial<VoiceprintThresholds>;
}): OwnerIdentityState;
export declare function verifyOwnerSecrets(projectDir: string, input: {
    password?: string;
    passphrase?: string;
}): boolean;
export declare function verifyOwnerPasswordOnly(projectDir: string, password?: string): boolean;
export declare function rotateOwnerSecrets(projectDir: string, input: {
    currentPassword?: string;
    currentPassphrase?: string;
    newPassword: string;
    newPassphrase: string;
}): OwnerIdentityState;
export declare function updateVoiceprintThresholds(projectDir: string, patch: Partial<VoiceprintThresholds>): OwnerIdentityState;
export declare function resolveInteractionMode(projectDir: string, input: {
    speakerHint?: string;
    speakerScore?: number;
}): InteractionMode;
export declare function setInteractionMode(projectDir: string, mode: InteractionMode): OwnerIdentityState;
export declare function appendGuestConversation(projectDir: string, input: {
    text: string;
    source: string;
    sessionID: string;
}): void;
