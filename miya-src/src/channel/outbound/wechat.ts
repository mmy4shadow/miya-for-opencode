import { sendDesktopOutbound } from './shared';

export function sendWechatDesktopMessage(input: {
  destination: string;
  text?: string;
  mediaPath?: string;
}): { sent: boolean; message: string } {
  return sendDesktopOutbound({
    appName: 'WeChat',
    channel: 'wechat',
    destination: input.destination,
    text: input.text,
    mediaPath: input.mediaPath,
  });
}
