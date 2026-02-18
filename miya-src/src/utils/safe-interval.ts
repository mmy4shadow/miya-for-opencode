export interface SafeIntervalOptions {
  cooldownMs?: number;
  maxConsecutiveErrors?: number;
  onError?: (input: {
    taskName: string;
    error: unknown;
    consecutiveErrors: number;
    cooldownUntilMs?: number;
  }) => void;
}

export function safeInterval(
  taskName: string,
  intervalMs: number,
  run: () => void | Promise<void>,
  options?: SafeIntervalOptions,
): ReturnType<typeof setInterval> {
  const maxConsecutiveErrors = Math.max(
    1,
    Math.floor(options?.maxConsecutiveErrors ?? 3),
  );
  const cooldownMs = Math.max(1_000, Math.floor(options?.cooldownMs ?? 30_000));
  let running = false;
  let consecutiveErrors = 0;
  let cooldownUntilMs = 0;

  return setInterval(
    () => {
      if (running) return;
      if (Date.now() < cooldownUntilMs) return;
      running = true;
      Promise.resolve(run())
        .then(() => {
          consecutiveErrors = 0;
        })
        .catch((error) => {
          consecutiveErrors += 1;
          if (consecutiveErrors >= maxConsecutiveErrors) {
            cooldownUntilMs = Date.now() + cooldownMs;
            consecutiveErrors = 0;
          }
          options?.onError?.({
            taskName,
            error,
            consecutiveErrors: Math.max(1, consecutiveErrors),
            cooldownUntilMs:
              cooldownUntilMs > Date.now() ? cooldownUntilMs : undefined,
          });
        })
        .finally(() => {
          running = false;
        });
    },
    Math.max(10, Math.floor(intervalMs)),
  );
}
