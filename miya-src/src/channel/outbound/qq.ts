import { sendDesktopOutbound } from './shared';

export function sendQqDesktopMessage(input: {
  destination: string;
  text: string;
}): { sent: boolean; message: string } {
  return sendDesktopOutbound({
    appName: 'QQ',
    channel: 'qq',
    destination: input.destination,
    text: input.text,
  });
}
