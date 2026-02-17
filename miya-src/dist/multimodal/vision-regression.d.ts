export interface DesktopOcrRegressionCase {
    id: string;
    app: 'qq' | 'wechat';
    theme: 'light' | 'dark';
    dpi: string;
    destination: string;
    ocrText: string;
    expectedRecipientMatch: 'matched' | 'mismatch' | 'uncertain';
    expectedSendStatus: 'sent' | 'failed' | 'uncertain';
}
export interface DesktopOcrRegressionResult {
    total: number;
    passed: number;
    passRate: number;
    failures: Array<{
        id: string;
        app: string;
        expectedRecipientMatch: string;
        actualRecipientMatch: string;
        expectedSendStatus: string;
        actualSendStatus: string;
    }>;
}
export declare function loadDesktopOcrRegressionCases(fixtureFile?: string): DesktopOcrRegressionCase[];
export declare function runDesktopOcrRegression(cases: DesktopOcrRegressionCase[]): DesktopOcrRegressionResult;
