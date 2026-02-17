export interface NodeHostOptions {
    projectDir: string;
    gatewayUrl: string;
    nodeID?: string;
    deviceID?: string;
    nodeType?: 'cli' | 'desktop' | 'mobile' | 'browser';
    nodeToken?: string;
    capabilities?: string[];
    permissions?: {
        screenRecording?: boolean;
        accessibility?: boolean;
        filesystem?: 'none' | 'read' | 'full';
        network?: boolean;
    };
}
export declare function runNodeHost(options: NodeHostOptions): Promise<void>;
