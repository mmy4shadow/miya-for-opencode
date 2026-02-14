import { sendDesktopOutbound } from './shared';

export async function sendWechatDesktopMessage(input: {
  projectDir: string;
  destination: string;
  text?: string;
  mediaPath?: string;
}): Promise<{
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
}> {
  return await sendDesktopOutbound({
    projectDir: input.projectDir,
    appName: 'WeChat',
    channel: 'wechat',
    destination: input.destination,
    text: input.text,
    mediaPath: input.mediaPath,
  });
}
