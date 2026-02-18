import type { GatewayMethodRegistry } from '../protocol';

function registerDomainMethods(
  methods: GatewayMethodRegistry,
  domain: string,
  prefixes: readonly string[],
  register: (methods: GatewayMethodRegistry) => void,
): void {
  const before = new Set(methods.list());
  register(methods);
  const added = methods.list().filter((method) => !before.has(method));
  if (added.length === 0) {
    throw new Error(`gateway_domain_registration_empty:${domain}`);
  }
  const invalid = added.filter(
    (method) => !prefixes.some((prefix) => method.startsWith(prefix)),
  );
  if (invalid.length > 0) {
    throw new Error(
      `gateway_domain_registration_invalid:${domain}:${invalid.join(',')}`,
    );
  }
}

export function registerGatewayMemoryMethods(
  methods: GatewayMethodRegistry,
  register: (methods: GatewayMethodRegistry) => void,
): void {
  registerDomainMethods(
    methods,
    'memory',
    ['companion.memory.', 'companion.learning.', 'miya.memory.'],
    register,
  );
}
