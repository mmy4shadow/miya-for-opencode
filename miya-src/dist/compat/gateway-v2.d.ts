import type { GatewayMethodRegistry } from '../gateway/protocol';
export interface GatewayV2AliasReport {
    scanned: number;
    created: number;
    skipped: number;
    aliases: Array<{
        alias: string;
        target: string;
    }>;
}
export declare function registerGatewayV2Aliases(methods: GatewayMethodRegistry): GatewayV2AliasReport;
