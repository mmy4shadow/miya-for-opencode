export type WizardState = 'idle' | 'awaiting_photos' | 'training_image' | 'awaiting_voice' | 'training_voice' | 'awaiting_personality' | 'completed';
export type CompanionTrainingJobType = 'training.image' | 'training.voice';
export type CompanionTrainingJobStatus = 'queued' | 'training' | 'completed' | 'failed' | 'degraded' | 'canceled';
export interface CompanionTrainingJob {
    id: string;
    type: CompanionTrainingJobType;
    status: CompanionTrainingJobStatus;
    progress: number;
    currentTier?: 'lora' | 'embedding' | 'reference';
    estimatedTime: string;
    fallbackStrategy: string;
    createdAt: string;
    updatedAt: string;
    message?: string;
    error?: string;
    attempts: number;
    checkpointPath?: string;
}
export interface CompanionWizardState {
    sessionId: string;
    boundSessionId: string;
    state: WizardState;
    startedAt: string;
    updatedAt: string;
    assets: {
        photos: string[];
        voiceSample: string;
        personalityText: string;
    };
    trainingJobs: {
        imageJobId?: string;
        voiceJobId?: string;
    };
    jobs: CompanionTrainingJob[];
}
export declare function listCompanionWizardSessions(projectDir: string): string[];
export declare function readCompanionWizardState(projectDir: string, sessionId?: string): CompanionWizardState;
export declare function isCompanionWizardEmpty(projectDir: string, sessionId?: string): boolean;
export declare function startCompanionWizard(projectDir: string, input?: {
    sessionId?: string;
    forceReset?: boolean;
}): CompanionWizardState;
export declare function resetCompanionWizard(projectDir: string, sessionId?: string): CompanionWizardState;
export declare function submitWizardPhotos(projectDir: string, input: {
    mediaIDs: string[];
    sessionId?: string;
}): {
    state: CompanionWizardState;
    job: CompanionTrainingJob;
};
export declare function submitWizardVoice(projectDir: string, input: {
    mediaID: string;
    sessionId?: string;
}): {
    state: CompanionWizardState;
    job: CompanionTrainingJob;
};
export declare function submitWizardPersonality(projectDir: string, input: {
    personalityText: string;
    sessionId?: string;
}): CompanionWizardState;
export interface QueuedWizardTrainingJob {
    sessionId: string;
    job: CompanionTrainingJob;
}
export declare function pickQueuedTrainingJob(projectDir: string, sessionId?: string): QueuedWizardTrainingJob | null;
export declare function markTrainingJobRunning(projectDir: string, jobID: string, sessionId?: string): CompanionWizardState;
export declare function requeueTrainingJob(projectDir: string, input: {
    sessionId?: string;
    jobID: string;
    checkpointPath?: string;
    message: string;
}): CompanionWizardState;
export declare function markTrainingJobFinished(projectDir: string, input: {
    sessionId?: string;
    jobID: string;
    status: CompanionTrainingJobStatus;
    message: string;
    tier?: 'lora' | 'embedding' | 'reference';
    checkpointPath?: string;
}): CompanionWizardState;
export declare function cancelCompanionWizardTraining(projectDir: string, sessionId?: string): CompanionWizardState;
export declare function getCompanionProfileCurrentDir(projectDir: string, sessionId?: string): string;
export declare function getWizardJobById(projectDir: string, jobID: string): (CompanionTrainingJob & {
    sessionId: string;
}) | null;
export declare function wizardChecklist(state: CompanionWizardState): string[];
