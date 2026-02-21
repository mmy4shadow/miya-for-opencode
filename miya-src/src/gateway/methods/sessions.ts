import {
  isCompanionWizardEmpty,
  readCompanionWizardState,
  resetCompanionWizard,
  startCompanionWizard,
  wizardChecklist,
} from '../../companion/wizard';
import {
  getSession,
  listSessions,
  setSessionPolicy,
  upsertSession,
} from '../../sessions';
import type { GatewayMethodRegistrarDeps } from './types';

export interface SessionMethodDeps extends GatewayMethodRegistrarDeps {
  requirePolicyHash: (
    projectDir: string,
    providedHash: string | undefined,
  ) => string;
  requireDomainRunning: (projectDir: string, domain: 'memory_write') => void;
  routeSessionMessage: (
    projectDir: string,
    input: { sessionID: string; text: string; source: string },
  ) => Promise<unknown>;
  wizardPromptPhotos: string;
  wizardPromptByState: (state: string) => string;
}

export function registerSessionMethods(deps: SessionMethodDeps): void {
  const { methods, projectDir, parseText } = deps;
  methods.register('sessions.list', async () => listSessions(projectDir));
  methods.register('sessions.get', async (params) => {
    const sessionID = parseText(params.sessionID);
    if (!sessionID) throw new Error('invalid_session_id');
    return getSession(projectDir, sessionID);
  });
  methods.register('sessions.policy.set', async (params) => {
    const sessionID = parseText(params.sessionID);
    const policyHash = parseText(params.policyHash) || undefined;
    if (!sessionID) throw new Error('invalid_session_id');
    deps.requirePolicyHash(projectDir, policyHash);
    deps.requireDomainRunning(projectDir, 'memory_write');
    const patch: Parameters<typeof setSessionPolicy>[2] = {};
    if (
      params.activation === 'active' ||
      params.activation === 'queued' ||
      params.activation === 'muted'
    ) {
      patch.activation = params.activation;
    }
    if (
      params.reply === 'auto' ||
      params.reply === 'manual' ||
      params.reply === 'summary_only'
    ) {
      patch.reply = params.reply;
    }
    if (
      params.queueStrategy === 'fifo' ||
      params.queueStrategy === 'priority' ||
      params.queueStrategy === 'cooldown'
    ) {
      patch.queueStrategy = params.queueStrategy;
    }
    const updated = setSessionPolicy(projectDir, sessionID, patch);
    if (!updated) throw new Error('session_not_found');
    return updated;
  });
  methods.register('sessions.send', async (params) => {
    const sessionID = parseText(params.sessionID);
    const text = parseText(params.text);
    if (!sessionID || !text) throw new Error('invalid_sessions_send_args');
    if (text.trim() === '/start') {
      const wizard = isCompanionWizardEmpty(projectDir, sessionID)
        ? startCompanionWizard(projectDir, { sessionId: sessionID })
        : readCompanionWizardState(projectDir, sessionID);
      return {
        sessionID: wizard.sessionId,
        wizard,
        checklist: wizardChecklist(wizard),
        message:
          wizard.state === 'awaiting_photos'
            ? deps.wizardPromptPhotos
            : `检测到已有向导进度，已恢复继续。${deps.wizardPromptByState(wizard.state)}`,
        instruction: '将照片拖拽到聊天中',
      };
    }
    if (text.trim() === '/reset_personality') {
      const wizard = resetCompanionWizard(projectDir, sessionID);
      return {
        sessionID: wizard.sessionId,
        wizard,
        message: '已重置人格资产，请重新开始 /start',
      };
    }
    upsertSession(projectDir, {
      id: sessionID,
      kind: sessionID.startsWith('opencode:') ? 'opencode' : 'channel',
      groupId: sessionID,
      routingSessionID: parseText(params.routingSessionID) || 'main',
      agent: parseText(params.agent) || '1-task-manager',
    });
    return deps.routeSessionMessage(projectDir, {
      sessionID,
      text,
      source: parseText(params.source) || 'gateway',
    });
  });
}
