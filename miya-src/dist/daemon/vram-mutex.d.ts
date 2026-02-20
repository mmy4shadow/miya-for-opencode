import type { ResourceTaskKind } from '../resource-scheduler';
export type VramTrafficLane = 'critical' | 'high' | 'normal' | 'low';
export interface VramTaskControl {
    daemonJobID: string;
    kind: ResourceTaskKind;
    lane: VramTrafficLane;
    trainingJobID?: string;
    terminateSoft?: () => void;
    terminateHard?: () => void;
}
export declare function classifyTrafficLane(kind: ResourceTaskKind): VramTrafficLane;
export declare function shouldPreemptLowLane(incoming: VramTrafficLane): boolean;
export declare class VramMutex {
    private readonly active;
    register(input: {
        daemonJobID: string;
        kind: ResourceTaskKind;
        trainingJobID?: string;
    }): void;
    updateTerminators(daemonJobID: string, input: {
        terminateSoft?: () => void;
        terminateHard?: () => void;
    }): void;
    unregister(daemonJobID: string): void;
    lowLaneTargets(): VramTaskControl[];
    hasActiveJob(daemonJobID: string): boolean;
}
