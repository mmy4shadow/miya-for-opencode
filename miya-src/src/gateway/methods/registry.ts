import { registerSessionMethods } from './sessions';
import type { SessionMethodDeps } from './sessions';

export function registerCoreSessionMethods(deps: SessionMethodDeps): void {
  registerSessionMethods(deps);
}
