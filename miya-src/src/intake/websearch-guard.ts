import { proposeIntake } from './service';

interface WebsearchSessionState {
  lastSeenAt: number;
  lastUrl?: string;
  pendingProposalId?: string;
}

export interface PermissionAskForIntakeGate {
  sessionID: string;
  permission: string;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const WRITE_PERMISSIONS = new Set([
  'edit',
  'write',
  'bash',
  'external_directory',
]);
const state = new Map<string, WebsearchSessionState>();

function normalizeSessionID(sessionID?: string): string {
  const raw = (sessionID ?? 'main').trim();
  return raw.length > 0 ? raw : 'main';
}

function isWebsearchTool(tool: string): boolean {
  const value = tool.trim().toLowerCase();
  return value.includes('websearch') || value.includes('web_search_exa');
}

function extractFirstUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s)\]}>"']+/i);
  return match ? match[0] : undefined;
}

function parseSource(url: string | undefined): {
  domain?: string;
  path?: string;
  url?: string;
} {
  if (!url) return { url: undefined };
  try {
    const parsed = new URL(url);
    return {
      domain: parsed.hostname,
      path: parsed.pathname || '/',
      url,
    };
  } catch {
    return { url };
  }
}

export function trackWebsearchToolOutput(
  sessionID: string | undefined,
  tool: string,
  outputText: string,
): void {
  if (!isWebsearchTool(tool)) return;
  const key = normalizeSessionID(sessionID);
  const now = Date.now();
  state.set(key, {
    ...state.get(key),
    lastSeenAt: now,
    lastUrl: extractFirstUrl(outputText) ?? state.get(key)?.lastUrl,
  });
}

export function shouldInterceptWriteAfterWebsearch(
  projectDir: string,
  input: PermissionAskForIntakeGate,
): { intercept: boolean; reason: string; proposalID?: string } {
  const permission = String(input.permission ?? '').trim();
  if (!WRITE_PERMISSIONS.has(permission)) {
    return { intercept: false, reason: 'permission_not_write' };
  }

  const key = normalizeSessionID(input.sessionID);
  const session = state.get(key);
  if (!session) return { intercept: false, reason: 'no_websearch_context' };

  const now = Date.now();
  if (now - session.lastSeenAt > SESSION_TTL_MS) {
    state.delete(key);
    return { intercept: false, reason: 'websearch_context_expired' };
  }

  if (session.pendingProposalId) {
    return {
      intercept: true,
      reason: 'pending_intake_proposal_exists',
      proposalID: session.pendingProposalId,
    };
  }

  const source = parseSource(session.lastUrl);
  const proposal = proposeIntake(projectDir, {
    trigger: 'directive_content',
    source: {
      ...source,
      sourceKey: 'mcp:websearch',
    },
    summaryPoints: [
      'WebSearch结果刚被引入当前会话',
      `即将执行写入权限: ${permission}`,
      '触发基础版Intake Gate拦截',
    ],
    originalPlan: '基于外部网页检索结果直接执行代码/文件改动',
    suggestedChange: '先审查来源与证据，再执行写入',
    benefits: ['降低提示注入与错误资料导致的写入风险'],
    risks: ['若直接写入可能引入不可靠外部内容'],
    evidence: session.lastUrl ? [session.lastUrl] : ['source=mcp:websearch'],
  });

  if (proposal.status === 'pending') {
    state.set(key, {
      ...session,
      pendingProposalId: proposal.proposal?.id,
    });
    return {
      intercept: true,
      reason: 'pending_intake_proposal_created',
      proposalID: proposal.proposal?.id,
    };
  }

  if (proposal.status === 'auto_rejected') {
    state.set(key, {
      ...session,
      pendingProposalId: proposal.proposal?.id,
    });
    return {
      intercept: true,
      reason: 'auto_rejected_by_intake_rule',
      proposalID: proposal.proposal?.id,
    };
  }

  return { intercept: false, reason: proposal.status };
}
