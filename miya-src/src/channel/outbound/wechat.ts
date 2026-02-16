import { sendDesktopOutbound, type DesktopOutboundResult } from './shared';

export async function sendWechatDesktopMessage(input: {
  projectDir: string;
  destination: string;
  text?: string;
  mediaPath?: string;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
}): Promise<DesktopOutboundResult> {
  return await sendDesktopOutbound({
    projectDir: input.projectDir,
    appName: 'WeChat',
    channel: 'wechat',
    destination: input.destination,
    text: input.text,
    mediaPath: input.mediaPath,
    riskLevel: input.riskLevel,
  });
}
