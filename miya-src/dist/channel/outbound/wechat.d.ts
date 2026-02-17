import { type DesktopOutboundResult } from './shared';
export declare function sendWechatDesktopMessage(input: {
    projectDir: string;
    destination: string;
    text?: string;
    mediaPath?: string;
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
}): Promise<DesktopOutboundResult>;
