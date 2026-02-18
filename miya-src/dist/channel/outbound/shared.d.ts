import { type AutomationRisk, type DesktopActionPlan, type DesktopAutomationAcceptanceSnapshot, type DesktopPerceptionRoute } from './vision-action-bridge';
export interface DesktopOutboundResult {
    sent: boolean;
    message: string;
    automationPath?: 'uia' | 'sendkeys' | 'mixed';
    uiaPath?: 'valuepattern' | 'clipboard_sendkeys' | 'none';
    targetHwnd?: string;
    foregroundBefore?: string;
    foregroundAfter?: string;
    fallbackReason?: string;
    simulationStatus?: 'captured' | 'not_available';
    simulationRiskHints?: string[];
    visualPrecheck?: string;
    visualPostcheck?: string;
    receiptStatus?: 'confirmed' | 'uncertain';
    failureStep?: string;
    payloadHash?: string;
    windowFingerprint?: string;
    recipientTextCheck?: 'matched' | 'uncertain' | 'mismatch';
    preSendScreenshotPath?: string;
    postSendScreenshotPath?: string;
    routeLevel?: DesktopPerceptionRoute;
    actionPlan?: DesktopActionPlan;
    somSelectionSource?: 'memory' | 'heuristic' | 'vlm' | 'none';
    somSelectedCandidateId?: number;
    vlmCallsUsed?: number;
    actionPlanMemoryHit?: boolean;
    latencyMs?: number;
    kpiSnapshot?: {
        totalRuns: number;
        successfulRuns: number;
        vlmCallRatio: number;
        somPathHitRate: number;
        reuseTaskP95Ms: number;
        firstTaskP95Ms: number;
        highRiskMisfireRate: number;
        reuseRuns: number;
        firstRuns: number;
        acceptance?: DesktopAutomationAcceptanceSnapshot;
    };
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
    riskLevel?: AutomationRisk;
}): Promise<DesktopOutboundResult>;
