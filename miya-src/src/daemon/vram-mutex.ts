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

function laneForKind(kind: ResourceTaskKind): VramTrafficLane {
  if (kind === 'vision.analyze' || kind === 'shell.exec') return 'critical';
  if (kind === 'image.generate' || kind === 'voice.tts' || kind === 'voice.asr') return 'high';
  if (kind === 'training.image' || kind === 'training.voice') return 'low';
  return 'normal';
}

export function classifyTrafficLane(kind: ResourceTaskKind): VramTrafficLane {
  return laneForKind(kind);
}

export function shouldPreemptLowLane(incoming: VramTrafficLane): boolean {
  return incoming === 'critical' || incoming === 'high';
}

export class VramMutex {
  private readonly active = new Map<string, VramTaskControl>();

  register(input: { daemonJobID: string; kind: ResourceTaskKind; trainingJobID?: string }): void {
    this.active.set(input.daemonJobID, {
      daemonJobID: input.daemonJobID,
      kind: input.kind,
      lane: laneForKind(input.kind),
      trainingJobID: input.trainingJobID,
    });
  }

  updateTerminators(
    daemonJobID: string,
    input: { terminateSoft?: () => void; terminateHard?: () => void },
  ): void {
    const current = this.active.get(daemonJobID);
    if (!current) return;
    this.active.set(daemonJobID, {
      ...current,
      terminateSoft: input.terminateSoft ?? current.terminateSoft,
      terminateHard: input.terminateHard ?? current.terminateHard,
    });
  }

  unregister(daemonJobID: string): void {
    this.active.delete(daemonJobID);
  }

  lowLaneTargets(): VramTaskControl[] {
    return [...this.active.values()].filter((item) => item.lane === 'low');
  }

  hasActiveJob(daemonJobID: string): boolean {
    return this.active.has(daemonJobID);
  }
}

