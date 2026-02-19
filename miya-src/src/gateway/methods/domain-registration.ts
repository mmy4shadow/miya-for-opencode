import type { GatewayMethodRegistry } from '../protocol';

export function registerGatewayDomainMethods(
  methods: GatewayMethodRegistry,
  domain: string,
  prefixes: readonly string[],
  register: (methods: GatewayMethodRegistry) => void,
): void {
  const beforeHandlers = new Map(
    methods.list().map((method) => [method, methods.handlerOf(method)]),
  );
  const before = new Set(methods.list());
  register(methods);
  const overridden = [...beforeHandlers.entries()]
    .filter(([method, handler]) => methods.handlerOf(method) !== handler)
    .map(([method]) => method);
  if (overridden.length > 0) {
    throw new Error(
      `gateway_domain_registration_override:${domain}:${overridden.join(',')}`,
    );
  }
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
