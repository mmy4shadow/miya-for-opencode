import type { BackgroundTaskManager } from '../../background';
import { handleAutoflowPersistentEvent } from '../../autoflow';

interface PersistentAutoflowEventInput {
  type?: string;
  properties?: {
    sessionID?: string;
    stopIntent?: { token?: string; source?: string };
    status?: { type?: string; reason?: string; source?: string };
    reason?: string;
    source?: string;
  };
}

export function createPersistentAutoflowHook(
  projectDir: string,
  manager: BackgroundTaskManager,
) {
  return {
    onEvent: async (event: PersistentAutoflowEventInput) => {
      return handleAutoflowPersistentEvent({
        projectDir,
        manager,
        event,
      });
    },
  };
}
