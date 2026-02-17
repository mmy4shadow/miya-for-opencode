import { type DesktopOutboundResult } from './shared';
export declare function sendQqDesktopMessage(input: {
    projectDir: string;
    destination: string;
    text?: string;
    mediaPath?: string;
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
}): Promise<DesktopOutboundResult>;
