export declare function sendQqDesktopMessage(input: {
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
}>;
