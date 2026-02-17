import type { GatewayMethodRegistry } from '../protocol';
interface GatewayCoreMethodDeps {
    projectDir: string;
    runtime: {
        methods: GatewayMethodRegistry;
    };
    now: () => string;
    buildSnapshot: () => {
        doctor: unknown;
    };
    buildGatewayState: () => unknown;
    scheduleGatewayStop: () => void;
    ensureGatewayRunning: () => {
        url: string;
    };
    probeGatewayAlive: (url: string, timeoutMs?: number) => Promise<boolean>;
    listActionLedger: (limit: number) => unknown[];
}
export declare function registerGatewayCoreMethods(methods: GatewayMethodRegistry, deps: GatewayCoreMethodDeps): void;
export {};
