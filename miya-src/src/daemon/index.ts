import { MiyaDaemonService } from './service';
import type {
  DaemonJobRecord,
  DaemonJobRequest,
  DaemonJobStatus,
  DaemonRunResult,
  DaemonRuntimeState,
} from './types';

const daemons = new Map<string, MiyaDaemonService>();

export function getMiyaDaemonService(projectDir: string): MiyaDaemonService {
  const existing = daemons.get(projectDir);
  if (existing) return existing;
  const created = new MiyaDaemonService(projectDir);
  daemons.set(projectDir, created);
  return created;
}

export {
  MiyaDaemonService,
};

export type {
  DaemonJobRecord,
  DaemonJobRequest,
  DaemonJobStatus,
  DaemonRunResult,
  DaemonRuntimeState,
};
