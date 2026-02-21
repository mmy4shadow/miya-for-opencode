import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getMiyaVoiceprintModelDir,
  getMiyaVoiceprintSampleDir,
} from '../model/paths';
import { getMiyaRuntimeDir } from '../workflow';

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

function nowIso(): string {
  return new Date().toISOString();
}

function filePath(projectDir: string): string {
  return path.join(
    getMiyaRuntimeDir(projectDir),
    'security',
    'owner-identity.json',
  );
}

function guestAuditPath(projectDir: string): string {
  return path.join(
    getMiyaRuntimeDir(projectDir),
    'security',
    'guest-conversations.jsonl',
  );
}

function clamp(input: number, min: number, max: number): number {
  if (!Number.isFinite(input)) return min;
  return Math.min(max, Math.max(min, input));
}

function defaultVoiceprintThresholds(): VoiceprintThresholds {
  return {
    ownerMinScore: 0.78,
    guestMaxScore: 0.62,
    ownerMinLiveness: 0.65,
    guestMaxLiveness: 0.55,
    ownerMinDiarizationRatio: 0.7,
    minSampleDurationSec: 2,
    farTarget: 0.01,
    frrTarget: 0.03,
  };
}

function normalizeVoiceprintThresholds(
  input: Partial<VoiceprintThresholds> | undefined,
): VoiceprintThresholds {
  const base = defaultVoiceprintThresholds();
  const normalized: VoiceprintThresholds = {
    ownerMinScore:
      typeof input?.ownerMinScore === 'number'
        ? clamp(input.ownerMinScore, 0.5, 0.99)
        : base.ownerMinScore,
    guestMaxScore:
      typeof input?.guestMaxScore === 'number'
        ? clamp(input.guestMaxScore, 0.01, 0.9)
        : base.guestMaxScore,
    ownerMinLiveness:
      typeof input?.ownerMinLiveness === 'number'
        ? clamp(input.ownerMinLiveness, 0.1, 0.99)
        : base.ownerMinLiveness,
    guestMaxLiveness:
      typeof input?.guestMaxLiveness === 'number'
        ? clamp(input.guestMaxLiveness, 0.01, 0.9)
        : base.guestMaxLiveness,
    ownerMinDiarizationRatio:
      typeof input?.ownerMinDiarizationRatio === 'number'
        ? clamp(input.ownerMinDiarizationRatio, 0.1, 1)
        : base.ownerMinDiarizationRatio,
    minSampleDurationSec:
      typeof input?.minSampleDurationSec === 'number'
        ? clamp(input.minSampleDurationSec, 0.5, 20)
        : base.minSampleDurationSec,
    farTarget:
      typeof input?.farTarget === 'number'
        ? clamp(input.farTarget, 0.0001, 0.5)
        : base.farTarget,
    frrTarget:
      typeof input?.frrTarget === 'number'
        ? clamp(input.frrTarget, 0.0001, 0.5)
        : base.frrTarget,
  };
  if (normalized.guestMaxScore >= normalized.ownerMinScore) {
    normalized.guestMaxScore = Math.max(0.01, normalized.ownerMinScore - 0.05);
  }
  return normalized;
}

function defaultState(): OwnerIdentityState {
  return {
    initialized: false,
    mode: 'unknown',
    voiceprintModelPath: '',
    voiceprintSampleDir: '',
    voiceprintThresholds: defaultVoiceprintThresholds(),
    updatedAt: nowIso(),
  };
}

function hashSecret(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function defaultVoiceprintModelPath(projectDir: string): string {
  return (
    process.env.MIYA_VOICEPRINT_MODEL_PATH ||
    getMiyaVoiceprintModelDir(projectDir)
  );
}

function defaultVoiceprintSampleDir(projectDir: string): string {
  return (
    process.env.MIYA_VOICEPRINT_SAMPLE_DIR ||
    getMiyaVoiceprintSampleDir(projectDir)
  );
}

export function readOwnerIdentityState(projectDir: string): OwnerIdentityState {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) {
    return {
      ...defaultState(),
      voiceprintModelPath: defaultVoiceprintModelPath(projectDir),
      voiceprintSampleDir: defaultVoiceprintSampleDir(projectDir),
    };
  }
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as Partial<OwnerIdentityState>;
    return {
      ...defaultState(),
      ...parsed,
      voiceprintModelPath:
        typeof parsed.voiceprintModelPath === 'string'
          ? parsed.voiceprintModelPath
          : defaultVoiceprintModelPath(projectDir),
      voiceprintSampleDir:
        typeof parsed.voiceprintSampleDir === 'string'
          ? parsed.voiceprintSampleDir
          : defaultVoiceprintSampleDir(projectDir),
      voiceprintThresholds: normalizeVoiceprintThresholds(
        parsed.voiceprintThresholds,
      ),
      updatedAt:
        typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
    };
  } catch {
    return {
      ...defaultState(),
      voiceprintModelPath: defaultVoiceprintModelPath(projectDir),
      voiceprintSampleDir: defaultVoiceprintSampleDir(projectDir),
    };
  }
}

export function writeOwnerIdentityState(
  projectDir: string,
  state: OwnerIdentityState,
): OwnerIdentityState {
  const file = filePath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = {
    ...state,
    voiceprintThresholds: normalizeVoiceprintThresholds(
      state.voiceprintThresholds,
    ),
    updatedAt: nowIso(),
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

export function initOwnerIdentity(
  projectDir: string,
  input: {
    password: string;
    passphrase: string;
    voiceprintEmbeddingID?: string;
    voiceprintModelPath?: string;
    voiceprintSampleDir?: string;
    voiceprintThresholds?: Partial<VoiceprintThresholds>;
  },
): OwnerIdentityState {
  const current = readOwnerIdentityState(projectDir);
  const next: OwnerIdentityState = {
    ...current,
    initialized: true,
    passwordHash: hashSecret(input.password),
    passphraseHash: hashSecret(input.passphrase),
    voiceprintEmbeddingID:
      input.voiceprintEmbeddingID ||
      current.voiceprintEmbeddingID ||
      `owner_${randomUUID()}`,
    voiceprintModelPath:
      input.voiceprintModelPath ||
      current.voiceprintModelPath ||
      defaultVoiceprintModelPath(projectDir),
    voiceprintSampleDir:
      input.voiceprintSampleDir ||
      current.voiceprintSampleDir ||
      defaultVoiceprintSampleDir(projectDir),
    voiceprintThresholds: normalizeVoiceprintThresholds({
      ...current.voiceprintThresholds,
      ...(input.voiceprintThresholds ?? {}),
    }),
    mode: 'owner',
    lastSpeakerAt: nowIso(),
    updatedAt: nowIso(),
  };
  return writeOwnerIdentityState(projectDir, next);
}

export function verifyOwnerSecrets(
  projectDir: string,
  input: { password?: string; passphrase?: string },
): boolean {
  const state = readOwnerIdentityState(projectDir);
  if (!state.initialized || !state.passwordHash || !state.passphraseHash)
    return false;
  const passOk =
    typeof input.password === 'string' &&
    hashSecret(input.password) === state.passwordHash;
  const phraseOk =
    typeof input.passphrase === 'string' &&
    hashSecret(input.passphrase) === state.passphraseHash;
  return passOk || phraseOk;
}

export function verifyOwnerPasswordOnly(
  projectDir: string,
  password?: string,
): boolean {
  const state = readOwnerIdentityState(projectDir);
  if (!state.initialized || !state.passwordHash) return false;
  if (typeof password !== 'string' || !password) return false;
  return hashSecret(password) === state.passwordHash;
}

export function rotateOwnerSecrets(
  projectDir: string,
  input: {
    currentPassword?: string;
    currentPassphrase?: string;
    newPassword: string;
    newPassphrase: string;
  },
): OwnerIdentityState {
  if (
    !verifyOwnerSecrets(projectDir, {
      password: input.currentPassword,
      passphrase: input.currentPassphrase,
    })
  ) {
    throw new Error('owner_secret_verification_failed');
  }
  const state = readOwnerIdentityState(projectDir);
  return writeOwnerIdentityState(projectDir, {
    ...state,
    initialized: true,
    passwordHash: hashSecret(input.newPassword),
    passphraseHash: hashSecret(input.newPassphrase),
    mode: 'owner',
    lastSpeakerAt: nowIso(),
    updatedAt: nowIso(),
  });
}

export function updateVoiceprintThresholds(
  projectDir: string,
  patch: Partial<VoiceprintThresholds>,
): OwnerIdentityState {
  const current = readOwnerIdentityState(projectDir);
  return writeOwnerIdentityState(projectDir, {
    ...current,
    voiceprintThresholds: normalizeVoiceprintThresholds({
      ...current.voiceprintThresholds,
      ...patch,
    }),
    updatedAt: nowIso(),
  });
}

export function resolveInteractionMode(
  projectDir: string,
  input: {
    speakerHint?: string;
    speakerScore?: number;
  },
): InteractionMode {
  const hint = (input.speakerHint || '').trim().toLowerCase();
  if (hint === 'owner' || hint === 'guest' || hint === 'unknown') {
    return hint;
  }
  const state = readOwnerIdentityState(projectDir);
  if (!state.initialized) return 'unknown';
  if (typeof input.speakerScore === 'number') {
    if (input.speakerScore >= state.voiceprintThresholds.ownerMinScore)
      return 'owner';
    if (input.speakerScore < state.voiceprintThresholds.guestMaxScore)
      return 'guest';
  }
  return state.mode === 'owner' ? 'owner' : 'unknown';
}

export function setInteractionMode(
  projectDir: string,
  mode: InteractionMode,
): OwnerIdentityState {
  const current = readOwnerIdentityState(projectDir);
  return writeOwnerIdentityState(projectDir, {
    ...current,
    mode,
    lastSpeakerAt: nowIso(),
    updatedAt: nowIso(),
  });
}

export function appendGuestConversation(
  projectDir: string,
  input: { text: string; source: string; sessionID: string },
): void {
  const file = guestAuditPath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row = {
    id: `guest_${randomUUID()}`,
    at: nowIso(),
    source: input.source,
    sessionID: input.sessionID,
    text: input.text,
  };
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf-8');
}
