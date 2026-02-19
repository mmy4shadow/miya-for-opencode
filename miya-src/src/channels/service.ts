import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sendQqDesktopMessage } from '../channel/outbound/qq';
import { sendWechatDesktopMessage } from '../channel/outbound/wechat';
import { analyzeDesktopOutboundEvidence } from '../multimodal/vision';
import { readPolicy } from '../policy';
import {
  assertSemanticTags,
  normalizeSemanticTags,
  type SemanticTag,
} from '../policy/semantic-tags';
import { getMiyaRuntimeDir } from '../workflow';
import {
  ensurePairRequest,
  getContactTier,
  isSenderAllowed,
  listChannelStates,
  listPairRequests,
  resolvePairRequest,
  upsertChannelState,
} from './pairing-store';
import { assertChannelCanSend, canChannelSend } from './policy';
import type { ChannelName } from './types';

export interface ChannelInboundMessage {
  channel: ChannelName;
  senderID: string;
  displayName?: string;
  conversationID: string;
  text: string;
  raw?: unknown;
}

export interface ChannelRuntimeCallbacks {
  onInbound: (message: ChannelInboundMessage) => Promise<void> | void;
  onPairRequested: (
    pair: ReturnType<typeof ensurePairRequest>,
  ) => Promise<void> | void;
}

export interface ChannelRuntimeDependencies {
  sendQqDesktopMessage?: typeof sendQqDesktopMessage;
  sendWechatDesktopMessage?: typeof sendWechatDesktopMessage;
  analyzeDesktopOutboundEvidence?: typeof analyzeDesktopOutboundEvidence;
}

function parseEnvList(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function outboundAuditFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'channels-outbound.jsonl');
}

function appendOutboundAudit(
  projectDir: string,
  row: Record<string, unknown> | ChannelOutboundAudit,
): void {
  const file = outboundAuditFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf-8');
}

export interface ChannelOutboundAudit {
  id: string;
  at: string;
  channel: ChannelName;
  destination: string;
  textPreview: string;
  sent: boolean;
  message: string;
  mediaPath?: string;
  reason?:
    | 'sent'
    | 'channel_blocked'
    | 'arch_advisor_denied'
    | 'allowlist_denied'
    | 'throttled'
    | 'duplicate_payload'
    | 'desktop_send_failed';
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  archAdvisorApproved?: boolean;
  targetInAllowlist?: boolean;
  contactTier?: 'owner' | 'friend' | null;
  intent?: 'reply' | 'initiate';
  containsSensitive?: boolean;
  policyHash?: string;
  sendFingerprint?: string;
  ticketSummary?: {
    outboundSendTraceId: string;
    desktopControlTraceId: string;
    expiresAt: string;
  };
  visualPrecheck?: string;
  visualPostcheck?: string;
  automationPath?: 'uia' | 'sendkeys' | 'mixed';
  uiaPath?: 'valuepattern' | 'clipboard_sendkeys' | 'none';
  targetHwnd?: string;
  foregroundBefore?: string;
  foregroundAfter?: string;
  fallbackReason?: string;
  simulationStatus?: 'captured' | 'not_available';
  simulationRiskHints?: string[];
  receiptStatus?: 'confirmed' | 'uncertain';
  semanticTags?: SemanticTag[];
  payloadHash?: string;
  windowFingerprint?: string;
  recipientTextCheck?: 'matched' | 'uncertain' | 'mismatch';
  sendStatusCheck?: 'sent' | 'failed' | 'uncertain';
  preSendScreenshotPath?: string;
  postSendScreenshotPath?: string;
  failureStep?: string;
  routeLevel?: 'L0_ACTION_MEMORY' | 'L1_UIA' | 'L2_OCR' | 'L3_SOM_VLM';
  somSelectionSource?: 'memory' | 'heuristic' | 'vlm' | 'none';
  somSelectedCandidateId?: number;
  vlmCallsUsed?: number;
  actionPlanMemoryHit?: boolean;
  automationLatencyMs?: number;
  automationKpi?: {
    totalRuns: number;
    successfulRuns: number;
    vlmCallRatio: number;
    somPathHitRate: number;
    reuseTaskP95Ms: number;
    firstTaskP95Ms: number;
    highRiskMisfireRate: number;
    reuseRuns: number;
    firstRuns: number;
  };
  ocrSource?: 'remote_vlm' | 'tesseract' | 'none';
  ocrPreview?: string;
  captureMethod?:
    | 'wgc_hwnd'
    | 'print_window'
    | 'dxgi_duplication'
    | 'uia_only'
    | 'unknown';
  evidenceConfidence?: number;
  evidenceLimitations?: string[];
  evidenceBundle?: {
    kind: 'desktop_outbound';
    version: 'v5';
    destination: string;
    payloadHash?: string;
    ticketTraceIds?: string[];
    screenshots: string[];
    checks: {
      recipientTextCheck?: 'matched' | 'uncertain' | 'mismatch';
      sendStatusCheck?: 'sent' | 'failed' | 'uncertain';
      receiptStatus?: 'confirmed' | 'uncertain';
    };
    diagnostics: {
      windowFingerprint?: string;
      failureStep?: string;
      targetHwnd?: string;
      foregroundBefore?: string;
      foregroundAfter?: string;
      uiaPath?: 'valuepattern' | 'clipboard_sendkeys' | 'none';
      fallbackReason?: string;
      routeLevel?: 'L0_ACTION_MEMORY' | 'L1_UIA' | 'L2_OCR' | 'L3_SOM_VLM';
      somSelectionSource?: 'memory' | 'heuristic' | 'vlm' | 'none';
      somSelectedCandidateId?: string;
      vlmCallsUsed?: string;
      ocrSource?: 'remote_vlm' | 'tesseract' | 'none';
      ocrPreview?: string;
    };
    meta: {
      captureMethod:
        | 'wgc_hwnd'
        | 'print_window'
        | 'dxgi_duplication'
        | 'uia_only'
        | 'unknown';
      confidence: number;
      limitations: string[];
      policyHash?: string;
    };
    simulation: {
      status: 'captured' | 'not_available';
      clickTargets?: Array<{ x: number; y: number; label?: string }>;
      reason?: string;
      riskHints?: string[];
    };
  };
  semanticSummary?: {
    conclusion: string;
    keyAssertion: string;
    recovery: string;
  };
}

function semanticTagsForOutboundMessage(message: string): SemanticTag[] {
  if (message.includes('target_not_in_allowlist'))
    return ['recipient_mismatch'];
  if (message.includes('recipient_text_mismatch'))
    return ['recipient_mismatch'];
  if (message.includes('arch_advisor_denied')) return ['privilege_barrier'];
  if (message.includes('input_mutex_timeout')) return ['input_mutex_timeout'];
  if (message.includes('receipt_uncertain')) return ['receipt_uncertain'];
  if (
    message.includes('blocked_by_privilege') ||
    message.includes('privilege')
  ) {
    return ['privilege_barrier'];
  }
  if (message.includes('window_not_found')) return ['window_not_found'];
  if (message.includes('window_occluded')) return ['window_occluded'];
  if (message.includes('ui_style_mismatch')) return ['ui_style_mismatch'];
  return [];
}

type InputMutexLease = {
  release: () => void;
};

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

const INPUT_MUTEX_TIMEOUT_MS = parsePositiveIntEnv(
  'MIYA_INPUT_MUTEX_TIMEOUT_MS',
  20_000,
);
const INPUT_MUTEX_STRIKE_LIMIT = 3;
const INPUT_MUTEX_COOLDOWN_MS = 15 * 60 * 1000;

let inputMutexOwner: string | null = null;
const inputMutexQueue: Array<{
  sessionID: string;
  active: boolean;
  grant: () => void;
}> = [];

function acquireInputMutex(
  sessionID: string,
  timeoutMs = INPUT_MUTEX_TIMEOUT_MS,
): Promise<InputMutexLease> {
  return new Promise((resolve, reject) => {
    let released = false;
    const makeLease = (): InputMutexLease => ({
      release: () => {
        if (released) return;
        released = true;
        if (inputMutexOwner === sessionID) {
          inputMutexOwner = null;
        }
        while (inputMutexQueue.length > 0 && !inputMutexOwner) {
          const next = inputMutexQueue.shift();
          if (!next) break;
          if (!next.active) continue;
          next.grant();
        }
      },
    });
    const pending = {
      sessionID,
      active: true,
      grant: () => {},
    };
    const timer = setTimeout(() => {
      pending.active = false;
      const idx = inputMutexQueue.indexOf(pending);
      if (idx >= 0) inputMutexQueue.splice(idx, 1);
      reject(new Error('input_mutex_timeout'));
    }, timeoutMs);
    const grant = (): void => {
      if (!pending.active) return;
      pending.active = false;
      clearTimeout(timer);
      inputMutexOwner = sessionID;
      resolve(makeLease());
    };
    pending.grant = grant;

    if (!inputMutexOwner) {
      grant();
      return;
    }
    inputMutexQueue.push(pending);
  });
}

function buildSemanticSummary(
  row: Omit<ChannelOutboundAudit, 'id' | 'at'>,
): ChannelOutboundAudit['semanticSummary'] {
  if (row.sent) {
    return {
      conclusion: 'Outbound send completed with verifiable desktop evidence.',
      keyAssertion: `recipient_check=${row.recipientTextCheck ?? 'uncertain'}, send_status=${row.sendStatusCheck ?? 'uncertain'}`,
      recovery: 'No recovery needed.',
    };
  }
  if (row.message.includes('arch_advisor_denied')) {
    return {
      conclusion: 'Outbound send blocked by Arch Advisor approval gate.',
      keyAssertion:
        'Arch Advisor approval flag was false, so outbound flow was denied before desktop execution.',
      recovery:
        'Re-issue approval ticket via Arch Advisor and retry only after policy checks pass.',
    };
  }
  if (row.message.includes('input_mutex_timeout')) {
    return {
      conclusion: 'Outbound send blocked by input mutex timeout.',
      keyAssertion:
        'Desktop control was denied because user input mutex could not be acquired in time.',
      recovery:
        'Wait for user idle state and retry with renewed approval tickets.',
    };
  }
  if (row.message.includes('ui_style_mismatch')) {
    return {
      conclusion:
        'Outbound send degraded due to unstable UI/OCR style mismatch.',
      keyAssertion:
        'Visual confirmation confidence was too low after retry, so send was treated as failed.',
      recovery:
        'Adjust DPI/theme/window state, then retry with refreshed evidence.',
    };
  }
  return {
    conclusion: row.sent
      ? 'Outbound send completed.'
      : 'Outbound send blocked or uncertain.',
    keyAssertion: `message=${row.message}`,
    recovery: row.sent
      ? 'No recovery needed.'
      : 'Review desktop evidence and retry only after policy/approval checks pass.',
  };
}

function buildEvidenceBundle(
  row: Omit<ChannelOutboundAudit, 'id' | 'at'>,
): ChannelOutboundAudit['evidenceBundle'] | undefined {
  if (row.channel !== 'qq' && row.channel !== 'wechat') return undefined;
  const screenshots = [
    row.preSendScreenshotPath,
    row.postSendScreenshotPath,
  ].filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );
  const ticketTraceIds = [
    row.ticketSummary?.outboundSendTraceId,
    row.ticketSummary?.desktopControlTraceId,
  ].filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );
  return {
    kind: 'desktop_outbound',
    version: 'v5',
    destination: row.destination,
    payloadHash: row.payloadHash,
    ticketTraceIds: ticketTraceIds.length > 0 ? ticketTraceIds : undefined,
    screenshots,
    checks: {
      recipientTextCheck: row.recipientTextCheck,
      sendStatusCheck: row.sendStatusCheck,
      receiptStatus: row.receiptStatus,
    },
    diagnostics: {
      windowFingerprint: row.windowFingerprint,
      failureStep: row.failureStep,
      targetHwnd: row.targetHwnd,
      foregroundBefore: row.foregroundBefore,
      foregroundAfter: row.foregroundAfter,
      uiaPath: row.uiaPath,
      fallbackReason: row.fallbackReason,
      routeLevel: row.routeLevel,
      somSelectionSource: row.somSelectionSource,
      somSelectedCandidateId:
        typeof row.somSelectedCandidateId === 'number'
          ? String(row.somSelectedCandidateId)
          : undefined,
      vlmCallsUsed:
        typeof row.vlmCallsUsed === 'number'
          ? String(row.vlmCallsUsed)
          : undefined,
      ocrSource: row.ocrSource,
      ocrPreview: row.ocrPreview,
    },
    meta: {
      captureMethod: row.captureMethod ?? 'unknown',
      confidence: Number.isFinite(row.evidenceConfidence)
        ? Number(row.evidenceConfidence)
        : 0,
      limitations: row.evidenceLimitations ?? [],
      policyHash: row.policyHash,
    },
    simulation:
      row.simulationStatus === 'captured' || screenshots.length > 0
        ? {
            status: 'captured',
            clickTargets: [],
            riskHints: row.simulationRiskHints,
          }
        : {
            status: 'not_available',
            reason:
              row.simulationRiskHints && row.simulationRiskHints.length > 0
                ? row.simulationRiskHints.join(',')
                : 'desktop_screenshots_missing',
            riskHints: row.simulationRiskHints,
          },
  };
}

export function listOutboundAudit(
  projectDir: string,
  limit = 50,
): ChannelOutboundAudit[] {
  const file = outboundAuditFile(projectDir);
  if (!fs.existsSync(file)) return [];
  const rows = fs
    .readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as ChannelOutboundAudit;
      } catch {
        return null;
      }
    })
    .filter((row): row is ChannelOutboundAudit => Boolean(row));
  return rows
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, Math.max(1, limit));
}

export interface ChannelGovernanceSummary {
  generatedAt: string;
  windowRows: number;
  outboundSent: number;
  outboundBlocked: number;
  inboundOnlyViolationAttempts: number;
  inboundOnlyInvariantMaintained: boolean;
  highRiskBlocked: number;
  topBlockedReasons: Array<{ reason: string; count: number }>;
  channelBreakdown: Array<{
    channel: ChannelName;
    attempts: number;
    sent: number;
    blocked: number;
    outboundAllowed: boolean;
  }>;
}

function normalizeBlockedReason(row: ChannelOutboundAudit): string {
  if (row.reason) return row.reason;
  const msg = String(row.message ?? '').trim();
  if (!msg) return 'unknown';
  if (msg.includes(':')) return msg.split(':')[0];
  return msg.slice(0, 64);
}

export function summarizeChannelGovernance(
  projectDir: string,
  limit = 400,
): ChannelGovernanceSummary {
  const rows = listOutboundAudit(
    projectDir,
    Math.max(20, Math.min(5000, limit)),
  );
  const stateMap = new Map(
    listChannelStates(projectDir).map((state) => [state.name, state]),
  );
  const blockedRows = rows.filter((row) => !row.sent);
  const inboundOnlyViolationAttempts = rows.filter(
    (row) => !canChannelSend(row.channel),
  ).length;
  const inboundOnlyInvariantMaintained = !rows.some(
    (row) => row.sent && !canChannelSend(row.channel),
  );

  const blockedReasonCount = new Map<string, number>();
  for (const row of blockedRows) {
    const key = normalizeBlockedReason(row);
    blockedReasonCount.set(key, (blockedReasonCount.get(key) ?? 0) + 1);
  }

  const channelBreakdown = [...new Set(rows.map((row) => row.channel))]
    .map((channel) => {
      const subset = rows.filter((row) => row.channel === channel);
      return {
        channel,
        attempts: subset.length,
        sent: subset.filter((row) => row.sent).length,
        blocked: subset.filter((row) => !row.sent).length,
        outboundAllowed: canChannelSend(channel),
      };
    })
    .sort((a, b) => b.attempts - a.attempts);

  return {
    generatedAt: new Date().toISOString(),
    windowRows: rows.length,
    outboundSent: rows.filter((row) => row.sent).length,
    outboundBlocked: blockedRows.length,
    inboundOnlyViolationAttempts,
    inboundOnlyInvariantMaintained,
    highRiskBlocked: blockedRows.filter((row) => row.riskLevel === 'HIGH')
      .length,
    topBlockedReasons: [...blockedReasonCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([reason, count]) => ({ reason, count })),
    channelBreakdown:
      channelBreakdown.length > 0
        ? channelBreakdown
        : [...stateMap.keys()].map((channel) => ({
            channel,
            attempts: 0,
            sent: 0,
            blocked: 0,
            outboundAllowed: canChannelSend(channel),
          })),
  };
}

export class ChannelRuntime {
  private readonly projectDir: string;
  private readonly callbacks: ChannelRuntimeCallbacks;
  private readonly sendQqDesktopMessageImpl: typeof sendQqDesktopMessage;
  private readonly sendWechatDesktopMessageImpl: typeof sendWechatDesktopMessage;
  private readonly analyzeDesktopOutboundEvidenceImpl: typeof analyzeDesktopOutboundEvidence;
  private telegramPolling = false;
  private telegramOffset = 0;
  private slackSocketModeRunning = false;
  private slackSocket?: WebSocket;
  private slackReconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly outboundThrottle = new Map<string, number[]>();
  private readonly outboundPayloadHistory = new Map<
    string,
    Array<{ at: number; hash: string }>
  >();
  private readonly inputMutexStrike = new Map<string, number>();
  private readonly inputMutexCooldownUntil = new Map<string, number>();
  private readonly sendFingerprintHistory = new Map<string, number>();

  constructor(
    projectDir: string,
    callbacks: ChannelRuntimeCallbacks,
    deps: ChannelRuntimeDependencies = {},
  ) {
    this.projectDir = projectDir;
    this.callbacks = callbacks;
    this.sendQqDesktopMessageImpl =
      deps.sendQqDesktopMessage ?? sendQqDesktopMessage;
    this.sendWechatDesktopMessageImpl =
      deps.sendWechatDesktopMessage ?? sendWechatDesktopMessage;
    this.analyzeDesktopOutboundEvidenceImpl =
      deps.analyzeDesktopOutboundEvidence ?? analyzeDesktopOutboundEvidence;
  }

  listChannels() {
    return listChannelStates(this.projectDir);
  }

  listPairs(status?: 'pending' | 'approved' | 'rejected') {
    return listPairRequests(this.projectDir, status);
  }

  approvePair(pairID: string) {
    return resolvePairRequest(this.projectDir, pairID, 'approved');
  }

  rejectPair(pairID: string) {
    return resolvePairRequest(this.projectDir, pairID, 'rejected');
  }

  markChannelEnabled(channel: ChannelName, enabled: boolean): void {
    upsertChannelState(this.projectDir, channel, {
      enabled,
      connected: enabled,
    });
  }

  async start(): Promise<void> {
    upsertChannelState(this.projectDir, 'webchat', {
      enabled: true,
      connected: true,
    });
    await this.startTelegramPolling();
    this.syncPassiveChannelStates();
    await this.startSlackSocketMode();
  }

  private syncPassiveChannelStates(): void {
    upsertChannelState(this.projectDir, 'qq', {
      enabled: false,
      connected: false,
      lastError: 'QQ outbound requires desktop UI automation runtime',
    });

    upsertChannelState(this.projectDir, 'wechat', {
      enabled: false,
      connected: false,
      lastError: 'WeChat outbound requires desktop UI automation runtime',
    });

    const hasSlack = !!process.env.MIYA_SLACK_BOT_TOKEN;
    upsertChannelState(this.projectDir, 'slack', {
      enabled: hasSlack,
      connected: hasSlack,
      lastError: hasSlack ? undefined : 'Missing MIYA_SLACK_BOT_TOKEN',
    });

    const hasDiscord = !!process.env.MIYA_DISCORD_BOT_TOKEN;
    upsertChannelState(this.projectDir, 'discord', {
      enabled: hasDiscord,
      connected: hasDiscord,
      lastError: hasDiscord ? undefined : 'Missing MIYA_DISCORD_BOT_TOKEN',
    });

    const hasWhatsApp =
      !!process.env.MIYA_WHATSAPP_TOKEN &&
      !!process.env.MIYA_WHATSAPP_PHONE_NUMBER_ID;
    upsertChannelState(this.projectDir, 'whatsapp', {
      enabled: hasWhatsApp,
      connected: hasWhatsApp,
      lastError: hasWhatsApp
        ? undefined
        : 'Missing MIYA_WHATSAPP_TOKEN or MIYA_WHATSAPP_PHONE_NUMBER_ID',
    });

    const hasGoogleChat = !!process.env.MIYA_GOOGLE_CHAT_WEBHOOK_URL;
    upsertChannelState(this.projectDir, 'google_chat', {
      enabled: hasGoogleChat,
      connected: hasGoogleChat,
      lastError: hasGoogleChat
        ? undefined
        : 'Missing MIYA_GOOGLE_CHAT_WEBHOOK_URL',
    });

    const hasSignal = !!process.env.MIYA_SIGNAL_REST_URL;
    upsertChannelState(this.projectDir, 'signal', {
      enabled: hasSignal,
      connected: hasSignal,
      lastError: hasSignal ? undefined : 'Missing MIYA_SIGNAL_REST_URL',
    });

    const hasIMessage = !!process.env.MIYA_BLUEBUBBLES_URL;
    upsertChannelState(this.projectDir, 'imessage', {
      enabled: hasIMessage,
      connected: hasIMessage,
      lastError: hasIMessage ? undefined : 'Missing MIYA_BLUEBUBBLES_URL',
    });

    const hasTeams = !!process.env.MIYA_TEAMS_WEBHOOK_URL;
    upsertChannelState(this.projectDir, 'teams', {
      enabled: hasTeams,
      connected: hasTeams,
      lastError: hasTeams ? undefined : 'Missing MIYA_TEAMS_WEBHOOK_URL',
    });
  }

  private async startSlackSocketMode(): Promise<void> {
    const appToken = process.env.MIYA_SLACK_APP_TOKEN;
    const botToken = process.env.MIYA_SLACK_BOT_TOKEN;
    if (!appToken || !botToken || this.slackSocketModeRunning) return;
    this.slackSocketModeRunning = true;

    const connect = async (): Promise<void> => {
      if (!this.slackSocketModeRunning) return;

      try {
        const openRes = await fetch(
          'https://slack.com/api/apps.connections.open',
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${appToken}`,
              'content-type': 'application/json',
            },
            body: '{}',
          },
        );
        const openBody = (await openRes.json()) as {
          ok?: boolean;
          url?: string;
          error?: string;
        };
        if (!openBody.ok || !openBody.url) {
          throw new Error(openBody.error ?? 'slack_socket_open_failed');
        }

        const socket = new WebSocket(openBody.url);
        this.slackSocket = socket;

        socket.onopen = () => {
          upsertChannelState(this.projectDir, 'slack', {
            enabled: true,
            connected: true,
            lastError: undefined,
          });
        };

        socket.onmessage = (event) => {
          void this.handleSlackSocketMessage(String(event.data));
        };

        socket.onerror = () => {
          upsertChannelState(this.projectDir, 'slack', {
            connected: false,
            lastError: 'slack_socket_error',
          });
        };

        socket.onclose = () => {
          if (!this.slackSocketModeRunning) return;
          upsertChannelState(this.projectDir, 'slack', {
            connected: false,
            lastError: 'slack_socket_closed',
          });
          this.scheduleSlackReconnect(connect);
        };
      } catch (error) {
        upsertChannelState(this.projectDir, 'slack', {
          connected: false,
          lastError: error instanceof Error ? error.message : String(error),
        });
        this.scheduleSlackReconnect(connect);
      }
    };

    await connect();
  }

  private scheduleSlackReconnect(connect: () => Promise<void>): void {
    if (!this.slackSocketModeRunning) return;
    if (this.slackReconnectTimer) clearTimeout(this.slackReconnectTimer);
    this.slackReconnectTimer = setTimeout(() => {
      void connect();
    }, 3000);
  }

  private async handleSlackSocketMessage(messageText: string): Promise<void> {
    if (!messageText.trim()) return;
    const payload = JSON.parse(messageText) as {
      envelope_id?: string;
      type?: string;
      payload?: {
        event?: {
          type?: string;
          user?: string;
          text?: string;
          channel?: string;
          bot_id?: string;
        };
      };
    };

    if (
      payload.envelope_id &&
      this.slackSocket?.readyState === WebSocket.OPEN
    ) {
      this.slackSocket.send(
        JSON.stringify({ envelope_id: payload.envelope_id }),
      );
    }

    if (payload.type !== 'events_api') return;
    const event = payload.payload?.event;
    if (!event) return;
    if (event.type !== 'message') return;
    if (!event.user || !event.text || !event.channel) return;
    if (event.bot_id) return;

    await this.handleInbound({
      channel: 'slack',
      senderID: event.user,
      displayName: event.user,
      conversationID: event.channel,
      text: event.text,
      raw: payload,
    });
  }

  private async startTelegramPolling(): Promise<void> {
    const token = process.env.MIYA_TELEGRAM_BOT_TOKEN;
    if (!token) {
      upsertChannelState(this.projectDir, 'telegram', {
        enabled: false,
        connected: false,
        lastError: 'Missing MIYA_TELEGRAM_BOT_TOKEN',
      });
      return;
    }

    if (this.telegramPolling) return;
    this.telegramPolling = true;
    upsertChannelState(this.projectDir, 'telegram', {
      enabled: true,
      connected: true,
      lastError: undefined,
    });

    const poll = async (): Promise<void> => {
      if (!this.telegramPolling) return;

      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?timeout=20&offset=${this.telegramOffset}`;
        const response = await fetch(url);
        const body = (await response.json()) as {
          ok?: boolean;
          result?: Array<{
            update_id: number;
            message?: {
              chat?: { id?: number | string; type?: string; title?: string };
              from?: {
                id?: number | string;
                username?: string;
                first_name?: string;
              };
              text?: string;
            };
          }>;
          description?: string;
        };

        if (!body.ok) {
          throw new Error(body.description ?? 'telegram_get_updates_failed');
        }

        for (const update of body.result ?? []) {
          this.telegramOffset = Math.max(
            this.telegramOffset,
            Number(update.update_id) + 1,
          );
          const message = update.message;
          if (!message?.text || !message.chat?.id || !message.from?.id) {
            continue;
          }

          await this.handleInbound({
            channel: 'telegram',
            senderID: String(message.from.id),
            displayName:
              message.from.username ??
              message.from.first_name ??
              String(message.from.id),
            conversationID: String(message.chat.id),
            text: message.text,
            raw: update,
          });
        }

        upsertChannelState(this.projectDir, 'telegram', {
          connected: true,
          lastError: undefined,
        });
      } catch (error) {
        upsertChannelState(this.projectDir, 'telegram', {
          connected: false,
          lastError: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (this.telegramPolling) {
          setTimeout(() => {
            void poll();
          }, 500);
        }
      }
    };

    void poll();
  }

  stop(): void {
    this.telegramPolling = false;
    this.slackSocketModeRunning = false;
    if (this.slackReconnectTimer) {
      clearTimeout(this.slackReconnectTimer);
      this.slackReconnectTimer = undefined;
    }
    if (this.slackSocket) {
      try {
        this.slackSocket.close();
      } catch {}
      this.slackSocket = undefined;
    }
  }

  async handleInbound(message: ChannelInboundMessage): Promise<void> {
    const allowByEnv = parseEnvList(process.env.MIYA_ALLOWED_SENDERS);
    const isAllowed =
      allowByEnv.length > 0
        ? allowByEnv.includes(message.senderID)
        : isSenderAllowed(this.projectDir, message.channel, message.senderID);

    if (!isAllowed) {
      const pair = ensurePairRequest(this.projectDir, {
        channel: message.channel,
        senderID: message.senderID,
        displayName: message.displayName,
        messagePreview: message.text.slice(0, 120),
      });
      await this.callbacks.onPairRequested(pair);
      await this.sendPairingMessage(message.channel, message.conversationID);
      return;
    }

    await this.callbacks.onInbound(message);
  }

  private recordOutboundAttempt(
    row: Omit<ChannelOutboundAudit, 'id' | 'at'> & { id?: string; at?: string },
  ): ChannelOutboundAudit {
    const semanticTags = normalizeSemanticTags(
      row.semanticTags ?? semanticTagsForOutboundMessage(row.message),
    );
    assertSemanticTags(semanticTags);
    const payload: ChannelOutboundAudit = {
      id: row.id ?? `out_${randomUUID()}`,
      at: row.at ?? new Date().toISOString(),
      channel: row.channel,
      destination: row.destination,
      textPreview: row.textPreview,
      sent: row.sent,
      message: row.message,
      mediaPath: row.mediaPath,
      reason: row.reason,
      riskLevel: row.riskLevel,
      archAdvisorApproved: row.archAdvisorApproved,
      targetInAllowlist: row.targetInAllowlist,
      contactTier: row.contactTier,
      intent: row.intent,
      containsSensitive: row.containsSensitive,
      policyHash: row.policyHash,
      sendFingerprint: row.sendFingerprint,
      ticketSummary: row.ticketSummary,
      visualPrecheck: row.visualPrecheck,
      visualPostcheck: row.visualPostcheck,
      automationPath: row.automationPath,
      uiaPath: row.uiaPath,
      targetHwnd: row.targetHwnd,
      foregroundBefore: row.foregroundBefore,
      foregroundAfter: row.foregroundAfter,
      fallbackReason: row.fallbackReason,
      simulationStatus: row.simulationStatus,
      simulationRiskHints: row.simulationRiskHints,
      receiptStatus: row.receiptStatus,
      payloadHash: row.payloadHash,
      windowFingerprint: row.windowFingerprint,
      recipientTextCheck: row.recipientTextCheck,
      sendStatusCheck: row.sendStatusCheck,
      preSendScreenshotPath: row.preSendScreenshotPath,
      postSendScreenshotPath: row.postSendScreenshotPath,
      failureStep: row.failureStep,
      routeLevel: row.routeLevel,
      somSelectionSource: row.somSelectionSource,
      somSelectedCandidateId: row.somSelectedCandidateId,
      vlmCallsUsed: row.vlmCallsUsed,
      actionPlanMemoryHit: row.actionPlanMemoryHit,
      automationLatencyMs: row.automationLatencyMs,
      automationKpi: row.automationKpi,
      ocrSource: row.ocrSource,
      ocrPreview: row.ocrPreview,
      captureMethod: row.captureMethod,
      evidenceConfidence: row.evidenceConfidence,
      evidenceLimitations: row.evidenceLimitations,
      evidenceBundle: buildEvidenceBundle(row),
      semanticSummary: buildSemanticSummary(row),
      semanticTags,
    };
    appendOutboundAudit(this.projectDir, payload);
    return payload;
  }

  private checkThrottle(
    channel: ChannelName,
    destination: string,
  ): string | null {
    const now = Date.now();
    const key = `${channel}:${destination}`;
    const policy = readPolicy(this.projectDir);
    const windowMs = Math.max(
      1000,
      Number(policy.outbound.burstWindowMs || 60000),
    );
    const minIntervalMs = Math.max(
      500,
      Number(policy.outbound.minIntervalMs || 4000),
    );
    const burstLimit = Math.max(1, Number(policy.outbound.burstLimit || 3));
    const list = (this.outboundThrottle.get(key) ?? []).filter(
      (ts) => now - ts <= windowMs,
    );
    if (list.length > 0 && now - list[list.length - 1] < minIntervalMs) {
      this.outboundThrottle.set(key, list);
      return `throttled:min_interval_${minIntervalMs}ms`;
    }
    if (list.length >= burstLimit) {
      this.outboundThrottle.set(key, list);
      return `throttled:burst_limit_${burstLimit}_per_${windowMs}ms`;
    }
    list.push(now);
    this.outboundThrottle.set(key, list);
    return null;
  }

  private checkDuplicatePayload(
    channel: ChannelName,
    destination: string,
    text: string,
  ): string | null {
    const now = Date.now();
    const policy = readPolicy(this.projectDir);
    const duplicateWindowMs = Math.max(
      1000,
      Number(policy.outbound.duplicateWindowMs || 60000),
    );
    const key = `${channel}:${destination}`;
    const payloadHash = createHash('sha256')
      .update(text)
      .digest('hex')
      .slice(0, 24);
    const recent = (this.outboundPayloadHistory.get(key) ?? []).filter(
      (item) => now - item.at <= duplicateWindowMs,
    );
    const duplicated = recent.some((item) => item.hash === payloadHash);
    if (!duplicated) {
      recent.push({ at: now, hash: payloadHash });
      this.outboundPayloadHistory.set(key, recent);
      return null;
    }
    this.outboundPayloadHistory.set(key, recent);
    return `duplicate_payload_within_${duplicateWindowMs}ms`;
  }

  private isDesktopChannel(channel: ChannelName): boolean {
    return channel === 'qq' || channel === 'wechat';
  }

  private inMutexCooldown(sessionID: string): boolean {
    const until = this.inputMutexCooldownUntil.get(sessionID) ?? 0;
    return until > Date.now();
  }

  private markMutexTimeout(sessionID: string): void {
    const strikes = (this.inputMutexStrike.get(sessionID) ?? 0) + 1;
    this.inputMutexStrike.set(sessionID, strikes);
    if (strikes >= INPUT_MUTEX_STRIKE_LIMIT) {
      this.inputMutexCooldownUntil.set(
        sessionID,
        Date.now() + INPUT_MUTEX_COOLDOWN_MS,
      );
      this.inputMutexStrike.set(sessionID, 0);
    }
  }

  private clearMutexStrike(sessionID: string): void {
    this.inputMutexStrike.set(sessionID, 0);
  }

  private checkSendFingerprint(sendFingerprint: string): string | null {
    const now = Date.now();
    const windowMs = 60_000;
    for (const [fingerprint, ts] of this.sendFingerprintHistory.entries()) {
      if (now - ts > windowMs) {
        this.sendFingerprintHistory.delete(fingerprint);
      }
    }
    if (this.sendFingerprintHistory.has(sendFingerprint)) {
      return 'duplicate_send_fingerprint';
    }
    this.sendFingerprintHistory.set(sendFingerprint, now);
    return null;
  }

  private normalizeDesktopRuntimeError(error: unknown): string {
    const raw =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'unknown';
    return (
      raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9:_-]+/g, '_')
        .slice(0, 120) || 'unknown'
    );
  }

  private recordDesktopRuntimeFailure(input: {
    channel: ChannelName;
    destination: string;
    textPreview: string;
    archAdvisorApproved: boolean;
    targetInAllowlist: boolean;
    contactTier: 'owner' | 'friend' | null;
    intent: 'reply' | 'initiate';
    containsSensitive: boolean;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    policyHash?: string;
    sendFingerprint?: string;
    ticketSummary?: {
      outboundSendTraceId: string;
      desktopControlTraceId: string;
      expiresAt: string;
    };
    payloadHash: string;
    error: unknown;
  }): { sent: false; message: string; auditID: string } {
    const detail = this.normalizeDesktopRuntimeError(input.error);
    const audit = this.recordOutboundAttempt({
      channel: input.channel,
      destination: input.destination,
      textPreview: input.textPreview,
      sent: false,
      message: `outbound_degraded:desktop_runtime_exception:${detail}`,
      reason: 'desktop_send_failed',
      archAdvisorApproved: input.archAdvisorApproved,
      targetInAllowlist: input.targetInAllowlist,
      contactTier: input.contactTier,
      intent: input.intent,
      containsSensitive: input.containsSensitive,
      riskLevel: input.riskLevel,
      policyHash: input.policyHash,
      sendFingerprint: input.sendFingerprint,
      ticketSummary: input.ticketSummary,
      payloadHash: input.payloadHash,
      failureStep: 'desktop.runtime',
    });
    return { sent: false, message: audit.message, auditID: audit.id };
  }

  async sendMessage(input: {
    channel: ChannelName;
    destination: string;
    text?: string;
    mediaPath?: string;
    sessionID?: string;
    sendFingerprint?: string;
    payloadHash?: string;
    approvalTickets?: {
      outboundSend: {
        traceID: string;
        expiresAt: string;
      };
      desktopControl: {
        traceID: string;
        expiresAt: string;
      };
    };
    outboundCheck?: {
      archAdvisorApproved?: boolean;
      riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
      intent?: 'reply' | 'initiate';
      containsSensitive?: boolean;
      bypassAllowlist?: boolean;
      bypassThrottle?: boolean;
      bypassDuplicateGuard?: boolean;
      policyHash?: string;
    };
  }): Promise<{ sent: boolean; message: string; auditID?: string }> {
    const text = (input.text ?? '').trim();
    const mediaPath = (input.mediaPath ?? '').trim();
    const payloadHash = (
      input.payloadHash ??
      createHash('sha256').update(`${text}||${mediaPath}`).digest('hex')
    ).trim();
    if (!text && !mediaPath) {
      return { sent: false, message: 'invalid_outbound_payload_empty' };
    }

    try {
      assertChannelCanSend(input.channel);
    } catch (error) {
      const audit = this.recordOutboundAttempt({
        channel: input.channel,
        destination: input.destination,
        textPreview: text.slice(0, 200),
        sent: false,
        message: error instanceof Error ? error.message : String(error),
        reason: 'channel_blocked',
        payloadHash,
      });
      return {
        sent: false,
        message: audit.message,
        auditID: audit.id,
      };
    }

    const archAdvisorApproved = Boolean(
      input.outboundCheck?.archAdvisorApproved,
    );
    const riskLevel = input.outboundCheck?.riskLevel ?? 'HIGH';
    const intent = input.outboundCheck?.intent ?? 'initiate';
    const containsSensitive = Boolean(input.outboundCheck?.containsSensitive);
    const policyHash = input.outboundCheck?.policyHash;
    const sessionID = (input.sessionID ?? 'main').trim() || 'main';
    const ticketSummary =
      input.approvalTickets?.outboundSend &&
      input.approvalTickets.desktopControl
        ? {
            outboundSendTraceId: input.approvalTickets.outboundSend.traceID,
            desktopControlTraceId: input.approvalTickets.desktopControl.traceID,
            expiresAt:
              Date.parse(input.approvalTickets.outboundSend.expiresAt) <
              Date.parse(input.approvalTickets.desktopControl.expiresAt)
                ? input.approvalTickets.outboundSend.expiresAt
                : input.approvalTickets.desktopControl.expiresAt,
          }
        : undefined;
    if (!archAdvisorApproved) {
      const audit = this.recordOutboundAttempt({
        channel: input.channel,
        destination: input.destination,
        textPreview: text.slice(0, 200),
        sent: false,
        message: 'outbound_blocked:arch_advisor_denied',
        reason: 'arch_advisor_denied',
        archAdvisorApproved,
        riskLevel,
        intent,
        containsSensitive,
        policyHash,
        payloadHash,
      });
      return { sent: false, message: audit.message, auditID: audit.id };
    }

    const targetInAllowlist =
      input.outboundCheck?.bypassAllowlist === true
        ? true
        : isSenderAllowed(this.projectDir, input.channel, input.destination);
    if (!targetInAllowlist) {
      const audit = this.recordOutboundAttempt({
        channel: input.channel,
        destination: input.destination,
        textPreview: text.slice(0, 200),
        sent: false,
        message: `outbound_blocked:target_not_in_allowlist:${input.channel}`,
        reason: 'allowlist_denied',
        archAdvisorApproved,
        targetInAllowlist,
        riskLevel,
        intent,
        containsSensitive,
        policyHash,
        payloadHash,
      });
      return { sent: false, message: audit.message, auditID: audit.id };
    }

    const tier =
      input.outboundCheck?.bypassAllowlist === true
        ? 'owner'
        : getContactTier(this.projectDir, input.channel, input.destination);
    if (tier === 'friend') {
      if (intent !== 'reply') {
        const audit = this.recordOutboundAttempt({
          channel: input.channel,
          destination: input.destination,
          textPreview: text.slice(0, 200),
          sent: false,
          message: 'outbound_blocked:friend_tier_can_only_reply',
          reason: 'allowlist_denied',
          archAdvisorApproved,
          targetInAllowlist,
          contactTier: tier,
          intent,
          containsSensitive,
          riskLevel,
          policyHash,
          payloadHash,
        });
        return { sent: false, message: audit.message, auditID: audit.id };
      }
      if (containsSensitive) {
        const audit = this.recordOutboundAttempt({
          channel: input.channel,
          destination: input.destination,
          textPreview: text.slice(0, 200),
          sent: false,
          message: 'outbound_blocked:friend_tier_sensitive_content_denied',
          reason: 'allowlist_denied',
          archAdvisorApproved,
          targetInAllowlist,
          contactTier: tier,
          intent,
          containsSensitive,
          riskLevel,
          policyHash,
          payloadHash,
        });
        return { sent: false, message: audit.message, auditID: audit.id };
      }
    }

    if (input.outboundCheck?.bypassThrottle !== true) {
      const throttle = this.checkThrottle(input.channel, input.destination);
      if (throttle) {
        const audit = this.recordOutboundAttempt({
          channel: input.channel,
          destination: input.destination,
          textPreview: text.slice(0, 200),
          sent: false,
          message: `outbound_blocked:${throttle}`,
          reason: 'throttled',
          archAdvisorApproved,
          targetInAllowlist,
          contactTier: tier,
          intent,
          containsSensitive,
          riskLevel,
          policyHash,
          payloadHash,
        });
        return { sent: false, message: audit.message, auditID: audit.id };
      }
    }

    if (input.outboundCheck?.bypassDuplicateGuard !== true) {
      const duplicate = this.checkDuplicatePayload(
        input.channel,
        input.destination,
        `${text}||${mediaPath}`,
      );
      if (duplicate) {
        const audit = this.recordOutboundAttempt({
          channel: input.channel,
          destination: input.destination,
          textPreview: text.slice(0, 200),
          sent: false,
          message: `outbound_blocked:${duplicate}`,
          reason: 'duplicate_payload',
          archAdvisorApproved,
          targetInAllowlist,
          contactTier: tier,
          intent,
          containsSensitive,
          riskLevel,
          policyHash,
          payloadHash,
        });
        return { sent: false, message: audit.message, auditID: audit.id };
      }
    }

    if (input.sendFingerprint) {
      const fingerprintDup = this.checkSendFingerprint(input.sendFingerprint);
      if (fingerprintDup) {
        const audit = this.recordOutboundAttempt({
          channel: input.channel,
          destination: input.destination,
          textPreview: text.slice(0, 200),
          sent: false,
          message: `outbound_blocked:${fingerprintDup}`,
          reason: 'duplicate_payload',
          archAdvisorApproved,
          targetInAllowlist,
          contactTier: tier,
          intent,
          containsSensitive,
          riskLevel,
          policyHash,
          sendFingerprint: input.sendFingerprint,
          ticketSummary,
          payloadHash,
        });
        return { sent: false, message: audit.message, auditID: audit.id };
      }
    }

    let mutexLease: InputMutexLease | null = null;
    if (this.isDesktopChannel(input.channel)) {
      if (this.inMutexCooldown(sessionID)) {
        const audit = this.recordOutboundAttempt({
          channel: input.channel,
          destination: input.destination,
          textPreview: text.slice(0, 200),
          sent: false,
          message: 'outbound_degraded:input_mutex_cooldown:draft_only',
          reason: 'desktop_send_failed',
          archAdvisorApproved,
          targetInAllowlist,
          contactTier: tier,
          intent,
          containsSensitive,
          riskLevel,
          policyHash,
          sendFingerprint: input.sendFingerprint,
          ticketSummary,
          payloadHash,
        });
        return { sent: false, message: audit.message, auditID: audit.id };
      }
      try {
        mutexLease = await acquireInputMutex(sessionID, INPUT_MUTEX_TIMEOUT_MS);
      } catch {
        this.markMutexTimeout(sessionID);
        const audit = this.recordOutboundAttempt({
          channel: input.channel,
          destination: input.destination,
          textPreview: text.slice(0, 200),
          sent: false,
          message: 'outbound_degraded:input_mutex_timeout:draft_only',
          reason: 'desktop_send_failed',
          archAdvisorApproved,
          targetInAllowlist,
          contactTier: tier,
          intent,
          containsSensitive,
          riskLevel,
          policyHash,
          sendFingerprint: input.sendFingerprint,
          ticketSummary,
          payloadHash,
        });
        return { sent: false, message: audit.message, auditID: audit.id };
      }
    }

    if (input.channel === 'qq' || input.channel === 'wechat') {
      try {
        if (input.channel === 'qq') {
          const result = await this.sendQqDesktopMessageImpl({
            projectDir: this.projectDir,
            destination: input.destination,
            text,
            mediaPath,
            riskLevel,
          });
          const visionCheck = await this.analyzeDesktopOutboundEvidenceImpl({
            destination: input.destination,
            preSendScreenshotPath: result.preSendScreenshotPath,
            postSendScreenshotPath: result.postSendScreenshotPath,
            visualPrecheck: result.visualPrecheck,
            visualPostcheck: result.visualPostcheck,
            receiptStatus: result.receiptStatus,
            recipientTextCheck: result.recipientTextCheck,
          });
          if (visionCheck.recipientMatch === 'mismatch') {
            result.sent = false;
            result.message = 'outbound_blocked:recipient_text_mismatch';
          }
          if (visionCheck.sendStatusDetected === 'failed') {
            result.sent = false;
            result.message = 'outbound_blocked:receipt_uncertain';
          }
          if (visionCheck.uiStyleMismatch) {
            result.sent = false;
            result.message = 'outbound_degraded:ui_style_mismatch:draft_only';
          }
          if (result.sent && result.receiptStatus !== 'confirmed') {
            result.sent = false;
            result.message = 'outbound_blocked:receipt_uncertain';
          }
          const audit = this.recordOutboundAttempt({
            channel: 'qq',
            destination: input.destination,
            textPreview: text.slice(0, 200),
            sent: result.sent,
            message: result.message,
            mediaPath: mediaPath || undefined,
            reason: result.sent ? 'sent' : 'desktop_send_failed',
            archAdvisorApproved,
            targetInAllowlist,
            contactTier: tier,
            intent,
            containsSensitive,
            riskLevel,
            policyHash,
            sendFingerprint: input.sendFingerprint,
            ticketSummary,
            payloadHash: result.payloadHash ?? payloadHash,
            windowFingerprint: result.windowFingerprint,
            recipientTextCheck:
              visionCheck.recipientMatch === 'matched' ||
              visionCheck.recipientMatch === 'mismatch'
                ? visionCheck.recipientMatch
                : result.recipientTextCheck,
            sendStatusCheck: visionCheck.sendStatusDetected,
            preSendScreenshotPath: result.preSendScreenshotPath,
            postSendScreenshotPath: result.postSendScreenshotPath,
            failureStep: result.failureStep,
            ocrSource: visionCheck.ocrSource,
            ocrPreview: visionCheck.ocrPreview,
            captureMethod: visionCheck.capture.method,
            evidenceConfidence: visionCheck.capture.confidence,
            evidenceLimitations: visionCheck.capture.limitations,
            automationPath: result.automationPath,
            uiaPath: result.uiaPath,
            targetHwnd: result.targetHwnd,
            foregroundBefore: result.foregroundBefore,
            foregroundAfter: result.foregroundAfter,
            fallbackReason: result.fallbackReason,
            simulationStatus: result.simulationStatus,
            simulationRiskHints: result.simulationRiskHints,
            visualPrecheck: result.visualPrecheck,
            visualPostcheck: result.visualPostcheck,
            receiptStatus: result.receiptStatus,
            routeLevel: result.routeLevel,
            somSelectionSource: result.somSelectionSource,
            somSelectedCandidateId: result.somSelectedCandidateId,
            vlmCallsUsed: result.vlmCallsUsed,
            actionPlanMemoryHit: result.actionPlanMemoryHit,
            automationLatencyMs: result.latencyMs,
            automationKpi: result.kpiSnapshot,
          });
          if (result.sent) {
            this.clearMutexStrike(sessionID);
          }
          if (!audit.evidenceBundle || !audit.semanticSummary) {
            return {
              sent: false,
              message: 'outbound_blocked:missing_evidence_bundle',
              auditID: audit.id,
            };
          }
          return { ...result, auditID: audit.id };
        }

        const result = await this.sendWechatDesktopMessageImpl({
          projectDir: this.projectDir,
          destination: input.destination,
          text,
          mediaPath,
          riskLevel,
        });
        const visionCheck = await this.analyzeDesktopOutboundEvidenceImpl({
          destination: input.destination,
          preSendScreenshotPath: result.preSendScreenshotPath,
          postSendScreenshotPath: result.postSendScreenshotPath,
          visualPrecheck: result.visualPrecheck,
          visualPostcheck: result.visualPostcheck,
          receiptStatus: result.receiptStatus,
          recipientTextCheck: result.recipientTextCheck,
        });
        if (visionCheck.recipientMatch === 'mismatch') {
          result.sent = false;
          result.message = 'outbound_blocked:recipient_text_mismatch';
        }
        if (visionCheck.sendStatusDetected === 'failed') {
          result.sent = false;
          result.message = 'outbound_blocked:receipt_uncertain';
        }
        if (visionCheck.uiStyleMismatch) {
          result.sent = false;
          result.message = 'outbound_degraded:ui_style_mismatch:draft_only';
        }
        if (result.sent && result.receiptStatus !== 'confirmed') {
          result.sent = false;
          result.message = 'outbound_blocked:receipt_uncertain';
        }
        const audit = this.recordOutboundAttempt({
          channel: 'wechat',
          destination: input.destination,
          textPreview: text.slice(0, 200),
          sent: result.sent,
          message: result.message,
          mediaPath: mediaPath || undefined,
          reason: result.sent ? 'sent' : 'desktop_send_failed',
          archAdvisorApproved,
          targetInAllowlist,
          contactTier: tier,
          intent,
          containsSensitive,
          riskLevel,
          policyHash,
          sendFingerprint: input.sendFingerprint,
          ticketSummary,
          payloadHash: result.payloadHash ?? payloadHash,
          windowFingerprint: result.windowFingerprint,
          recipientTextCheck:
            visionCheck.recipientMatch === 'matched' ||
            visionCheck.recipientMatch === 'mismatch'
              ? visionCheck.recipientMatch
              : result.recipientTextCheck,
          sendStatusCheck: visionCheck.sendStatusDetected,
          preSendScreenshotPath: result.preSendScreenshotPath,
          postSendScreenshotPath: result.postSendScreenshotPath,
          failureStep: result.failureStep,
          ocrSource: visionCheck.ocrSource,
          ocrPreview: visionCheck.ocrPreview,
          captureMethod: visionCheck.capture.method,
          evidenceConfidence: visionCheck.capture.confidence,
          evidenceLimitations: visionCheck.capture.limitations,
          automationPath: result.automationPath,
          uiaPath: result.uiaPath,
          targetHwnd: result.targetHwnd,
          foregroundBefore: result.foregroundBefore,
          foregroundAfter: result.foregroundAfter,
          fallbackReason: result.fallbackReason,
          simulationStatus: result.simulationStatus,
          simulationRiskHints: result.simulationRiskHints,
          visualPrecheck: result.visualPrecheck,
          visualPostcheck: result.visualPostcheck,
          receiptStatus: result.receiptStatus,
          routeLevel: result.routeLevel,
          somSelectionSource: result.somSelectionSource,
          somSelectedCandidateId: result.somSelectedCandidateId,
          vlmCallsUsed: result.vlmCallsUsed,
          actionPlanMemoryHit: result.actionPlanMemoryHit,
          automationLatencyMs: result.latencyMs,
          automationKpi: result.kpiSnapshot,
        });
        if (result.sent) {
          this.clearMutexStrike(sessionID);
        }
        if (!audit.evidenceBundle || !audit.semanticSummary) {
          return {
            sent: false,
            message: 'outbound_blocked:missing_evidence_bundle',
            auditID: audit.id,
          };
        }
        return { ...result, auditID: audit.id };
      } catch (error) {
        return this.recordDesktopRuntimeFailure({
          channel: input.channel,
          destination: input.destination,
          textPreview: text.slice(0, 200),
          archAdvisorApproved,
          targetInAllowlist,
          contactTier: tier,
          intent,
          containsSensitive,
          riskLevel,
          policyHash,
          sendFingerprint: input.sendFingerprint,
          ticketSummary,
          payloadHash,
          error,
        });
      } finally {
        mutexLease?.release();
      }
    }

    mutexLease?.release();
    return {
      sent: false,
      message: `channel_send_blocked:${input.channel}:INBOUND_ONLY channels are receive-only`,
    };
  }

  private async sendPairingMessage(
    channel: ChannelName,
    destination: string,
  ): Promise<void> {
    if (channel !== 'qq' && channel !== 'wechat') {
      return;
    }
    const pairingText =
      'Miya security: your account is not paired yet. Ask admin to approve pairing in Miya control panel.';
    await this.sendMessage({
      channel,
      destination,
      text: pairingText,
      outboundCheck: {
        archAdvisorApproved: true,
        riskLevel: 'LOW',
        bypassAllowlist: true,
        bypassThrottle: true,
        bypassDuplicateGuard: true,
      },
    });
  }
}
