import { sendDesktopOutbound } from './shared';

export function sendWechatDesktopMessage(input: {
  projectDir: string;
  destination: string;
  text?: string;
  mediaPath?: string;
}): {
  sent: boolean;
  message: string;
  visualPrecheck?: string;
  visualPostcheck?: string;
  receiptStatus?: 'confirmed' | 'uncertain';
  failureStep?: string;
  payloadHash?: string;
  windowFingerprint?: string;
  recipientTextCheck?: 'matched' | 'uncertain' | 'mismatch';
  preSendScreenshotPath?: string;
  postSendScreenshotPath?: string;
} {
  return sendDesktopOutbound({
    projectDir: input.projectDir,
    appName: 'WeChat',
    channel: 'wechat',
    destination: input.destination,
    text: input.text,
    mediaPath: input.mediaPath,
  });
}
