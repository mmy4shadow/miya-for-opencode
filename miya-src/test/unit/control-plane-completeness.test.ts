import { describe, expect, test } from 'bun:test';
import {
  ensureGatewayRunning,
  stopGateway,
} from '../../src/gateway/index';
import { createGatewayAcceptanceProjectDir } from '../../src/gateway/test-helpers';

describe('control plane completeness snapshot', () => {
  test('exposes all user-facing workflow surfaces required by audit dimensions', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    try {
      const response = await fetch(`${state.url}/api/status`);
      expect(response.ok).toBe(true);
      const snapshot = (await response.json()) as Record<string, unknown>;

      // 1) User workflow completeness
      expect(snapshot).toHaveProperty('sessions');
      expect(snapshot).toHaveProperty('jobs');
      expect(snapshot).toHaveProperty('channels');

      // 2) Error recovery path completeness
      expect(snapshot).toHaveProperty('doctor.issues');

      // 3) UI feedback loop completeness (status + safety/runtime hints)
      expect(snapshot).toHaveProperty('gateway.status');
      expect(snapshot).toHaveProperty('killSwitch.active');

      // 4) Configuration discoverability
      expect(snapshot).toHaveProperty('configCenter');
      expect(snapshot).toHaveProperty('policyHash');

      // 5) Permission request clarity
      expect(snapshot).toHaveProperty('nexus.pendingTickets');

      // 6) Memory management UI
      expect(snapshot).toHaveProperty('companion');

      // 7) Training progress visibility
      expect(snapshot).toHaveProperty('daemon');
      expect(snapshot).toHaveProperty('nexus.psycheTraining');

      // 8) Desktop control transparency
      expect(snapshot).toHaveProperty('channels.recentOutbound');

      // 9) Skill management UX
      expect(snapshot).toHaveProperty('skills.enabled');
      expect(snapshot).toHaveProperty('skills.discovered');

      // 10) Audit trail UI
      expect(snapshot).toHaveProperty('safety.recentSelfApproval');
      expect(snapshot).toHaveProperty('channels.recentOutbound');
    } finally {
      stopGateway(projectDir);
    }
  });
});

