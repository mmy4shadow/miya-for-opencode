import { getSessionState, setSessionState } from '../workflow';

export function configureAutopilotSession(input: {
  projectDir: string;
  sessionID: string;
  maxCycles?: number;
  autoContinue?: boolean;
  strictQualityGate?: boolean;
  enabled: boolean;
}): ReturnType<typeof getSessionState> {
  const state = getSessionState(input.projectDir, input.sessionID);
  state.loopEnabled = input.enabled;
  if (typeof input.maxCycles === 'number') {
    state.maxIterationsPerWindow = Math.max(1, Math.min(20, Math.floor(input.maxCycles)));
  }
  if (typeof input.autoContinue === 'boolean') {
    state.autoContinue = input.autoContinue;
  }
  if (typeof input.strictQualityGate === 'boolean') {
    state.strictQualityGate = input.strictQualityGate;
  }
  setSessionState(input.projectDir, input.sessionID, state);
  return state;
}

