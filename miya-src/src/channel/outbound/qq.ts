import { sendDesktopOutbound, type DesktopOutboundResult } from './shared';

export async function sendQqDesktopMessage(input: {
  projectDir: string;
  destination: string;
  text?: string;
  mediaPath?: string;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
}): Promise<DesktopOutboundResult> {
  return await sendDesktopOutbound({
    projectDir: input.projectDir,
    appName: 'QQ',
    channel: 'qq',
    destination: input.destination,
    text: input.text,
    mediaPath: input.mediaPath,
    riskLevel: input.riskLevel,
  });
}
