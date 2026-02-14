import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

export type InteractionMode = 'owner' | 'guest' | 'unknown';

export interface OwnerIdentityState {
  initialized: boolean;
  passwordHash?: string;
  passphraseHash?: string;
  voiceprintModelPath: string;
  voiceprintEmbeddingID?: string;
  mode: InteractionMode;
  lastSpeakerAt?: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'security', 'owner-identity.json');
}

function guestAuditPath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'security', 'guest-conversations.jsonl');
}

function defaultState(): OwnerIdentityState {
  return {
    initialized: false,
    mode: 'unknown',
    voiceprintModelPath: '',
    updatedAt: nowIso(),
  };
}

function hashSecret(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function readOwnerIdentityState(projectDir: string): OwnerIdentityState {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) {
    return {
      ...defaultState(),
      voiceprintModelPath: path.join(
        getMiyaRuntimeDir(projectDir),
        'model',
        'shi bie',
        'eres2net',
      ),
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<OwnerIdentityState>;
    return {
      ...defaultState(),
      ...parsed,
      voiceprintModelPath:
        typeof parsed.voiceprintModelPath === 'string'
          ? parsed.voiceprintModelPath
          : path.join(getMiyaRuntimeDir(projectDir), 'model', 'shi bie', 'eres2net'),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
    };
  } catch {
    return {
      ...defaultState(),
      voiceprintModelPath: path.join(getMiyaRuntimeDir(projectDir), 'model', 'shi bie', 'eres2net'),
    };
  }
}

export function writeOwnerIdentityState(projectDir: string, state: OwnerIdentityState): OwnerIdentityState {
  const file = filePath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = { ...state, updatedAt: nowIso() };
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
  },
): OwnerIdentityState {
  const current = readOwnerIdentityState(projectDir);
  const next: OwnerIdentityState = {
    ...current,
    initialized: true,
    passwordHash: hashSecret(input.password),
    passphraseHash: hashSecret(input.passphrase),
    voiceprintEmbeddingID: input.voiceprintEmbeddingID || current.voiceprintEmbeddingID || `owner_${randomUUID()}`,
    voiceprintModelPath:
      input.voiceprintModelPath ||
      current.voiceprintModelPath ||
      path.join(getMiyaRuntimeDir(projectDir), 'model', 'shi bie', 'eres2net'),
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
  if (!state.initialized || !state.passwordHash || !state.passphraseHash) return false;
  const passOk = typeof input.password === 'string' && hashSecret(input.password) === state.passwordHash;
  const phraseOk =
    typeof input.passphrase === 'string' && hashSecret(input.passphrase) === state.passphraseHash;
  return passOk || phraseOk;
}

export function verifyOwnerPasswordOnly(projectDir: string, password?: string): boolean {
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
    if (input.speakerScore >= 0.78) return 'owner';
    if (input.speakerScore < 0.62) return 'guest';
  }
  return state.mode === 'owner' ? 'owner' : 'unknown';
}

export function setInteractionMode(projectDir: string, mode: InteractionMode): OwnerIdentityState {
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
