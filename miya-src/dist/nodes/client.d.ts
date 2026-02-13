export interface NodeHostOptions {
    projectDir: string;
    gatewayUrl: string;
    nodeID?: string;
    deviceID?: string;
    capabilities?: string[];
}
export declare function runNodeHost(options: NodeHostOptions): Promise<void>;
