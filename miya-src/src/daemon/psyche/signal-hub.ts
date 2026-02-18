import {
  collectNativeSentinelSignals,
  type NativeSentinelSignalSample,
} from './sensors';

type SignalHubCollector = () => NativeSentinelSignalSample;

export interface PsycheNativeSignalHubStatus {
  running: boolean;
  sequence: number;
  sampledAt?: string;
  ageMs: number;
  stale: boolean;
  consecutiveFailures: number;
  lastError?: string;
  sampleIntervalMs: number;
  burstIntervalMs: number;
  staleAfterMs: number;
  sample?: NativeSentinelSignalSample;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeDelay(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function normalizeCaptureLimitations(values: string[]): string[] {
  return [
    ...new Set(values.map((item) => String(item ?? '').trim()).filter(Boolean)),
  ].slice(0, 24);
}

function cloneSample(
  sample: NativeSentinelSignalSample,
): NativeSentinelSignalSample {
  return {
    sampledAt: String(sample.sampledAt ?? nowIso()),
    signals:
      sample.signals && typeof sample.signals === 'object'
        ? { ...sample.signals }
        : {},
    captureLimitations: Array.isArray(sample.captureLimitations)
      ? [...sample.captureLimitations]
      : [],
  };
}

function resolveErrorText(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0)
    return error.message.trim();
  return String(error ?? 'unknown_error').trim() || 'unknown_error';
}

function hasInteractiveDelta(
  prev: NativeSentinelSignalSample | null,
  next: NativeSentinelSignalSample,
): boolean {
  if (!prev) return true;
  const before = prev.signals ?? {};
  const after = next.signals ?? {};
  return (
    before.foreground !== after.foreground ||
    before.foregroundTitle !== after.foregroundTitle ||
    Boolean(before.audioActive) !== Boolean(after.audioActive) ||
    Boolean(before.rawInputActive) !== Boolean(after.rawInputActive) ||
    Boolean(before.gamepadActive) !== Boolean(after.gamepadActive) ||
    Boolean(before.fullscreen) !== Boolean(after.fullscreen)
  );
}

export class PsycheNativeSignalHub {
  private readonly collector: SignalHubCollector;
  private readonly sampleIntervalMs: number;
  private readonly burstIntervalMs: number;
  private readonly staleAfterMs: number;
  private readonly burstCyclesOnChange: number;
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;
  private sequence = 0;
  private sampledAtMs = 0;
  private consecutiveFailures = 0;
  private burstRemaining = 0;
  private lastError = '';
  private lastSample: NativeSentinelSignalSample | null = null;

  constructor(options?: {
    collector?: SignalHubCollector;
    sampleIntervalMs?: number;
    burstIntervalMs?: number;
    staleAfterMs?: number;
    burstCyclesOnChange?: number;
  }) {
    this.collector =
      options?.collector ?? (() => collectNativeSentinelSignals());
    this.sampleIntervalMs = normalizeDelay(
      options?.sampleIntervalMs ?? process.env.MIYA_PSYCHE_SIGNAL_SAMPLE_MS,
      1_200,
      200,
      20_000,
    );
    this.burstIntervalMs = normalizeDelay(
      options?.burstIntervalMs ?? process.env.MIYA_PSYCHE_SIGNAL_BURST_MS,
      280,
      80,
      5_000,
    );
    this.staleAfterMs = normalizeDelay(
      options?.staleAfterMs ?? process.env.MIYA_PSYCHE_SIGNAL_STALE_MS,
      4_500,
      this.sampleIntervalMs,
      30_000,
    );
    this.burstCyclesOnChange = normalizeDelay(
      options?.burstCyclesOnChange ??
        process.env.MIYA_PSYCHE_SIGNAL_BURST_CYCLES,
      3,
      0,
      12,
    );
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Bootstrap sampling is scheduled asynchronously so daemon.start() stays non-blocking
    // even when native collectors are slow on Windows.
    this.scheduleNext(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  readSnapshot(): NativeSentinelSignalSample {
    const ageMs = this.snapshotAgeMs();
    if (!this.lastSample || ageMs > this.staleAfterMs) {
      return this.sampleNow('on_demand');
    }
    return cloneSample(this.lastSample);
  }

  getStatus(): PsycheNativeSignalHubStatus {
    const ageMs = this.snapshotAgeMs();
    const sample = this.lastSample ? cloneSample(this.lastSample) : undefined;
    return {
      running: this.running,
      sequence: this.sequence,
      sampledAt: sample?.sampledAt,
      ageMs,
      stale: !sample || ageMs > this.staleAfterMs,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError || undefined,
      sampleIntervalMs: this.sampleIntervalMs,
      burstIntervalMs: this.burstIntervalMs,
      staleAfterMs: this.staleAfterMs,
      sample,
    };
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.sampleNow('timer');
        const nextDelay = this.resolveNextDelay();
        this.scheduleNext(nextDelay);
      },
      Math.max(60, delayMs),
    );
  }

  private resolveNextDelay(): number {
    if (this.burstRemaining > 0) {
      this.burstRemaining -= 1;
      return this.burstIntervalMs;
    }
    if (this.consecutiveFailures > 0) {
      const backoff =
        this.sampleIntervalMs * Math.min(5, this.consecutiveFailures + 1);
      return Math.max(this.sampleIntervalMs, backoff);
    }
    return this.sampleIntervalMs;
  }

  private snapshotAgeMs(): number {
    if (!this.sampledAtMs) return Number.POSITIVE_INFINITY;
    return Math.max(0, Date.now() - this.sampledAtMs);
  }

  private sampleNow(reason: string): NativeSentinelSignalSample {
    try {
      const raw = this.collector();
      const normalized: NativeSentinelSignalSample = {
        sampledAt: String(raw.sampledAt ?? nowIso()),
        signals:
          raw.signals && typeof raw.signals === 'object'
            ? { ...raw.signals }
            : {},
        captureLimitations: normalizeCaptureLimitations(
          Array.isArray(raw.captureLimitations) ? raw.captureLimitations : [],
        ),
      };
      const changed = hasInteractiveDelta(this.lastSample, normalized);
      this.lastSample = normalized;
      this.sampledAtMs = Date.now();
      this.sequence += 1;
      this.lastError = '';
      this.consecutiveFailures = 0;
      if (changed && this.burstCyclesOnChange > 0) {
        this.burstRemaining = Math.max(
          this.burstRemaining,
          this.burstCyclesOnChange,
        );
      }
      return cloneSample(normalized);
    } catch (error) {
      this.consecutiveFailures += 1;
      const errorText = resolveErrorText(error);
      this.lastError = `${reason}:${errorText}`;
      if (this.lastSample) {
        const recovered = cloneSample(this.lastSample);
        recovered.captureLimitations = normalizeCaptureLimitations([
          ...recovered.captureLimitations,
          `signal_hub_collect_failed:${errorText}`,
        ]);
        return recovered;
      }
      return {
        sampledAt: nowIso(),
        signals: {},
        captureLimitations: [`signal_hub_collect_failed:${errorText}`],
      };
    }
  }
}
