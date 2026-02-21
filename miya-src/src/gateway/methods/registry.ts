import type { SessionMethodDeps } from './sessions';
import { registerSessionMethods } from './sessions';

export function registerCoreSessionMethods(deps: SessionMethodDeps): void {
  registerSessionMethods(deps);
}
