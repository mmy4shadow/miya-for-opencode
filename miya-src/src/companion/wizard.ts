import { createHash, randomUUID } from 'node:crypto';
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
  | 'degraded'
  | 'canceled';

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
    image:
      | 'pending'
      | 'training'
      | 'completed'
      | 'failed'
      | 'degraded'
      | 'canceled';
    voice:
      | 'pending'
      | 'training'
      | 'completed'
      | 'failed'
      | 'degraded'
      | 'canceled';
  };
  sessionBinding: {
    opencodeSessionId: string;
    daemonSessionId: string;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeSessionId(sessionId: string): string {
  const normalized = sessionId.trim().replace(/[^a-zA-Z0-9_-]+/g, '_');
  return normalized || 'main';
}

function profilesRoot(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'profiles', 'companion');
}

function sessionRoot(projectDir: string, sessionId: string): string {
  return path.join(
    profilesRoot(projectDir),
    'sessions',
    normalizeSessionId(sessionId),
  );
}

function currentProfileDir(projectDir: string, sessionId: string): string {
  return path.join(sessionRoot(projectDir, sessionId), 'current');
}

function wizardFilePath(projectDir: string, sessionId: string): string {
  return path.join(
    currentProfileDir(projectDir, sessionId),
    'wizard-state.json',
  );
}

function metadataPath(projectDir: string, sessionId: string): string {
  return path.join(currentProfileDir(projectDir, sessionId), 'metadata.json');
}

function ensureProfileLayout(projectDir: string, sessionId: string): void {
  const current = currentProfileDir(projectDir, sessionId);
  fs.mkdirSync(path.join(current, 'photos'), { recursive: true });
  fs.mkdirSync(path.join(current, 'embeddings'), { recursive: true });
  fs.mkdirSync(path.join(current, 'lora'), { recursive: true });
  fs.mkdirSync(path.join(current, 'voice'), { recursive: true });
  fs.mkdirSync(path.join(sessionRoot(projectDir, sessionId), 'history'), {
    recursive: true,
  });
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
    sessionId: `wizard:companion:${normalizeSessionId(sessionId)}`,
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

function writeMetadata(
  projectDir: string,
  sessionId: string,
  metadata: CompanionMetadata,
): CompanionMetadata {
  const next = { ...metadata, updatedAt: nowIso() };
  safeWriteJson(metadataPath(projectDir, sessionId), next);
  return next;
}

function readMetadata(
  projectDir: string,
  sessionId: string,
): CompanionMetadata {
  ensureProfileLayout(projectDir, sessionId);
  const existing = safeReadJson<CompanionMetadata>(
    metadataPath(projectDir, sessionId),
  );
  if (existing) return existing;
  const created = defaultMetadata(sessionId);
  writeMetadata(projectDir, sessionId, created);
  return created;
}

function writeState(
  projectDir: string,
  sessionId: string,
  state: CompanionWizardState,
): CompanionWizardState {
  ensureProfileLayout(projectDir, sessionId);
  const next = { ...state, updatedAt: nowIso() };
  safeWriteJson(wizardFilePath(projectDir, sessionId), next);
  return next;
}

function moveCurrentToHistory(projectDir: string, sessionId: string): void {
  const current = currentProfileDir(projectDir, sessionId);
  if (!fs.existsSync(current)) return;
  const historyDir = path.join(
    sessionRoot(projectDir, sessionId),
    'history',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  fs.mkdirSync(path.dirname(historyDir), { recursive: true });
  fs.cpSync(current, historyDir, { recursive: true });
  fs.rmSync(current, { recursive: true, force: true });
}

function listSessionDirs(projectDir: string): string[] {
  const root = path.join(profilesRoot(projectDir), 'sessions');
  if (!fs.existsSync(root)) return [];
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // The sessions folder may be removed between exists-check and readdir under concurrent cleanup.
    return [];
  }
}

function sessionHasWizardFile(
  projectDir: string,
  sessionDirName: string,
): boolean {
  const file = path.join(
    profilesRoot(projectDir),
    'sessions',
    sessionDirName,
    'current',
    'wizard-state.json',
  );
  return fs.existsSync(file);
}

function stateHasAssets(state: CompanionWizardState): boolean {
  return (
    state.assets.photos.length > 0 ||
    Boolean(state.assets.voiceSample) ||
    Boolean(state.assets.personalityText)
  );
}

function findSessionByJobId(projectDir: string, jobID: string): string | null {
  for (const sid of listCompanionWizardSessions(projectDir)) {
    const state = readCompanionWizardState(projectDir, sid);
    if (state.jobs.some((job) => job.id === jobID)) return sid;
  }
  return null;
}

function resolveSessionForWrite(
  projectDir: string,
  requestedSessionId?: string,
): string {
  if (requestedSessionId && requestedSessionId.trim()) {
    return normalizeSessionId(requestedSessionId);
  }
  const sessions = listCompanionWizardSessions(projectDir);
  if (sessions.length === 0) return 'main';
  const active = sessions.filter((sid) => {
    const state = readCompanionWizardState(projectDir, sid);
    return (
      state.state !== 'idle' || stateHasAssets(state) || state.jobs.length > 0
    );
  });
  if (active.length === 1) return active[0] as string;
  if (active.includes('main')) return 'main';
  return (active[0] ?? sessions[0] ?? 'main') as string;
}

export function listCompanionWizardSessions(projectDir: string): string[] {
  return listSessionDirs(projectDir)
    .filter((name) => sessionHasWizardFile(projectDir, name))
    .map((name) => name || 'main');
}

export function readCompanionWizardState(
  projectDir: string,
  sessionId = 'main',
): CompanionWizardState {
  const effectiveSessionId = normalizeSessionId(sessionId);
  ensureProfileLayout(projectDir, effectiveSessionId);
  const existing = safeReadJson<CompanionWizardState>(
    wizardFilePath(projectDir, effectiveSessionId),
  );
  if (existing) return existing;
  const created = defaultState(effectiveSessionId);
  return writeState(projectDir, effectiveSessionId, created);
}

export function isCompanionWizardEmpty(
  projectDir: string,
  sessionId = 'main',
): boolean {
  const state = readCompanionWizardState(projectDir, sessionId);
  if (stateHasAssets(state)) return false;
  if (state.jobs.length > 0) return false;
  return state.state === 'idle';
}

export function startCompanionWizard(
  projectDir: string,
  input?: { sessionId?: string; forceReset?: boolean },
): CompanionWizardState {
  const sessionId = normalizeSessionId(input?.sessionId ?? 'main');
  ensureProfileLayout(projectDir, sessionId);

  if (input?.forceReset) {
    moveCurrentToHistory(projectDir, sessionId);
    ensureProfileLayout(projectDir, sessionId);
  }

  const existing = readCompanionWizardState(projectDir, sessionId);
  if (
    !input?.forceReset &&
    (stateHasAssets(existing) || existing.state !== 'idle')
  ) {
    return existing;
  }

  const state = writeState(projectDir, sessionId, {
    ...defaultState(sessionId),
    state: 'awaiting_photos',
    startedAt: nowIso(),
  });
  writeMetadata(projectDir, sessionId, defaultMetadata(sessionId));
  return state;
}

export function resetCompanionWizard(
  projectDir: string,
  sessionId = 'main',
): CompanionWizardState {
  const effectiveSessionId = normalizeSessionId(sessionId);
  moveCurrentToHistory(projectDir, effectiveSessionId);
  ensureProfileLayout(projectDir, effectiveSessionId);
  writeMetadata(
    projectDir,
    effectiveSessionId,
    defaultMetadata(effectiveSessionId),
  );
  return writeState(projectDir, effectiveSessionId, {
    ...defaultState(effectiveSessionId),
    state: 'idle',
  });
}

function copyMediaToProfile(
  projectDir: string,
  mediaIDs: string[],
  targetDir: string,
): string[] {
  const output: string[] = [];
  fs.mkdirSync(targetDir, { recursive: true });
  for (const mediaID of mediaIDs) {
    const item = getMediaItem(projectDir, mediaID);
    if (!item?.localPath || !fs.existsSync(item.localPath)) {
      throw new Error(`media_asset_not_found:${mediaID}`);
    }
    const ext = path.extname(item.fileName) || extensionForMime(item.mimeType);
    const fileName = `${String(output.length + 1).padStart(2, '0')}_original${ext}`;
    const filePath = path.join(targetDir, fileName);
    fs.copyFileSync(item.localPath, filePath);
    output.push(filePath);
  }
  return output;
}

function enqueueJob(
  state: CompanionWizardState,
  input: {
    type: CompanionTrainingJobType;
    estimatedTime: string;
    fallbackStrategy: string;
  },
): CompanionWizardState {
  const job: CompanionTrainingJob = {
    id: `wjob_${randomUUID()}`,
    type: input.type,
    status: 'queued',
    progress: 0,
    estimatedTime: input.estimatedTime,
    fallbackStrategy: input.fallbackStrategy,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    attempts: 0,
  };
  return {
    ...state,
    jobs: [...state.jobs, job],
    trainingJobs: {
      ...state.trainingJobs,
      imageJobId:
        input.type === 'training.image'
          ? job.id
          : state.trainingJobs.imageJobId,
      voiceJobId:
        input.type === 'training.voice'
          ? job.id
          : state.trainingJobs.voiceJobId,
    },
  };
}

export function submitWizardPhotos(
  projectDir: string,
  input: { mediaIDs: string[]; sessionId?: string },
): { state: CompanionWizardState; job: CompanionTrainingJob } {
  const sessionId = resolveSessionForWrite(projectDir, input.sessionId);
  const current = readCompanionWizardState(projectDir, sessionId);
  if (current.state !== 'awaiting_photos') {
    throw new Error(`wizard_state_invalid:${current.state}`);
  }
  if (input.mediaIDs.length < 1 || input.mediaIDs.length > 5) {
    throw new Error('wizard_photo_count_invalid:must_be_1_to_5');
  }
  const photosDir = path.join(
    currentProfileDir(projectDir, sessionId),
    'photos',
  );
  fs.rmSync(photosDir, { recursive: true, force: true });
  const copied = copyMediaToProfile(projectDir, input.mediaIDs, photosDir);
  if (
    copied.length < 1 ||
    copied.length > 5 ||
    copied.length !== input.mediaIDs.length
  ) {
    throw new Error('wizard_photo_copy_invalid:must_be_1_to_5');
  }

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
  const written = writeState(projectDir, sessionId, withJob);
  const metadata = readMetadata(projectDir, sessionId);
  writeMetadata(projectDir, sessionId, {
    ...metadata,
    assets: {
      ...metadata.assets,
      photos: {
        count: copied.length,
        paths: copied.map((item) =>
          path.relative(currentProfileDir(projectDir, sessionId), item),
        ),
        checksums: copied.map((item) => checksumFile(item)),
      },
    },
    trainingStatus: {
      ...metadata.trainingStatus,
      image: 'pending',
    },
  });
  const job = written.jobs.find(
    (item) => item.id === written.trainingJobs.imageJobId,
  );
  if (!job) throw new Error('image_job_not_created');
  return { state: written, job };
}

export function submitWizardVoice(
  projectDir: string,
  input: { mediaID: string; sessionId?: string },
): { state: CompanionWizardState; job: CompanionTrainingJob } {
  const sessionId = resolveSessionForWrite(projectDir, input.sessionId);
  const current = readCompanionWizardState(projectDir, sessionId);
  if (current.state !== 'awaiting_voice') {
    throw new Error(`wizard_state_invalid:${current.state}`);
  }
  const voiceDir = path.join(currentProfileDir(projectDir, sessionId), 'voice');
  fs.mkdirSync(voiceDir, { recursive: true });
  const copied = copyMediaToProfile(projectDir, [input.mediaID], voiceDir);
  if (copied.length !== 1) throw new Error('voice_asset_not_found');
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
  const written = writeState(projectDir, sessionId, withJob);
  const metadata = readMetadata(projectDir, sessionId);
  writeMetadata(projectDir, sessionId, {
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
  const job = written.jobs.find(
    (item) => item.id === written.trainingJobs.voiceJobId,
  );
  if (!job) throw new Error('voice_job_not_created');
  return { state: written, job };
}

export function submitWizardPersonality(
  projectDir: string,
  input: { personalityText: string; sessionId?: string },
): CompanionWizardState {
  const sessionId = resolveSessionForWrite(projectDir, input.sessionId);
  const current = readCompanionWizardState(projectDir, sessionId);
  if (current.state !== 'awaiting_personality') {
    throw new Error(`wizard_state_invalid:${current.state}`);
  }
  const text = input.personalityText.trim();
  if (!text) throw new Error('invalid_personality_text');
  const personaPath = path.join(
    currentProfileDir(projectDir, sessionId),
    'persona.json',
  );
  const persona = {
    sourceText: text,
    generatedPrompt: `system: ${text}`,
    updatedAt: nowIso(),
  };
  safeWriteJson(personaPath, persona);
  const next = writeState(projectDir, sessionId, {
    ...current,
    state: 'completed',
    assets: {
      ...current.assets,
      personalityText: text,
    },
  });
  const metadata = readMetadata(projectDir, sessionId);
  writeMetadata(projectDir, sessionId, {
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

export interface QueuedWizardTrainingJob {
  sessionId: string;
  job: CompanionTrainingJob;
}

export function pickQueuedTrainingJob(
  projectDir: string,
  sessionId?: string,
): QueuedWizardTrainingJob | null {
  const targetSessions = sessionId
    ? [normalizeSessionId(sessionId)]
    : listCompanionWizardSessions(projectDir);
  for (const sid of targetSessions) {
    const state = readCompanionWizardState(projectDir, sid);
    if (state.jobs.some((item) => item.status === 'training')) continue;
    const queued = state.jobs.find((item) => item.status === 'queued');
    if (queued) return { sessionId: sid, job: queued };
  }
  return null;
}

export function markTrainingJobRunning(
  projectDir: string,
  jobID: string,
  sessionId = 'main',
): CompanionWizardState {
  const sid = normalizeSessionId(sessionId);
  const resolvedSession =
    sessionId === 'main' ? (findSessionByJobId(projectDir, jobID) ?? sid) : sid;
  const current = readCompanionWizardState(projectDir, resolvedSession);
  const updated = writeState(projectDir, resolvedSession, {
    ...current,
    jobs: current.jobs.map((job) =>
      job.id === jobID
        ? {
            ...job,
            status: 'training',
            progress: Math.max(5, job.progress),
            attempts: job.attempts + 1,
            updatedAt: nowIso(),
          }
        : job,
    ),
  });
  const job = updated.jobs.find((item) => item.id === jobID);
  if (!job) return updated;
  const metadata = readMetadata(projectDir, resolvedSession);
  if (job.type === 'training.image') {
    writeMetadata(projectDir, resolvedSession, {
      ...metadata,
      trainingStatus: { ...metadata.trainingStatus, image: 'training' },
    });
  } else {
    writeMetadata(projectDir, resolvedSession, {
      ...metadata,
      trainingStatus: { ...metadata.trainingStatus, voice: 'training' },
    });
  }
  return updated;
}

export function requeueTrainingJob(
  projectDir: string,
  input: {
    sessionId?: string;
    jobID: string;
    checkpointPath?: string;
    message: string;
  },
): CompanionWizardState {
  const sid = resolveSessionForWrite(projectDir, input.sessionId);
  const current = readCompanionWizardState(projectDir, sid);
  return writeState(projectDir, sid, {
    ...current,
    jobs: current.jobs.map((job) =>
      job.id === input.jobID
        ? {
            ...job,
            status: 'queued',
            progress: Math.max(10, job.progress),
            checkpointPath: input.checkpointPath,
            message: input.message,
            updatedAt: nowIso(),
          }
        : job,
    ),
  });
}

export function markTrainingJobFinished(
  projectDir: string,
  input: {
    sessionId?: string;
    jobID: string;
    status: CompanionTrainingJobStatus;
    message: string;
    tier?: 'lora' | 'embedding' | 'reference';
    checkpointPath?: string;
  },
): CompanionWizardState {
  const sid = normalizeSessionId(input.sessionId ?? 'main');
  const resolvedSession =
    input.sessionId == null
      ? (findSessionByJobId(projectDir, input.jobID) ?? sid)
      : sid;
  const current = readCompanionWizardState(projectDir, resolvedSession);
  const job = current.jobs.find((item) => item.id === input.jobID);
  if (!job) return current;
  const nextState =
    job.type === 'training.image'
      ? input.status === 'failed' || input.status === 'canceled'
        ? 'training_image'
        : 'awaiting_voice'
      : input.status === 'failed' || input.status === 'canceled'
        ? 'training_voice'
        : 'awaiting_personality';
  const updated = writeState(projectDir, resolvedSession, {
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
            checkpointPath: input.checkpointPath ?? item.checkpointPath,
            updatedAt: nowIso(),
          }
        : item,
    ),
  });
  const metadata = readMetadata(projectDir, resolvedSession);
  if (job.type === 'training.image') {
    writeMetadata(projectDir, resolvedSession, {
      ...metadata,
      trainingStatus: {
        ...metadata.trainingStatus,
        image:
          input.status === 'completed'
            ? 'completed'
            : input.status === 'degraded'
              ? 'degraded'
              : input.status === 'canceled'
                ? 'canceled'
                : 'failed',
      },
    });
  } else {
    writeMetadata(projectDir, resolvedSession, {
      ...metadata,
      trainingStatus: {
        ...metadata.trainingStatus,
        voice:
          input.status === 'completed'
            ? 'completed'
            : input.status === 'degraded'
              ? 'degraded'
              : input.status === 'canceled'
                ? 'canceled'
                : 'failed',
      },
    });
  }
  return updated;
}

export function cancelCompanionWizardTraining(
  projectDir: string,
  sessionId = 'main',
): CompanionWizardState {
  const sid = resolveSessionForWrite(projectDir, sessionId);
  const current = readCompanionWizardState(projectDir, sid);
  let hasCanceled = false;
  const nextJobs = current.jobs.map((job) => {
    if (job.status !== 'queued' && job.status !== 'training') return job;
    hasCanceled = true;
    return {
      ...job,
      status: 'canceled' as const,
      message: '训练已取消/可重试',
      updatedAt: nowIso(),
    };
  });
  if (!hasCanceled) return current;

  const nextState: WizardState = current.assets.voiceSample
    ? 'awaiting_personality'
    : current.assets.photos.length > 0
      ? 'awaiting_voice'
      : 'awaiting_photos';

  return writeState(projectDir, sid, {
    ...current,
    state: nextState,
    jobs: nextJobs,
  });
}

export function getCompanionProfileCurrentDir(
  projectDir: string,
  sessionId = 'main',
): string {
  const sid = normalizeSessionId(sessionId);
  ensureProfileLayout(projectDir, sid);
  return currentProfileDir(projectDir, sid);
}

export function getWizardJobById(
  projectDir: string,
  jobID: string,
): (CompanionTrainingJob & { sessionId: string }) | null {
  for (const sid of listCompanionWizardSessions(projectDir)) {
    const state = readCompanionWizardState(projectDir, sid);
    const match = state.jobs.find((job) => job.id === jobID);
    if (match) return { ...match, sessionId: sid };
  }
  return null;
}

export function wizardChecklist(state: CompanionWizardState): string[] {
  return [
    state.assets.photos.length > 0 ? 'visual:done' : 'visual:pending',
    state.assets.voiceSample ? 'voice:done' : 'voice:pending',
    state.assets.personalityText ? 'persona:done' : 'persona:pending',
  ];
}
