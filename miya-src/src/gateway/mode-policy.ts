export interface ModePolicyFreezeV1 {
  version: '2026-02-16.mode-policy.v1';
  unresolvedFallbackMode: 'work';
  workExecutionPersona: 'zero';
  workExecutionAddressing: 'strip_all';
  notes: string[];
}

export const MODE_POLICY_FREEZE_V1: ModePolicyFreezeV1 = {
  version: '2026-02-16.mode-policy.v1',
  unresolvedFallbackMode: 'work',
  workExecutionPersona: 'zero',
  workExecutionAddressing: 'strip_all',
  notes: [
    'Uncertain mode classification must fallback to work.',
    'Work execution track must remain zero-persona.',
    'Work context must strip affectionate addressing and roleplay tokens.',
  ],
};

const WORK_AFFECTIONATE_PREFIX =
  /^(?:\s*)(?:亲爱(?:的)?|宝贝|老婆|老公|dear|honey|sweetie|darling)[,，!！:：\s-]*/i;

export function stripWorkAffectionatePrefix(text: string): {
  text: string;
  stripped: boolean;
} {
  const next = text.replace(WORK_AFFECTIONATE_PREFIX, '');
  return {
    text: next,
    stripped: next !== text,
  };
}

