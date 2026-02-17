import type { GatewayMethodRegistry } from '../gateway/protocol';

export interface GatewayV2AliasReport {
  scanned: number;
  created: number;
  skipped: number;
  aliases: Array<{ alias: string; target: string }>;
}

function toV2Alias(method: string): string {
  return method.startsWith('v2.') ? method : `v2.${method}`;
}

export function registerGatewayV2Aliases(methods: GatewayMethodRegistry): GatewayV2AliasReport {
  const targets = methods
    .list()
    .filter((method) => method.trim().length > 0)
    .filter((method) => !method.startsWith('v2.'));

  const aliases: Array<{ alias: string; target: string }> = [];
  let created = 0;
  let skipped = 0;

  for (const target of targets) {
    const alias = toV2Alias(target);
    const ok = methods.registerAlias(alias, target);
    if (!ok) {
      skipped += 1;
      continue;
    }
    aliases.push({ alias, target });
    created += 1;
  }

  return {
    scanned: targets.length,
    created,
    skipped,
    aliases,
  };
}
