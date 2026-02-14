import { sendDesktopOutbound } from './shared';

export function sendWechatDesktopMessage(input: {
  destination: string;
  text?: string;
  mediaPath?: string;
}): {
  sent: boolean;
  message: string;
  visualPrecheck?: string;
  visualPostcheck?: string;
  receiptStatus?: 'confirmed' | 'uncertain';
} {
  return sendDesktopOutbound({
    appName: 'WeChat',
    channel: 'wechat',
    destination: input.destination,
    text: input.text,
    mediaPath: input.mediaPath,
  });
}
