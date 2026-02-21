import { getMediaItem } from '../../media/store';
import { transitionSafetyState } from '../../safety/state-machine';
import {
  appendGuestConversation,
  setInteractionMode,
} from '../../security/owner-identity';
import {
  appendVoiceHistory,
  clearVoiceHistory,
  patchVoiceState,
  readVoiceState,
} from '../../voice/state';
import type { GatewayMethodRegistrarDeps } from './types';

interface VoiceprintResult {
  mode: 'owner' | 'guest' | 'unknown';
  [key: string]: unknown;
}

export interface VoiceMethodDeps extends GatewayMethodRegistrarDeps {
  requirePolicyHash: (
    projectDir: string,
    providedHash: string | undefined,
  ) => string;
  requireDomainRunning: (
    projectDir: string,
    domain: 'memory_write' | 'memory_delete',
  ) => void;
  verifyVoiceprintWithLocalModel: (
    projectDir: string,
    input: {
      mediaPath?: string;
      speakerHint?: string;
      speakerScore?: number;
    },
  ) => Promise<VoiceprintResult>;
  routeSessionMessage: (
    projectDir: string,
    input: { sessionID: string; text: string; source: string },
  ) => Promise<unknown>;
}

export function registerVoiceMethods(deps: VoiceMethodDeps): void {
  const { methods, projectDir, parseText } = deps;

  methods.register('voice.status', async () => readVoiceState(projectDir));
  methods.register('voice.wake.enable', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    deps.requirePolicyHash(projectDir, policyHash);
    deps.requireDomainRunning(projectDir, 'memory_write');
    return patchVoiceState(projectDir, {
      enabled: true,
      wakeWordEnabled: true,
    });
  });

  methods.register('voice.wake.disable', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    deps.requirePolicyHash(projectDir, policyHash);
    deps.requireDomainRunning(projectDir, 'memory_write');
    return patchVoiceState(projectDir, {
      wakeWordEnabled: false,
    });
  });

  methods.register('voice.talk.start', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    deps.requirePolicyHash(projectDir, policyHash);
    deps.requireDomainRunning(projectDir, 'memory_write');
    return patchVoiceState(projectDir, {
      enabled: true,
      talkMode: true,
      routeSessionID:
        parseText(params.sessionID) ||
        readVoiceState(projectDir).routeSessionID,
    });
  });

  methods.register('voice.talk.stop', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    deps.requirePolicyHash(projectDir, policyHash);
    deps.requireDomainRunning(projectDir, 'memory_write');
    return patchVoiceState(projectDir, {
      talkMode: false,
    });
  });

  methods.register('voice.input.ingest', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    deps.requirePolicyHash(projectDir, policyHash);
    deps.requireDomainRunning(projectDir, 'memory_write');
    const mediaID = parseText(params.mediaID) || undefined;
    const source =
      parseText(params.source) === 'wake' ||
      parseText(params.source) === 'talk' ||
      parseText(params.source) === 'media'
        ? (parseText(params.source) as 'wake' | 'talk' | 'manual' | 'media')
        : 'manual';
    const language = parseText(params.language) || undefined;
    const speakerHint = parseText(params.speakerHint) || undefined;
    const speakerScore =
      typeof params.speakerScore === 'number'
        ? Number(params.speakerScore)
        : undefined;
    const mediaPath = mediaID
      ? getMediaItem(projectDir, mediaID)?.localPath
      : undefined;
    const voiceprint = await deps.verifyVoiceprintWithLocalModel(projectDir, {
      mediaPath,
      speakerHint,
      speakerScore,
    });
    const mode = voiceprint.mode;
    setInteractionMode(projectDir, mode);

    if (mode !== 'owner') {
      transitionSafetyState(projectDir, {
        source: 'speaker_gate',
        reason: `speaker_mode_${mode}`,
        domains: {
          outbound_send: 'paused',
          desktop_control: 'paused',
          memory_read: 'paused',
        },
      });
    }

    let text = parseText(params.text);
    if (!text && mediaID) {
      const media = getMediaItem(projectDir, mediaID);
      const transcript = media?.metadata?.transcript;
      text =
        typeof transcript === 'string' && transcript.trim()
          ? transcript.trim()
          : `[media:${mediaID}]`;
    }
    if (!text) throw new Error('invalid_voice_input');

    if (mode === 'guest') {
      appendGuestConversation(projectDir, {
        text,
        source,
        sessionID: parseText(params.sessionID) || 'main',
      });
      return {
        item: appendVoiceHistory(projectDir, {
          text,
          source,
          language,
          mediaID,
        }),
        routed: {
          delivered: false,
          queued: false,
          reason: 'guest_mode_restricted',
        },
        mode,
        voiceprint,
        reply: '不好意思，我现在只能听主人的指令哦，但我可以陪你聊天。',
        voice: readVoiceState(projectDir),
      };
    }

    const item = appendVoiceHistory(projectDir, {
      text,
      source,
      language,
      mediaID,
    });
    const voice = readVoiceState(projectDir);
    const targetSessionID =
      parseText(params.sessionID) || voice.routeSessionID || 'main';
    const routed = await deps.routeSessionMessage(projectDir, {
      sessionID: targetSessionID,
      text,
      source: `voice:${source}`,
    });
    return {
      item,
      routed,
      mode,
      voiceprint,
      voice: readVoiceState(projectDir),
    };
  });

  methods.register('voice.history.list', async (params) => {
    const limit =
      typeof params.limit === 'number' && params.limit > 0
        ? Math.min(500, Number(params.limit))
        : 100;
    return readVoiceState(projectDir).history.slice(0, limit);
  });

  methods.register('voice.history.clear', async (params) => {
    const policyHash = parseText(params.policyHash) || undefined;
    deps.requirePolicyHash(projectDir, policyHash);
    deps.requireDomainRunning(projectDir, 'memory_delete');
    return clearVoiceHistory(projectDir);
  });
}
