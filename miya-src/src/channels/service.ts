import type { ChannelName } from './types';
import { assertChannelCanSend } from './policy';
import {
  ensurePairRequest,
  isSenderAllowed,
  listChannelStates,
  listPairRequests,
  resolvePairRequest,
  upsertChannelState,
} from './pairing-store';

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

export class ChannelRuntime {
  private readonly projectDir: string;
  private readonly callbacks: ChannelRuntimeCallbacks;
  private telegramPolling = false;
  private telegramOffset = 0;
  private slackSocketModeRunning = false;
  private slackSocket?: WebSocket;
  private slackReconnectTimer?: ReturnType<typeof setTimeout>;

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

  async sendMessage(input: {
    channel: ChannelName;
    destination: string;
    text: string;
  }): Promise<{ sent: boolean; message: string }> {
    try {
      assertChannelCanSend(input.channel);
    } catch (error) {
      return {
        sent: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (input.channel === 'qq') {
      return {
        sent: false,
        message: 'qq_ui_automation_not_implemented',
      };
    }

    if (input.channel === 'wechat') {
      return {
        sent: false,
        message: 'wechat_ui_automation_not_implemented',
      };
    }

    if (input.channel === 'telegram') {
      const token = process.env.MIYA_TELEGRAM_BOT_TOKEN;
      if (!token) {
        return { sent: false, message: 'Missing MIYA_TELEGRAM_BOT_TOKEN' };
      }
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: input.destination,
          text: input.text,
        }),
      });
      if (!response.ok) {
        return { sent: false, message: `telegram_http_${response.status}` };
      }
      return { sent: true, message: 'telegram_sent' };
    }

    if (input.channel === 'slack') {
      const slackToken = process.env.MIYA_SLACK_BOT_TOKEN;
      if (!slackToken) {
        return { sent: false, message: 'Missing MIYA_SLACK_BOT_TOKEN' };
      }

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${slackToken}`,
        },
        body: JSON.stringify({
          channel: input.destination,
          text: input.text,
        }),
      });

      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!body.ok) {
        return {
          sent: false,
          message: body.error ?? `slack_http_${response.status}`,
        };
      }

      return { sent: true, message: 'slack_sent' };
    }

    if (input.channel === 'discord') {
      const token = process.env.MIYA_DISCORD_BOT_TOKEN;
      if (!token) return { sent: false, message: 'Missing MIYA_DISCORD_BOT_TOKEN' };
      const response = await fetch(
        `https://discord.com/api/v10/channels/${encodeURIComponent(input.destination)}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bot ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ content: input.text }),
        },
      );
      if (!response.ok) {
        return { sent: false, message: `discord_http_${response.status}` };
      }
      return { sent: true, message: 'discord_sent' };
    }

    if (input.channel === 'whatsapp') {
      const token = process.env.MIYA_WHATSAPP_TOKEN;
      const phoneNumberID = process.env.MIYA_WHATSAPP_PHONE_NUMBER_ID;
      if (!token || !phoneNumberID) {
        return {
          sent: false,
          message: 'Missing MIYA_WHATSAPP_TOKEN or MIYA_WHATSAPP_PHONE_NUMBER_ID',
        };
      }
      const response = await fetch(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(phoneNumberID)}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: input.destination,
            type: 'text',
            text: { body: input.text },
          }),
        },
      );
      if (!response.ok) {
        return { sent: false, message: `whatsapp_http_${response.status}` };
      }
      return { sent: true, message: 'whatsapp_sent' };
    }

    if (input.channel === 'google_chat') {
      const webhookUrl = process.env.MIYA_GOOGLE_CHAT_WEBHOOK_URL;
      if (!webhookUrl) return { sent: false, message: 'Missing MIYA_GOOGLE_CHAT_WEBHOOK_URL' };
      const targetUrl = input.destination.startsWith('http') ? input.destination : webhookUrl;
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: input.text }),
      });
      if (!response.ok) {
        return { sent: false, message: `google_chat_http_${response.status}` };
      }
      return { sent: true, message: 'google_chat_sent' };
    }

    if (input.channel === 'signal') {
      const signalUrl = process.env.MIYA_SIGNAL_REST_URL;
      const sourceNumber = process.env.MIYA_SIGNAL_SOURCE_NUMBER;
      if (!signalUrl || !sourceNumber) {
        return {
          sent: false,
          message: 'Missing MIYA_SIGNAL_REST_URL or MIYA_SIGNAL_SOURCE_NUMBER',
        };
      }
      const response = await fetch(`${signalUrl.replace(/\/$/, '')}/v2/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: input.text,
          number: sourceNumber,
          recipients: [input.destination],
        }),
      });
      if (!response.ok) {
        return { sent: false, message: `signal_http_${response.status}` };
      }
      return { sent: true, message: 'signal_sent' };
    }

    if (input.channel === 'imessage') {
      const apiUrl = process.env.MIYA_BLUEBUBBLES_URL;
      const password = process.env.MIYA_BLUEBUBBLES_PASSWORD;
      if (!apiUrl) return { sent: false, message: 'Missing MIYA_BLUEBUBBLES_URL' };
      const endpoint = `${apiUrl.replace(/\/$/, '')}/api/v1/message/text`;
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (password) {
        headers.authorization = password;
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          chatGuid: input.destination,
          message: input.text,
        }),
      });
      if (!response.ok) {
        return { sent: false, message: `imessage_http_${response.status}` };
      }
      return { sent: true, message: 'imessage_sent' };
    }

    if (input.channel === 'teams') {
      const webhookUrl = process.env.MIYA_TEAMS_WEBHOOK_URL;
      if (!webhookUrl) return { sent: false, message: 'Missing MIYA_TEAMS_WEBHOOK_URL' };
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'message',
          text: input.text,
        }),
      });
      if (!response.ok) {
        return { sent: false, message: `teams_http_${response.status}` };
      }
      return { sent: true, message: 'teams_sent' };
    }

    return { sent: false, message: `unsupported_channel:${input.channel}` };
  }

  private async sendPairingMessage(
    channel: ChannelName,
    destination: string,
  ): Promise<void> {
    const pairingText =
      'Miya security: your account is not paired yet. Ask admin to approve pairing in Miya control panel.';
    await this.sendMessage({
      channel,
      destination,
      text: pairingText,
    });
  }
}
