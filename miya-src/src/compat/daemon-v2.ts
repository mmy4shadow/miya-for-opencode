const DAEMON_METHOD_ALIASES: Record<string, string> = {
  // Reserve explicit remaps here when future daemon methods are renamed.
};

export function resolveDaemonCompatMethod(method: string): string {
  const raw = String(method ?? '').trim();
  if (!raw) return raw;
  if (DAEMON_METHOD_ALIASES[raw]) {
    return DAEMON_METHOD_ALIASES[raw];
  }
  if (raw.startsWith('v2.')) {
    const legacy = raw.slice(3);
    return legacy.trim() || raw;
  }
  return raw;
}
