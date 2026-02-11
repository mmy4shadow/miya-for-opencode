import type { PluginInput } from '@opencode-ai/plugin';
import { type SafetyTier } from './tier';

export interface VerifierInput {
  sessionID: string;
  traceID: string;
  requestHash: string;
  tier: SafetyTier;
  action: string;
  checks: string[];
  evidence: string[];
  issues: string[];
}

export interface VerifierResult {
  verdict: 'allow' | 'deny';
  summary: string;
  raw: string;
}

function extractText(parts: Array<{ type?: string; text?: string }>): string {
  return parts
    .filter((part) => typeof part.text === 'string')
    .map((part) => String(part.text))
    .join('\n')
    .trim();
}

function parseVerdict(text: string): VerifierResult {
  const allow = /\bVERDICT:\s*ALLOW\b/i.test(text);
  const deny = /\bVERDICT:\s*DENY\b/i.test(text);
  const summaryMatch = /REASON:\s*([^\n]+)/i.exec(text);
  if (allow && !deny) {
    return {
      verdict: 'allow',
      summary: summaryMatch?.[1]?.trim() ?? 'Verifier allowed action.',
      raw: text,
    };
  }
  return {
    verdict: 'deny',
    summary: summaryMatch?.[1]?.trim() ?? 'Verifier denied action.',
    raw: text,
  };
}

export async function runVerifier(
  ctx: PluginInput,
  input: VerifierInput,
): Promise<VerifierResult> {
  const prompt = [
    'You are the safety verifier.',
    'Do not call tools. Text response only.',
    'Reject if evidence is insufficient or issues are non-empty.',
    '',
    `trace_id=${input.traceID}`,
    `request_hash=${input.requestHash}`,
    `tier=${input.tier}`,
    `action=${input.action}`,
    '',
    'checks:',
    ...input.checks.map((check) => `- ${check}`),
    '',
    'issues:',
    ...(input.issues.length > 0
      ? input.issues.map((issue) => `- ${issue}`)
      : ['- none']),
    '',
    'evidence:',
    ...input.evidence.slice(0, 20).map((item) => `- ${item}`),
    '',
    'Respond in exact format:',
    'VERDICT: ALLOW|DENY',
    'REASON: <single sentence>',
  ].join('\n');

  try {
    const response = await ctx.client.session.prompt({
      path: { id: input.sessionID },
      body: {
        agent: '4-architecture-advisor',
        parts: [{ type: 'text', text: prompt }],
      },
      query: { directory: ctx.directory },
    });
    const text = extractText(
      ((response as { data?: { parts?: Array<{ type?: string; text?: string }> } }).data
        ?.parts ?? []) as Array<{ type?: string; text?: string }>,
    );
    if (!text) {
      return {
        verdict: 'deny',
        summary: 'Verifier returned empty response.',
        raw: '',
      };
    }
    return parseVerdict(text);
  } catch (error) {
    return {
      verdict: 'deny',
      summary: error instanceof Error ? error.message : String(error),
      raw: '',
    };
  }
}
