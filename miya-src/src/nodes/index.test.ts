import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  classifyNodeCapabilities,
  createInvokeRequest,
  createNodePairRequest,
  issueNodeToken,
  listInvokeRequests,
  listNodePairs,
  mapNodePermissions,
  markInvokeSent,
  registerNode,
  resolveInvokeResult,
  resolveNodePair,
  summarizeNodeGovernance,
} from './index';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-nodes-test-'));
}

describe('nodes store', () => {
  test('supports node pairing flow', () => {
    const projectDir = tempProjectDir();

    registerNode(projectDir, {
      nodeID: 'node-1',
      deviceID: 'device-1',
      platform: 'linux',
      capabilities: ['system.run'],
    });

    const pair = createNodePairRequest(projectDir, {
      nodeID: 'node-1',
      deviceID: 'device-1',
    });

    expect(listNodePairs(projectDir, 'pending').length).toBe(1);
    const approved = resolveNodePair(projectDir, pair.id, 'approved');
    expect(approved?.status).toBe('approved');
    expect(listNodePairs(projectDir, 'pending').length).toBe(0);
  });

  test('tracks invoke request lifecycle', () => {
    const projectDir = tempProjectDir();

    registerNode(projectDir, {
      nodeID: 'node-2',
      deviceID: 'device-2',
      platform: 'win32',
      capabilities: ['system.info'],
    });

    const invoke = createInvokeRequest(projectDir, {
      nodeID: 'node-2',
      capability: 'system.info',
      args: { foo: 'bar' },
    });
    expect(invoke.status).toBe('pending');

    const sent = markInvokeSent(projectDir, invoke.id);
    expect(sent?.status).toBe('sent');

    const done = resolveInvokeResult(projectDir, invoke.id, {
      ok: true,
      result: { version: '1.0.0' },
    });
    expect(done?.status).toBe('completed');

    const all = listInvokeRequests(projectDir, 10);
    expect(all[0]?.id).toBe(invoke.id);
  });

  test('enforces node token after issue', () => {
    const projectDir = tempProjectDir();
    registerNode(projectDir, {
      nodeID: 'node-secure',
      deviceID: 'device-secure',
      platform: 'linux',
      capabilities: ['system.info'],
    });

    const issued = issueNodeToken(projectDir, 'node-secure');
    expect(issued).not.toBeNull();
    if (!issued) return;

    expect(() =>
      registerNode(projectDir, {
        nodeID: 'node-secure',
        deviceID: 'device-secure',
        platform: 'linux',
        capabilities: ['system.info'],
      }),
    ).toThrow(/node_token_invalid/);

    const ok = registerNode(projectDir, {
      nodeID: 'node-secure',
      deviceID: 'device-secure',
      platform: 'linux',
      token: issued.token,
      capabilities: ['system.info'],
    });
    expect(ok.connected).toBe(true);
    expect(ok.status).toBe('online');
  });

  test('maps node permissions into governance profile', () => {
    const projectDir = tempProjectDir();
    const node = registerNode(projectDir, {
      nodeID: 'node-governance',
      deviceID: 'device-governance',
      type: 'desktop',
      platform: 'win32',
      capabilities: ['system.run', 'perm.screenRecording', 'perm.accessibility', 'perm.filesystem.full', 'perm.network'],
      permissions: {
        screenRecording: true,
        accessibility: true,
        filesystem: 'full',
        network: true,
      },
    });
    const profile = mapNodePermissions(node);
    expect(profile.bash).toBe('ask');
    expect(profile.edit).toBe('ask');
    expect(profile.desktopControl).toBe('ask');
    expect(profile.riskLevel).toBe('HIGH');
  });

  test('classifies capabilities and summarizes governance', () => {
    const projectDir = tempProjectDir();
    const secure = registerNode(projectDir, {
      nodeID: 'node-secure-1',
      deviceID: 'device-secure-1',
      type: 'desktop',
      platform: 'win32',
      capabilities: ['system.info', 'system.run', 'perm.filesystem.full', 'perm.network', 'perm.screenRecording', 'perm.accessibility'],
      permissions: {
        screenRecording: true,
        accessibility: true,
        filesystem: 'full',
        network: true,
      },
    });
    const pair = createNodePairRequest(projectDir, {
      nodeID: secure.nodeID,
      deviceID: secure.deviceID,
    });
    resolveNodePair(projectDir, pair.id, 'approved');
    registerNode(projectDir, {
      nodeID: secure.nodeID,
      deviceID: secure.deviceID,
      type: 'desktop',
      platform: 'win32',
      capabilities: secure.capabilities,
      permissions: secure.permissions,
    });

    const passive = registerNode(projectDir, {
      nodeID: 'node-passive',
      deviceID: 'device-passive',
      type: 'cli',
      platform: 'linux',
      capabilities: ['system.info'],
    });
    const groups = classifyNodeCapabilities(passive.capabilities);
    expect(groups.readOnly.includes('system.info')).toBe(true);

    const summary = summarizeNodeGovernance(
      [registerNode(projectDir, {
        nodeID: secure.nodeID,
        deviceID: secure.deviceID,
        type: 'desktop',
        platform: 'win32',
        capabilities: secure.capabilities,
        permissions: secure.permissions,
      }), passive],
      listNodePairs(projectDir, 'pending').length,
    );
    expect(summary.total).toBe(2);
    expect(summary.permissionCoverage.bashAllow).toBe(1);
    expect(summary.risk.high + summary.risk.medium + summary.risk.low).toBe(2);
  });
});
