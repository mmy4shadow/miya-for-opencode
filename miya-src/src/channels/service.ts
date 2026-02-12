import type { ChannelName } from './types';
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
    this.syncSlackConfigState();
  }

  private syncSlackConfigState(): void {
    const hasSlack = !!process.env.MIYA_SLACK_BOT_TOKEN;
    upsertChannelState(this.projectDir, 'slack', {
      enabled: hasSlack,
      connected: hasSlack,
      lastError: hasSlack ? undefined : 'Missing MIYA_SLACK_BOT_TOKEN',
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
    if (input.channel === 'webchat') {
      return {
        sent: true,
        message: 'webchat_echo',
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
