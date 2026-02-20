export interface DesktopOutboundResult {
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
}
export declare function deriveDesktopFailureDetail(input: {
    signal: string;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    exitCode: number;
}): string;
export declare function sendDesktopOutbound(input: {
    projectDir: string;
    appName: 'QQ' | 'WeChat';
    channel: 'qq' | 'wechat';
    destination: string;
    text?: string;
    mediaPath?: string;
}): Promise<DesktopOutboundResult>;
