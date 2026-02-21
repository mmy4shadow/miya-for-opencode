import {
  initOwnerIdentity,
  readOwnerIdentityState,
  rotateOwnerSecrets,
  updateVoiceprintThresholds,
} from '../../security/owner-identity';
import { issueOwnerSyncToken } from '../../security/owner-sync';
import type { GatewayMethodRegistrarDeps } from './types';

export interface SecurityMethodDeps extends GatewayMethodRegistrarDeps {}

export function registerSecurityMethods(deps: SecurityMethodDeps): void {
  const { methods, projectDir, parseText } = deps;

  methods.register('security.identity.status', async () => {
    const state = readOwnerIdentityState(projectDir);
    return {
      ...state,
      passwordHash: state.passwordHash ? '***' : undefined,
      passphraseHash: state.passphraseHash ? '***' : undefined,
    };
  });

  methods.register('security.identity.init', async (params) => {
    const password = parseText(params.password);
    const passphrase = parseText(params.passphrase);
    if (!password || !passphrase) throw new Error('invalid_owner_secret_input');
    const next = initOwnerIdentity(projectDir, {
      password,
      passphrase,
      voiceprintEmbeddingID:
        parseText(params.voiceprintEmbeddingID) || undefined,
      voiceprintModelPath: parseText(params.voiceprintModelPath) || undefined,
      voiceprintSampleDir: parseText(params.voiceprintSampleDir) || undefined,
      voiceprintThresholds: {
        ownerMinScore:
          typeof params.ownerMinScore === 'number'
            ? Number(params.ownerMinScore)
            : undefined,
        guestMaxScore:
          typeof params.guestMaxScore === 'number'
            ? Number(params.guestMaxScore)
            : undefined,
        ownerMinLiveness:
          typeof params.ownerMinLiveness === 'number'
            ? Number(params.ownerMinLiveness)
            : undefined,
        guestMaxLiveness:
          typeof params.guestMaxLiveness === 'number'
            ? Number(params.guestMaxLiveness)
            : undefined,
        ownerMinDiarizationRatio:
          typeof params.ownerMinDiarizationRatio === 'number'
            ? Number(params.ownerMinDiarizationRatio)
            : undefined,
        minSampleDurationSec:
          typeof params.minSampleDurationSec === 'number'
            ? Number(params.minSampleDurationSec)
            : undefined,
        farTarget:
          typeof params.farTarget === 'number'
            ? Number(params.farTarget)
            : undefined,
        frrTarget:
          typeof params.frrTarget === 'number'
            ? Number(params.frrTarget)
            : undefined,
      },
    });
    return {
      ...next,
      passwordHash: '***',
      passphraseHash: '***',
    };
  });

  methods.register('security.identity.rotate', async (params) => {
    const newPassword = parseText(params.newPassword);
    const newPassphrase = parseText(params.newPassphrase);
    if (!newPassword || !newPassphrase)
      throw new Error('invalid_new_owner_secret');
    const next = rotateOwnerSecrets(projectDir, {
      currentPassword: parseText(params.currentPassword) || undefined,
      currentPassphrase: parseText(params.currentPassphrase) || undefined,
      newPassword,
      newPassphrase,
    });
    return {
      ...next,
      passwordHash: '***',
      passphraseHash: '***',
    };
  });

  methods.register('security.voiceprint.threshold.get', async () => {
    const state = readOwnerIdentityState(projectDir);
    return {
      ...state.voiceprintThresholds,
    };
  });

  methods.register('security.voiceprint.threshold.set', async (params) => {
    const next = updateVoiceprintThresholds(projectDir, {
      ownerMinScore:
        typeof params.ownerMinScore === 'number'
          ? Number(params.ownerMinScore)
          : undefined,
      guestMaxScore:
        typeof params.guestMaxScore === 'number'
          ? Number(params.guestMaxScore)
          : undefined,
      ownerMinLiveness:
        typeof params.ownerMinLiveness === 'number'
          ? Number(params.ownerMinLiveness)
          : undefined,
      guestMaxLiveness:
        typeof params.guestMaxLiveness === 'number'
          ? Number(params.guestMaxLiveness)
          : undefined,
      ownerMinDiarizationRatio:
        typeof params.ownerMinDiarizationRatio === 'number'
          ? Number(params.ownerMinDiarizationRatio)
          : undefined,
      minSampleDurationSec:
        typeof params.minSampleDurationSec === 'number'
          ? Number(params.minSampleDurationSec)
          : undefined,
      farTarget:
        typeof params.farTarget === 'number'
          ? Number(params.farTarget)
          : undefined,
      frrTarget:
        typeof params.frrTarget === 'number'
          ? Number(params.frrTarget)
          : undefined,
    });
    return {
      ...next.voiceprintThresholds,
    };
  });

  methods.register('security.owner_sync.issue', async (params) => {
    const action = parseText(params.action) || 'outbound.high_risk.send';
    const payloadHash = parseText(params.payloadHash);
    if (!payloadHash) throw new Error('invalid_payload_hash');
    return issueOwnerSyncToken(projectDir, {
      action,
      payloadHash,
      ttlMs:
        typeof params.ttlMs === 'number' ? Number(params.ttlMs) : undefined,
    });
  });
}
