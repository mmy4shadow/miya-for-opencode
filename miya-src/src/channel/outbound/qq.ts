import { sendDesktopOutbound } from './shared';

export function sendQqDesktopMessage(input: {
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
    appName: 'QQ',
    channel: 'qq',
    destination: input.destination,
    text: input.text,
    mediaPath: input.mediaPath,
  });
}
