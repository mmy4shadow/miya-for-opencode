import { randomUUID, createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMediaItem } from '../media/store';
import { getMiyaRuntimeDir } from '../workflow';

export type WizardState =
  | 'idle'
  | 'awaiting_photos'
  | 'training_image'
  | 'awaiting_voice'
  | 'training_voice'
  | 'awaiting_personality'
  | 'completed';

export type CompanionTrainingJobType = 'training.image' | 'training.voice';
export type CompanionTrainingJobStatus =
  | 'queued'
  | 'training'
  | 'completed'
  | 'failed'
  | 'degraded';

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

interface CompanionMetadata {
  profileId: string;
  createdAt: string;
  updatedAt: string;
  version: string;
  assets: {
    photos: {
      count: number;
      paths: string[];
      checksums: string[];
    };
    voice: {
      hasSample: boolean;
      duration: number;
      modelType: string;
    };
    persona: {
      sourceText: string;
      generatedPrompt: string;
    };
  };
  trainingStatus: {
    image: 'pending' | 'training' | 'completed' | 'failed' | 'degraded';
    voice: 'pending' | 'training' | 'completed' | 'failed' | 'degraded';
  };
  sessionBinding: {
    opencodeSessionId: string;
    daemonSessionId: string;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function profilesRoot(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'profiles', 'companion');
}

function currentProfileDir(projectDir: string): string {
  return path.join(profilesRoot(projectDir), 'current');
}

function wizardFilePath(projectDir: string): string {
  return path.join(currentProfileDir(projectDir), 'wizard-session.json');
}

function metadataPath(projectDir: string): string {
  return path.join(currentProfileDir(projectDir), 'metadata.json');
}

function ensureProfileLayout(projectDir: string): void {
  const current = currentProfileDir(projectDir);
  fs.mkdirSync(path.join(current, 'photos'), { recursive: true });
  fs.mkdirSync(path.join(current, 'embeddings'), { recursive: true });
  fs.mkdirSync(path.join(current, 'lora'), { recursive: true });
  fs.mkdirSync(path.join(current, 'voice'), { recursive: true });
  fs.mkdirSync(path.join(profilesRoot(projectDir), 'history'), { recursive: true });
}

function safeReadJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function safeWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function checksumFile(filePath: string): string {
  try {
    const data = fs.readFileSync(filePath);
    return `sha256:${createHash('sha256').update(data).digest('hex')}`;
  } catch {
    return 'sha256:unknown';
  }
}

function extensionForMime(mimeType: string, fallback = '.bin'): string {
  if (mimeType.includes('png')) return '.png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg';
  if (mimeType.includes('webp')) return '.webp';
  if (mimeType.includes('wav')) return '.wav';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return '.mp3';
  if (mimeType.includes('ogg')) return '.ogg';
  return fallback;
}

function defaultMetadata(sessionId: string): CompanionMetadata {
  const now = nowIso();
  return {
    profileId: `companion-${now.replace(/[:.]/g, '-')}`,
    createdAt: now,
    updatedAt: now,
    version: 'v1',
    assets: {
      photos: {
        count: 0,
        paths: [],
        checksums: [],
      },
      voice: {
        hasSample: false,
        duration: 0,
        modelType: 'gpt_sovits_v2',
      },
      persona: {
        sourceText: '',
        generatedPrompt: '',
      },
    },
    trainingStatus: {
      image: 'pending',
      voice: 'pending',
    },
    sessionBinding: {
      opencodeSessionId: sessionId,
      daemonSessionId: `daemon-${sessionId}`,
    },
  };
}

function defaultState(sessionId: string): CompanionWizardState {
  const now = nowIso();
  return {
    sessionId: 'wizard:companion',
    boundSessionId: sessionId || 'main',
    state: 'idle',
    startedAt: now,
    updatedAt: now,
    assets: {
      photos: [],
      voiceSample: '',
      personalityText: '',
    },
    trainingJobs: {},
    jobs: [],
  };
}

function writeMetadata(projectDir: string, metadata: CompanionMetadata): CompanionMetadata {
  const next = { ...metadata, updatedAt: nowIso() };
  safeWriteJson(metadataPath(projectDir), next);
  return next;
}

function readMetadata(projectDir: string, sessionId: string): CompanionMetadata {
  ensureProfileLayout(projectDir);
  const existing = safeReadJson<CompanionMetadata>(metadataPath(projectDir));
  if (existing) return existing;
  const created = defaultMetadata(sessionId);
  writeMetadata(projectDir, created);
  return created;
}

function writeState(projectDir: string, state: CompanionWizardState): CompanionWizardState {
  ensureProfileLayout(projectDir);
  const next = { ...state, updatedAt: nowIso() };
  safeWriteJson(wizardFilePath(projectDir), next);
  return next;
}

export function readCompanionWizardState(
  projectDir: string,
  sessionId = 'main',
): CompanionWizardState {
  ensureProfileLayout(projectDir);
  const existing = safeReadJson<CompanionWizardState>(wizardFilePath(projectDir));
  if (existing) return existing;
  const created = defaultState(sessionId);
  return writeState(projectDir, created);
}

export function startCompanionWizard(
  projectDir: string,
  input?: { sessionId?: string; forceReset?: boolean },
): CompanionWizardState {
  ensureProfileLayout(projectDir);
  const sessionId = input?.sessionId ?? 'main';
  if (input?.forceReset) {
    const current = currentProfileDir(projectDir);
    const historyDir = path.join(
      profilesRoot(projectDir),
      'history',
      new Date().toISOString().replace(/[:.]/g, '-'),
    );
    if (fs.existsSync(current)) {
      fs.mkdirSync(path.dirname(historyDir), { recursive: true });
      fs.cpSync(current, historyDir, { recursive: true });
      fs.rmSync(current, { recursive: true, force: true });
    }
    ensureProfileLayout(projectDir);
  }

  const state = writeState(projectDir, {
    ...defaultState(sessionId),
    state: 'awaiting_photos',
    startedAt: nowIso(),
  });
  writeMetadata(projectDir, defaultMetadata(sessionId));
  return state;
}

export function resetCompanionWizard(projectDir: string): CompanionWizardState {
  const current = currentProfileDir(projectDir);
  if (fs.existsSync(current)) {
    const historyDir = path.join(
      profilesRoot(projectDir),
      'history',
      new Date().toISOString().replace(/[:.]/g, '-'),
    );
    fs.mkdirSync(path.dirname(historyDir), { recursive: true });
    fs.cpSync(current, historyDir, { recursive: true });
    fs.rmSync(current, { recursive: true, force: true });
  }
  ensureProfileLayout(projectDir);
  writeMetadata(projectDir, defaultMetadata('main'));
  return writeState(projectDir, {
    ...defaultState('main'),
    state: 'idle',
  });
}

function copyMediaToProfile(
  projectDir: string,
  mediaIDs: string[],
  targetDir: string,
  maxCount: number,
): string[] {
  const output: string[] = [];
  fs.mkdirSync(targetDir, { recursive: true });
  for (const mediaID of mediaIDs.slice(0, maxCount)) {
    const item = getMediaItem(projectDir, mediaID);
    if (!item?.localPath || !fs.existsSync(item.localPath)) continue;
    const ext = path.extname(item.fileName) || extensionForMime(item.mimeType);
    const fileName = `${String(output.length + 1).padStart(2, '0')}_original${ext}`;
    const filePath = path.join(targetDir, fileName);
    fs.copyFileSync(item.localPath, filePath);
    output.push(filePath);
  }
  return output;
}

function enqueueJob(state: CompanionWizardState, input: {
  type: CompanionTrainingJobType;
  estimatedTime: string;
  fallbackStrategy: string;
}): CompanionWizardState {
  const job: CompanionTrainingJob = {
    id: `wjob_${randomUUID()}`,
    type: input.type,
    status: 'queued',
    progress: 0,
    estimatedTime: input.estimatedTime,
    fallbackStrategy: input.fallbackStrategy,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  return {
    ...state,
    jobs: [...state.jobs, job],
    trainingJobs: {
      ...state.trainingJobs,
      imageJobId: input.type === 'training.image' ? job.id : state.trainingJobs.imageJobId,
      voiceJobId: input.type === 'training.voice' ? job.id : state.trainingJobs.voiceJobId,
    },
  };
}

export function submitWizardPhotos(
  projectDir: string,
  input: { mediaIDs: string[]; sessionId?: string },
): { state: CompanionWizardState; job: CompanionTrainingJob } {
  const current = readCompanionWizardState(projectDir, input.sessionId);
  if (input.mediaIDs.length === 0) throw new Error('invalid_photo_input');
  const photosDir = path.join(currentProfileDir(projectDir), 'photos');
  fs.rmSync(photosDir, { recursive: true, force: true });
  const copied = copyMediaToProfile(projectDir, input.mediaIDs, photosDir, 5);
  if (copied.length === 0) throw new Error('photo_assets_not_found');

  const withJob = enqueueJob(
    {
      ...current,
      state: 'training_image',
      assets: {
        ...current.assets,
        photos: copied,
      },
    },
    {
      type: 'training.image',
      estimatedTime: '约5-10分钟',
      fallbackStrategy: '若显存不足将自动降级到embedding方案',
    },
  );
  const written = writeState(projectDir, withJob);
  const metadata = readMetadata(projectDir, written.boundSessionId);
  writeMetadata(projectDir, {
    ...metadata,
    assets: {
      ...metadata.assets,
      photos: {
        count: copied.length,
        paths: copied.map((item) => path.relative(currentProfileDir(projectDir), item)),
        checksums: copied.map((item) => checksumFile(item)),
      },
    },
    trainingStatus: {
      ...metadata.trainingStatus,
      image: 'pending',
    },
  });
  const job = written.jobs.find((item) => item.id === written.trainingJobs.imageJobId);
  if (!job) throw new Error('image_job_not_created');
  return { state: written, job };
}

export function submitWizardVoice(
  projectDir: string,
  input: { mediaID: string; sessionId?: string },
): { state: CompanionWizardState; job: CompanionTrainingJob } {
  const current = readCompanionWizardState(projectDir, input.sessionId);
  if (current.state !== 'awaiting_voice') {
    throw new Error(`wizard_state_invalid:${current.state}`);
  }
  const voiceDir = path.join(currentProfileDir(projectDir), 'voice');
  fs.mkdirSync(voiceDir, { recursive: true });
  const copied = copyMediaToProfile(projectDir, [input.mediaID], voiceDir, 1);
  if (copied.length === 0) throw new Error('voice_asset_not_found');
  const voicePath = path.join(voiceDir, 'original_sample.wav');
  fs.copyFileSync(copied[0] as string, voicePath);

  const withJob = enqueueJob(
    {
      ...current,
      state: 'training_voice',
      assets: {
        ...current.assets,
        voiceSample: voicePath,
      },
    },
    {
      type: 'training.voice',
      estimatedTime: '约3-8分钟',
      fallbackStrategy: '若显存不足将自动降级到embedding方案',
    },
  );
  const written = writeState(projectDir, withJob);
  const metadata = readMetadata(projectDir, written.boundSessionId);
  writeMetadata(projectDir, {
    ...metadata,
    assets: {
      ...metadata.assets,
      voice: {
        hasSample: true,
        duration: 0,
        modelType: 'gpt_sovits_v2',
      },
    },
    trainingStatus: {
      ...metadata.trainingStatus,
      voice: 'pending',
    },
  });
  const job = written.jobs.find((item) => item.id === written.trainingJobs.voiceJobId);
  if (!job) throw new Error('voice_job_not_created');
  return { state: written, job };
}

export function submitWizardPersonality(
  projectDir: string,
  input: { personalityText: string; sessionId?: string },
): CompanionWizardState {
  const current = readCompanionWizardState(projectDir, input.sessionId);
  if (current.state !== 'awaiting_personality') {
    throw new Error(`wizard_state_invalid:${current.state}`);
  }
  const text = input.personalityText.trim();
  if (!text) throw new Error('invalid_personality_text');
  const personaPath = path.join(currentProfileDir(projectDir), 'persona.json');
  const persona = {
    sourceText: text,
    generatedPrompt: `system: ${text}`,
    updatedAt: nowIso(),
  };
  safeWriteJson(personaPath, persona);
  const next = writeState(projectDir, {
    ...current,
    state: 'completed',
    assets: {
      ...current.assets,
      personalityText: text,
    },
  });
  const metadata = readMetadata(projectDir, next.boundSessionId);
  writeMetadata(projectDir, {
    ...metadata,
    assets: {
      ...metadata.assets,
      persona: {
        sourceText: text,
        generatedPrompt: persona.generatedPrompt,
      },
    },
  });
  return next;
}

export function pickQueuedTrainingJob(projectDir: string): CompanionTrainingJob | null {
  const state = readCompanionWizardState(projectDir);
  if (state.jobs.some((item) => item.status === 'training')) return null;
  return state.jobs.find((item) => item.status === 'queued') ?? null;
}

export function markTrainingJobRunning(
  projectDir: string,
  jobID: string,
): CompanionWizardState {
  const current = readCompanionWizardState(projectDir);
  const updated = writeState(projectDir, {
    ...current,
    jobs: current.jobs.map((job) =>
      job.id === jobID
        ? { ...job, status: 'training', progress: Math.max(5, job.progress), updatedAt: nowIso() }
        : job,
    ),
  });
  const job = updated.jobs.find((item) => item.id === jobID);
  if (!job) return updated;
  const metadata = readMetadata(projectDir, updated.boundSessionId);
  if (job.type === 'training.image') {
    writeMetadata(projectDir, {
      ...metadata,
      trainingStatus: { ...metadata.trainingStatus, image: 'training' },
    });
  } else {
    writeMetadata(projectDir, {
      ...metadata,
      trainingStatus: { ...metadata.trainingStatus, voice: 'training' },
    });
  }
  return updated;
}

export function markTrainingJobFinished(
  projectDir: string,
  input: {
    jobID: string;
    status: CompanionTrainingJobStatus;
    message: string;
    tier?: 'lora' | 'embedding' | 'reference';
  },
): CompanionWizardState {
  const current = readCompanionWizardState(projectDir);
  const job = current.jobs.find((item) => item.id === input.jobID);
  if (!job) return current;
  const nextState =
    job.type === 'training.image'
      ? input.status === 'failed'
        ? 'training_image'
        : 'awaiting_voice'
      : input.status === 'failed'
        ? 'training_voice'
        : 'awaiting_personality';
  const updated = writeState(projectDir, {
    ...current,
    state: nextState,
    jobs: current.jobs.map((item) =>
      item.id === input.jobID
        ? {
            ...item,
            status: input.status,
            message: input.message,
            progress: input.status === 'failed' ? item.progress : 100,
            currentTier: input.tier,
            updatedAt: nowIso(),
          }
        : item,
    ),
  });
  const metadata = readMetadata(projectDir, updated.boundSessionId);
  if (job.type === 'training.image') {
    writeMetadata(projectDir, {
      ...metadata,
      trainingStatus: {
        ...metadata.trainingStatus,
        image:
          input.status === 'completed'
            ? 'completed'
            : input.status === 'degraded'
              ? 'degraded'
              : 'failed',
      },
    });
  } else {
    writeMetadata(projectDir, {
      ...metadata,
      trainingStatus: {
        ...metadata.trainingStatus,
        voice:
          input.status === 'completed'
            ? 'completed'
            : input.status === 'degraded'
              ? 'degraded'
              : 'failed',
      },
    });
  }
  return updated;
}

export function getCompanionProfileCurrentDir(projectDir: string): string {
  ensureProfileLayout(projectDir);
  return currentProfileDir(projectDir);
}

export function getWizardJobById(
  projectDir: string,
  jobID: string,
): CompanionTrainingJob | null {
  const state = readCompanionWizardState(projectDir);
  return state.jobs.find((job) => job.id === jobID) ?? null;
}

export function wizardChecklist(state: CompanionWizardState): string[] {
  return [
    state.assets.photos.length > 0 ? 'visual:done' : 'visual:pending',
    state.assets.voiceSample ? 'voice:done' : 'voice:pending',
    state.assets.personalityText ? 'persona:done' : 'persona:pending',
  ];
}
