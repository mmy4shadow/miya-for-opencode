import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { sendQqDesktopMessage } from '../channel/outbound/qq';
import { sendWechatDesktopMessage } from '../channel/outbound/wechat';
import type { ChannelName } from './types';
import { assertChannelCanSend } from './policy';
import {
  ensurePairRequest,
  getContactTier,
  isSenderAllowed,
  listChannelStates,
  listPairRequests,
  resolvePairRequest,
  upsertChannelState,
} from './pairing-store';
import { getMiyaRuntimeDir } from '../workflow';
import { readPolicy } from '../policy';

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

export class ChannelRuntime {
  private readonly projectDir: string;
  private readonly callbacks: ChannelRuntimeCallbacks;
  private telegramPolling = false;
  private telegramOffset = 0;
  private slackSocketModeRunning = false;
  private slackSocket?: WebSocket;
  private slackReconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly outboundThrottle = new Map<string, number[]>();
  private readonly outboundPayloadHistory = new Map<string, Array<{ at: number; hash: string }>>();

  constructor(projectDir: string, callbacks: ChannelRuntimeCallbacks) {
    this.projectDir = projectDir;
    this.callbacks = callbacks;
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
    upsertChannelState(this.projectDir, channel, { enabled, connected: enabled });
  }

  async start(): Promise<void> {
    upsertChannelState(this.projectDir, 'webchat', { enabled: true, connected: true });
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
      lastError: hasGoogleChat ? undefined : 'Missing MIYA_GOOGLE_CHAT_WEBHOOK_URL',
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
        const openRes = await fetch('https://slack.com/api/apps.connections.open', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${appToken}`,
            'content-type': 'application/json',
          },
          body: '{}',
        });
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

    if (payload.envelope_id && this.slackSocket?.readyState === WebSocket.OPEN) {
      this.slackSocket.send(JSON.stringify({ envelope_id: payload.envelope_id }));
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
              from?: { id?: number | string; username?: string; first_name?: string };
              text?: string;
            };
          }>;
          description?: string;
        };

        if (!body.ok) {
          throw new Error(body.description ?? 'telegram_get_updates_failed');
        }

        for (const update of body.result ?? []) {
          this.telegramOffset = Math.max(this.telegramOffset, Number(update.update_id) + 1);
          const message = update.message;
          if (!message?.text || !message.chat?.id || !message.from?.id) {
            continue;
          }

          await this.handleInbound({
            channel: 'telegram',
            senderID: String(message.from.id),
            displayName:
              message.from.username ?? message.from.first_name ?? String(message.from.id),
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
    const payload: ChannelOutboundAudit = {
      id: row.id ?? `out_${randomUUID()}`,
      at: row.at ?? new Date().toISOString(),
      channel: row.channel,
      destination: row.destination,
      textPreview: row.textPreview,
      sent: row.sent,
      message: row.message,
      reason: row.reason,
      riskLevel: row.riskLevel,
      archAdvisorApproved: row.archAdvisorApproved,
      targetInAllowlist: row.targetInAllowlist,
    };
    appendOutboundAudit(this.projectDir, payload);
    return payload;
  }

  private checkThrottle(channel: ChannelName, destination: string): string | null {
    const now = Date.now();
    const key = `${channel}:${destination}`;
    const policy = readPolicy(this.projectDir);
    const windowMs = Math.max(1000, Number(policy.outbound.burstWindowMs || 60000));
    const minIntervalMs = Math.max(500, Number(policy.outbound.minIntervalMs || 4000));
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
    const payloadHash = createHash('sha256').update(text).digest('hex').slice(0, 24);
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

  async sendMessage(input: {
    channel: ChannelName;
    destination: string;
    text: string;
    outboundCheck?: {
      archAdvisorApproved?: boolean;
      riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
      intent?: 'reply' | 'initiate';
      containsSensitive?: boolean;
      bypassAllowlist?: boolean;
      bypassThrottle?: boolean;
      bypassDuplicateGuard?: boolean;
    };
  }): Promise<{ sent: boolean; message: string; auditID?: string }> {
    try {
      assertChannelCanSend(input.channel);
    } catch (error) {
      const audit = this.recordOutboundAttempt({
        channel: input.channel,
        destination: input.destination,
        textPreview: input.text.slice(0, 200),
        sent: false,
        message: error instanceof Error ? error.message : String(error),
        reason: 'channel_blocked',
      });
      return {
        sent: false,
        message: audit.message,
        auditID: audit.id,
      };
    }

    const archAdvisorApproved = Boolean(input.outboundCheck?.archAdvisorApproved);
    const riskLevel = input.outboundCheck?.riskLevel ?? 'HIGH';
    if (!archAdvisorApproved) {
      const audit = this.recordOutboundAttempt({
        channel: input.channel,
        destination: input.destination,
        textPreview: input.text.slice(0, 200),
        sent: false,
        message: 'outbound_blocked:arch_advisor_denied',
        reason: 'arch_advisor_denied',
        archAdvisorApproved,
        riskLevel,
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
        textPreview: input.text.slice(0, 200),
        sent: false,
        message: `outbound_blocked:target_not_in_allowlist:${input.channel}`,
        reason: 'allowlist_denied',
        archAdvisorApproved,
        targetInAllowlist,
        riskLevel,
      });
      return { sent: false, message: audit.message, auditID: audit.id };
    }

    const tier =
      input.outboundCheck?.bypassAllowlist === true
        ? 'owner'
        : getContactTier(this.projectDir, input.channel, input.destination);
    const intent = input.outboundCheck?.intent ?? 'initiate';
    const containsSensitive = Boolean(input.outboundCheck?.containsSensitive);
    if (tier === 'friend') {
      if (intent !== 'reply') {
        const audit = this.recordOutboundAttempt({
          channel: input.channel,
          destination: input.destination,
          textPreview: input.text.slice(0, 200),
          sent: false,
          message: 'outbound_blocked:friend_tier_can_only_reply',
          reason: 'allowlist_denied',
          archAdvisorApproved,
          targetInAllowlist,
          riskLevel,
        });
        return { sent: false, message: audit.message, auditID: audit.id };
      }
      if (containsSensitive) {
        const audit = this.recordOutboundAttempt({
          channel: input.channel,
          destination: input.destination,
          textPreview: input.text.slice(0, 200),
          sent: false,
          message: 'outbound_blocked:friend_tier_sensitive_content_denied',
          reason: 'allowlist_denied',
          archAdvisorApproved,
          targetInAllowlist,
          riskLevel,
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
          textPreview: input.text.slice(0, 200),
          sent: false,
          message: `outbound_blocked:${throttle}`,
          reason: 'throttled',
          archAdvisorApproved,
          targetInAllowlist,
          riskLevel,
        });
        return { sent: false, message: audit.message, auditID: audit.id };
      }
    }

    if (input.outboundCheck?.bypassDuplicateGuard !== true) {
      const duplicate = this.checkDuplicatePayload(
        input.channel,
        input.destination,
        input.text,
      );
      if (duplicate) {
        const audit = this.recordOutboundAttempt({
          channel: input.channel,
          destination: input.destination,
          textPreview: input.text.slice(0, 200),
          sent: false,
          message: `outbound_blocked:${duplicate}`,
          reason: 'duplicate_payload',
          archAdvisorApproved,
          targetInAllowlist,
          riskLevel,
        });
        return { sent: false, message: audit.message, auditID: audit.id };
      }
    }

    if (input.channel === 'qq') {
      const result = sendQqDesktopMessage({
        destination: input.destination,
        text: input.text,
      });
      const audit = this.recordOutboundAttempt({
        channel: 'qq',
        destination: input.destination,
        textPreview: input.text.slice(0, 200),
        sent: result.sent,
        message: result.message,
        reason: result.sent ? 'sent' : 'desktop_send_failed',
        archAdvisorApproved,
        targetInAllowlist,
        riskLevel,
      });
      return { ...result, auditID: audit.id };
    }

    if (input.channel === 'wechat') {
      const result = sendWechatDesktopMessage({
        destination: input.destination,
        text: input.text,
      });
      const audit = this.recordOutboundAttempt({
        channel: 'wechat',
        destination: input.destination,
        textPreview: input.text.slice(0, 200),
        sent: result.sent,
        message: result.message,
        reason: result.sent ? 'sent' : 'desktop_send_failed',
        archAdvisorApproved,
        targetInAllowlist,
        riskLevel,
      });
      return { ...result, auditID: audit.id };
    }
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
