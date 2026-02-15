interface ContextGovernorConfig {
  enabled?: boolean;
  toolOutputMaxChars?: number;
  toolOutputHeadChars?: number;
  toolOutputTailChars?: number;
  recordTtlMs?: number;
  maxRecordsPerSession?: number;
  maxInjectedRecords?: number;
  maxInjectedChars?: number;
}

interface ToolExecuteAfterInput {
  tool: string;
  sessionID?: string;
}

interface ToolExecuteAfterOutput {
  output: string;
}

interface MessageInfo {
  role: string;
  agent?: string;
  sessionID?: string;
}

interface MessagePart {
  type: string;
  text?: string;
}

interface MessageWithParts {
  info: MessageInfo;
  parts: MessagePart[];
}

interface ToolRecord {
  id: string;
  tool: string;
  output: string;
  recordedAt: number;
  truncated: boolean;
  omittedChars: number;
  originalChars: number;
  references: number;
}

interface CreateHookOptions {
  now?: () => number;
}

const DEFAULTS = {
  enabled: true,
  toolOutputMaxChars: 12_000,
  toolOutputHeadChars: 4_200,
  toolOutputTailChars: 2_800,
  recordTtlMs: 12 * 60 * 1000,
  maxRecordsPerSession: 30,
  maxInjectedRecords: 3,
  maxInjectedChars: 2_400,
} as const;

const TOOL_GUIDANCE =
  'narrow scope with path/query/limit and rerun tool';

const store = new Map<string, ToolRecord[]>();

function normalizeSessionID(sessionID?: string): string {
  const value = String(sessionID ?? 'main').trim();
  return value.length > 0 ? value : 'main';
}

function normalizeToolName(tool: string): string {
  const normalized = String(tool ?? '').trim().toLowerCase();
  return normalized.length > 0 ? normalized : 'unknown';
}

function cleanSnippet(text: string, maxChars: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function sanitizeUserTerms(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9_\-\u4e00-\u9fff]+/i)
        .map((item) => item.trim())
        .filter((item) => item.length >= 3),
    ),
  );
}

function makeTruncatedOutput(
  tool: string,
  text: string,
  config: Required<ContextGovernorConfig>,
): {
  output: string;
  truncated: boolean;
  omittedChars: number;
  originalChars: number;
} {
  const normalized = String(text ?? '');
  const totalChars = normalized.length;
  if (totalChars <= config.toolOutputMaxChars) {
    return {
      output: normalized,
      truncated: false,
      omittedChars: 0,
      originalChars: totalChars,
    };
  }

  const head = normalized.slice(0, config.toolOutputHeadChars);
  const tail = normalized.slice(Math.max(0, totalChars - config.toolOutputTailChars));
  const omittedChars = Math.max(0, totalChars - head.length - tail.length);
  const marker =
    `\n\n...[MIYA_OUTPUT_TRUNCATED tool=${tool} omitted_chars=${omittedChars} total_chars=${totalChars}` +
    ` hint="${TOOL_GUIDANCE}"]...\n\n`;

  return {
    output: `${head}${marker}${tail}`,
    truncated: true,
    omittedChars,
    originalChars: totalChars,
  };
}

function pruneRecords(
  records: ToolRecord[],
  nowMs: number,
  config: Required<ContextGovernorConfig>,
): { records: ToolRecord[]; expired: number } {
  const nonExpired = records.filter(
    (record) => nowMs - record.recordedAt <= config.recordTtlMs,
  );
  const expired = records.length - nonExpired.length;
  const trimmed = nonExpired.slice(-config.maxRecordsPerSession);
  return { records: trimmed, expired };
}

function findLastUserTextPart(messages: MessageWithParts[]): {
  message: MessageWithParts;
  partIndex: number;
  sessionID: string;
} | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.info.role !== 'user') continue;
    const partIndex = message.parts.findIndex(
      (part) => part.type === 'text' && typeof part.text === 'string',
    );
    if (partIndex === -1) continue;
    return {
      message,
      partIndex,
      sessionID: normalizeSessionID(message.info.sessionID),
    };
  }
  return null;
}

function renderCompactContext(
  records: ToolRecord[],
  expired: number,
  terms: string[],
  nowMs: number,
  config: Required<ContextGovernorConfig>,
): string {
  if (records.length === 0) return '';

  const withScore = records.map((record) => {
    const ageMs = Math.max(0, nowMs - record.recordedAt);
    const recency = Math.max(0, 1 - ageMs / config.recordTtlMs);
    const overlap = terms.reduce((count, term) => {
      if (record.output.toLowerCase().includes(term)) return count + 1;
      if (record.tool.includes(term)) return count + 1;
      return count;
    }, 0);
    return {
      record,
      overlap,
      score: overlap * 2 + record.references * 0.5 + recency,
      ageMs,
    };
  });

  const ranked = withScore
    .sort((a, b) => b.score - a.score)
    .slice(0, config.maxInjectedRecords);

  for (const item of ranked) {
    if (item.overlap > 0) {
      item.record.references += 1;
    }
  }

  const lines: string[] = [];
  lines.push('[MIYA CONTEXT GOVERNOR]');
  lines.push(
    `Retained compact tool context: keep=${ranked.length} pool=${records.length} expired_pruned=${expired}.`,
  );
  lines.push('Use these snapshots instead of replaying long historical tool logs.');
  lines.push('');

  let usedChars = lines.join('\n').length;
  for (const item of ranked) {
    const ageSec = Math.floor(item.ageMs / 1000);
    const header =
      `- #${item.record.id} tool=${item.record.tool} age=${ageSec}s refs=${item.record.references}` +
      ` truncated=${item.record.truncated ? 'yes' : 'no'} chars=${item.record.originalChars}`;
    const snippet = `  snippet: ${cleanSnippet(item.record.output, 320)}`;
    const block = `${header}\n${snippet}`;
    if (usedChars + block.length > config.maxInjectedChars) break;
    lines.push(block);
    usedChars += block.length + 1;
  }

  return lines.join('\n');
}

function resolveConfig(
  input?: ContextGovernorConfig,
): Required<ContextGovernorConfig> {
  return {
    enabled: input?.enabled ?? DEFAULTS.enabled,
    toolOutputMaxChars: Math.max(
      1200,
      Number(input?.toolOutputMaxChars ?? DEFAULTS.toolOutputMaxChars),
    ),
    toolOutputHeadChars: Math.max(
      400,
      Number(input?.toolOutputHeadChars ?? DEFAULTS.toolOutputHeadChars),
    ),
    toolOutputTailChars: Math.max(
      200,
      Number(input?.toolOutputTailChars ?? DEFAULTS.toolOutputTailChars),
    ),
    recordTtlMs: Math.max(10_000, Number(input?.recordTtlMs ?? DEFAULTS.recordTtlMs)),
    maxRecordsPerSession: Math.max(
      5,
      Number(input?.maxRecordsPerSession ?? DEFAULTS.maxRecordsPerSession),
    ),
    maxInjectedRecords: Math.max(
      1,
      Number(input?.maxInjectedRecords ?? DEFAULTS.maxInjectedRecords),
    ),
    maxInjectedChars: Math.max(
      400,
      Number(input?.maxInjectedChars ?? DEFAULTS.maxInjectedChars),
    ),
  };
}

export function createContextGovernorHook(
  rawConfig?: ContextGovernorConfig,
  options?: CreateHookOptions,
) {
  const config = resolveConfig(rawConfig);
  const now = options?.now ?? (() => Date.now());
  let counter = 0;

  return {
    'tool.execute.after': async (
      input: ToolExecuteAfterInput,
      output: ToolExecuteAfterOutput,
    ): Promise<void> => {
      if (!config.enabled) return;
      const sessionID = normalizeSessionID(input.sessionID);
      const tool = normalizeToolName(input.tool);
      const snapshot = makeTruncatedOutput(tool, String(output.output ?? ''), config);
      output.output = snapshot.output;

      const record: ToolRecord = {
        id: `${now().toString(36)}-${(counter++).toString(36)}`,
        tool,
        output: cleanSnippet(snapshot.output, 1_000),
        recordedAt: now(),
        truncated: snapshot.truncated,
        omittedChars: snapshot.omittedChars,
        originalChars: snapshot.originalChars,
        references: 0,
      };

      const existing = store.get(sessionID) ?? [];
      const { records } = pruneRecords([...existing, record], now(), config);
      store.set(sessionID, records);
    },

    'experimental.chat.messages.transform': async (
      _input: Record<string, never>,
      output: { messages: MessageWithParts[] },
    ): Promise<void> => {
      if (!config.enabled) return;
      const target = findLastUserTextPart(output.messages);
      if (!target) return;

      const currentText = String(target.message.parts[target.partIndex].text ?? '');
      if (currentText.includes('[MIYA COMMAND BRIDGE]')) return;
      if (currentText.includes('[MIYA CONTEXT GOVERNOR]')) return;

      const sessionID = target.sessionID;
      const existing = store.get(sessionID);
      if (!existing || existing.length === 0) return;
      const nowMs = now();
      const { records, expired } = pruneRecords(existing, nowMs, config);
      store.set(sessionID, records);
      if (records.length === 0) return;

      const compact = renderCompactContext(
        records,
        expired,
        sanitizeUserTerms(currentText),
        nowMs,
        config,
      );
      if (!compact) return;

      target.message.parts[target.partIndex].text = `${compact}\n\n---\n\n${currentText}`;
    },
  };
}

