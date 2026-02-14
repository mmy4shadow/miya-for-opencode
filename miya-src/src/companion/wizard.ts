import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { patchCompanionProfile, readCompanionProfile } from './store';
import { getMiyaRuntimeDir } from '../workflow';

export type CompanionWizardStep =
  | 'collect_images'
  | 'collect_audio'
  | 'collect_text'
  | 'training'
  | 'done';

export type CompanionTrainingJobType = 'training.image' | 'training.voice';
export type CompanionTrainingJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface CompanionTrainingJob {
  id: string;
  type: CompanionTrainingJobType;
  status: CompanionTrainingJobStatus;
  progress: number;
  modelID: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface CompanionWizardState {
  sessionID: string;
  active: boolean;
  startedAt: string;
  updatedAt: string;
  step: CompanionWizardStep;
  imageMediaIDs: string[];
  audioMediaIDs: string[];
  personaText: string;
  jobs: CompanionTrainingJob[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'companion-wizard.json');
}

function ensureDir(projectDir: string): void {
  fs.mkdirSync(path.dirname(filePath(projectDir)), { recursive: true });
}

function defaultState(): CompanionWizardState {
  return {
    sessionID: 'wizard:companion',
    active: false,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    step: 'collect_images',
    imageMediaIDs: [],
    audioMediaIDs: [],
    personaText: '',
    jobs: [],
  };
}

export function readCompanionWizardState(projectDir: string): CompanionWizardState {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) return defaultState();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<CompanionWizardState>;
    return {
      ...defaultState(),
      ...parsed,
      imageMediaIDs: Array.isArray(parsed.imageMediaIDs) ? parsed.imageMediaIDs.map(String) : [],
      audioMediaIDs: Array.isArray(parsed.audioMediaIDs) ? parsed.audioMediaIDs.map(String) : [],
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
    };
  } catch {
    return defaultState();
  }
}

function writeState(projectDir: string, state: CompanionWizardState): CompanionWizardState {
  ensureDir(projectDir);
  const next: CompanionWizardState = {
    ...state,
    updatedAt: nowIso(),
  };
  fs.writeFileSync(filePath(projectDir), `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

function nextStep(state: CompanionWizardState): CompanionWizardStep {
  if (state.imageMediaIDs.length === 0) return 'collect_images';
  if (state.audioMediaIDs.length === 0) return 'collect_audio';
  if (!state.personaText.trim()) return 'collect_text';
  if (state.jobs.some((job) => job.status === 'queued' || job.status === 'running')) {
    return 'training';
  }
  if (state.jobs.length > 0 && state.jobs.every((job) => job.status === 'completed')) {
    return 'done';
  }
  return 'training';
}

export function startCompanionWizard(projectDir: string): CompanionWizardState {
  const state = readCompanionWizardState(projectDir);
  return writeState(projectDir, {
    ...state,
    active: true,
    startedAt: nowIso(),
    step: 'collect_images',
    jobs: [],
  });
}

export function submitCompanionWizardInput(
  projectDir: string,
  input: {
    imageMediaIDs?: string[];
    audioMediaIDs?: string[];
    personaText?: string;
  },
): CompanionWizardState {
  const current = readCompanionWizardState(projectDir);
  const imageMediaIDs = [
    ...new Set([...(current.imageMediaIDs ?? []), ...(input.imageMediaIDs ?? []).map(String)]),
  ].slice(0, 5);
  const audioMediaIDs = [
    ...new Set([...(current.audioMediaIDs ?? []), ...(input.audioMediaIDs ?? []).map(String)]),
  ].slice(0, 20);
  const personaText = input.personaText?.trim() ?? current.personaText;

  const next = writeState(projectDir, {
    ...current,
    active: true,
    imageMediaIDs,
    audioMediaIDs,
    personaText,
  });
  return enqueueCompanionTrainingJobs(projectDir, next);
}

function ensureJob(
  jobs: CompanionTrainingJob[],
  input: { type: CompanionTrainingJobType; modelID: string; enabled: boolean },
): CompanionTrainingJob[] {
  if (!input.enabled) return jobs.filter((job) => job.type !== input.type);
  const existing = jobs.find((job) => job.type === input.type);
  if (existing) return jobs;
  return [
    ...jobs,
    {
      id: `wjob_${randomUUID()}`,
      type: input.type,
      status: 'queued',
      progress: 0,
      modelID: input.modelID,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];
}

export function enqueueCompanionTrainingJobs(
  projectDir: string,
  state?: CompanionWizardState,
): CompanionWizardState {
  const current = state ?? readCompanionWizardState(projectDir);
  let jobs = [...current.jobs];
  const ready = current.imageMediaIDs.length > 0 && current.audioMediaIDs.length > 0;
  if (ready) {
    jobs = ensureJob(jobs, {
      type: 'training.image',
      modelID: 'local:flux.1-schnell',
      enabled: current.imageMediaIDs.length > 0,
    });
    jobs = ensureJob(jobs, {
      type: 'training.voice',
      modelID: 'local:gpt-sovits-v2pro',
      enabled: current.audioMediaIDs.length > 0,
    });
  }
  const next = writeState(projectDir, {
    ...current,
    jobs,
  });
  return writeState(projectDir, {
    ...next,
    step: nextStep(next),
  });
}

export function tickCompanionTrainingJobs(projectDir: string): {
  state: CompanionWizardState;
  changed: boolean;
  progressEvent?: {
    jobID: string;
    type: CompanionTrainingJobType;
    status: CompanionTrainingJobStatus;
    progress: number;
  };
} {
  const current = readCompanionWizardState(projectDir);
  if (!current.active) return { state: current, changed: false };

  const running = current.jobs.find((job) => job.status === 'running');
  if (!running) {
    const queued = current.jobs.find((job) => job.status === 'queued');
    if (!queued) {
      const final = writeState(projectDir, {
        ...current,
        step: nextStep(current),
      });
      if (final.step === 'done') {
        patchCompanionProfile(projectDir, {
          onboardingCompleted: true,
          enabled: readCompanionProfile(projectDir).enabled || true,
        });
      }
      return { state: final, changed: final.step !== current.step };
    }

    const started = writeState(projectDir, {
      ...current,
      jobs: current.jobs.map((job) =>
        job.id === queued.id
          ? { ...job, status: 'running', progress: Math.max(5, job.progress), updatedAt: nowIso() }
          : job,
      ),
      step: 'training',
    });
    const nextJob = started.jobs.find((job) => job.id === queued.id);
    return {
      state: started,
      changed: true,
      progressEvent: nextJob
        ? {
            jobID: nextJob.id,
            type: nextJob.type,
            status: nextJob.status,
            progress: nextJob.progress,
          }
        : undefined,
    };
  }

  const nextProgress = Math.min(100, running.progress + 20);
  const nextStatus: CompanionTrainingJobStatus = nextProgress >= 100 ? 'completed' : 'running';
  const next = writeState(projectDir, {
    ...current,
    jobs: current.jobs.map((job) =>
      job.id === running.id
        ? { ...job, progress: nextProgress, status: nextStatus, updatedAt: nowIso() }
        : job,
    ),
  });
  const withStep = writeState(projectDir, {
    ...next,
    step: nextStep(next),
  });
  if (withStep.step === 'done') {
    patchCompanionProfile(projectDir, {
      onboardingCompleted: true,
      enabled: true,
    });
  }
  const job = withStep.jobs.find((item) => item.id === running.id) ?? running;
  return {
    state: withStep,
    changed: true,
    progressEvent: {
      jobID: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
    },
  };
}

export function wizardChecklist(state: CompanionWizardState): string[] {
  return [
    state.imageMediaIDs.length > 0 ? 'images:done' : 'images:pending',
    state.audioMediaIDs.length > 0 ? 'audio:done' : 'audio:pending',
    state.personaText.trim() ? 'persona:done' : 'persona:pending',
    state.step === 'done' ? 'training:done' : 'training:pending',
  ];
}
