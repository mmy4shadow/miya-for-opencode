export type MiyaConfigRisk = 'LOW' | 'MED' | 'HIGH';
export type MiyaConfigType =
  | 'boolean'
  | 'integer'
  | 'string'
  | 'enum'
  | 'object'
  | 'array';

export interface MiyaSettingEntry {
  key: string;
  type: MiyaConfigType;
  defaultValue: unknown;
  risk: MiyaConfigRisk;
  description: string;
  requiresEvidence: boolean;
  minimum?: number;
  maximum?: number;
  enumValues?: string[];
}

interface MiyaSettingEntryInput {
  key: string;
  type: MiyaConfigType;
  defaultValue: unknown;
  risk: MiyaConfigRisk;
  description: string;
  minimum?: number;
  maximum?: number;
  enumValues?: string[];
}

function entry(input: MiyaSettingEntryInput): MiyaSettingEntry {
  return {
    ...input,
    requiresEvidence: input.risk === 'HIGH',
  };
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function keySegments(key: string): string[] {
  return key
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function getNestedValue(root: unknown, key: string): unknown {
  if (!root || typeof root !== 'object') return undefined;
  const segments = keySegments(key);
  let current: unknown = root;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function setNestedValue(
  root: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const segments = keySegments(key);
  if (segments.length === 0) return;

  let current: Record<string, unknown> = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = current[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]] = value;
}

export const SETTINGS_REGISTRY: MiyaSettingEntry[] = [
  entry({
    key: 'ui.language',
    type: 'enum',
    enumValues: ['zh-CN'],
    defaultValue: 'zh-CN',
    risk: 'LOW',
    description: '控制台语言。',
  }),
  entry({
    key: 'ui.theme',
    type: 'enum',
    enumValues: ['dark', 'light', 'system'],
    defaultValue: 'dark',
    risk: 'LOW',
    description: '控制台主题。',
  }),
  entry({
    key: 'ui.dashboard.openOnStart',
    type: 'boolean',
    defaultValue: true,
    risk: 'LOW',
    description: '启动时自动打开控制台。',
  }),
  entry({
    key: 'ui.dashboard.dockAutoLaunch',
    type: 'boolean',
    defaultValue: true,
    risk: 'LOW',
    description: '启动时自动拉起 Windows Dock（默认开启，可通过设置关闭）。',
  }),
  entry({
    key: 'ui.dashboard.autoOpenCooldownMs',
    type: 'integer',
    minimum: 10000,
    maximum: 1440000,
    defaultValue: 120000,
    risk: 'LOW',
    description: '自动打开控制台的跨进程冷却时间（毫秒）。',
  }),
  entry({
    key: 'ui.dashboard.startPage',
    type: 'enum',
    enumValues: [
      'overview',
      'autopilot',
      'approvals',
      'intake',
      'runtime',
      'jobs',
      'skills',
      'killswitch',
    ],
    defaultValue: 'overview',
    risk: 'LOW',
    description: '控制台默认首页。',
  }),
  entry({
    key: 'ui.dashboard.refreshMs',
    type: 'integer',
    minimum: 200,
    maximum: 5000,
    defaultValue: 800,
    risk: 'LOW',
    description: '控制台自动刷新间隔（毫秒）。',
  }),

  entry({
    key: 'autopilot.enabled',
    type: 'boolean',
    defaultValue: true,
    risk: 'MED',
    description: '是否启用自动循环执行。',
  }),
  entry({
    key: 'autopilot.maxCycles',
    type: 'integer',
    minimum: 1,
    maximum: 20,
    defaultValue: 8,
    risk: 'MED',
    description: '单窗口最大循环轮次（进展驱动+上限约束）。',
  }),
  entry({
    key: 'autopilot.noInterruptChat',
    type: 'boolean',
    defaultValue: true,
    risk: 'MED',
    description: '自动执行时尽量不打断主对话。',
  }),
  entry({
    key: 'autopilot.stallDetection.enabled',
    type: 'boolean',
    defaultValue: true,
    risk: 'MED',
    description: '启用停滞检测。',
  }),
  entry({
    key: 'autopilot.stallDetection.maxNoImprovementCycles',
    type: 'integer',
    minimum: 1,
    maximum: 10,
    defaultValue: 3,
    risk: 'MED',
    description: '连续无改进轮次阈值。',
  }),
  entry({
    key: 'autopilot.iterationDoneRequired',
    type: 'boolean',
    defaultValue: true,
    risk: 'MED',
    description: '每轮必须写入迭代完成记录。',
  }),

  entry({
    key: 'approval.mode',
    type: 'enum',
    enumValues: ['self'],
    defaultValue: 'self',
    risk: 'MED',
    description: '审批模式。',
  }),
  entry({
    key: 'approval.requireEvidence',
    type: 'boolean',
    defaultValue: true,
    risk: 'MED',
    description: '是否强制证据链。',
  }),
  entry({
    key: 'approval.signers',
    type: 'object',
    defaultValue: {
      executor: true,
      verifier: true,
    },
    risk: 'MED',
    description: '审批签字人配置。',
  }),
  entry({
    key: 'approval.tier.default',
    type: 'enum',
    enumValues: ['LIGHT', 'STANDARD', 'THOROUGH'],
    defaultValue: 'STANDARD',
    risk: 'MED',
    description: '默认验证等级。',
  }),
  entry({
    key: 'approval.tier.irreversible',
    type: 'enum',
    enumValues: ['THOROUGH'],
    defaultValue: 'THOROUGH',
    risk: 'HIGH',
    description: '不可逆动作必须验证等级。',
  }),
  entry({
    key: 'approval.onDeny.activateKillSwitch',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '审批拒绝后是否触发急停。',
  }),

  entry({
    key: 'intake.enabled',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '信息闸门总开关。',
  }),
  entry({
    key: 'intake.triggers.configChange',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '配置变更是否强制触发信息闸门。',
  }),
  entry({
    key: 'intake.triggers.skillOrToolchainChange',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '新增/启用 skill 或工具链是否触发信息闸门。',
  }),
  entry({
    key: 'intake.triggers.highRiskAction',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '高风险动作前置学习是否触发信息闸门。',
  }),
  entry({
    key: 'intake.triggers.directiveContent',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '网页指令型内容是否触发信息闸门。',
  }),
  entry({
    key: 'intake.policy.autoWhitelistOnApprove',
    type: 'boolean',
    defaultValue: true,
    risk: 'MED',
    description: '审批同意后自动加入白名单。',
  }),
  entry({
    key: 'intake.policy.autoBlacklistOnReject',
    type: 'boolean',
    defaultValue: true,
    risk: 'MED',
    description: '审批拒绝后自动加入黑名单。',
  }),
  entry({
    key: 'intake.policy.defaultRejectScope',
    type: 'enum',
    enumValues: ['CONTENT_FINGERPRINT', 'PAGE', 'PATH_PREFIX', 'DOMAIN'],
    defaultValue: 'CONTENT_FINGERPRINT',
    risk: 'MED',
    description: '拒绝时默认加入黑名单的粒度。',
  }),
  entry({
    key: 'intake.policy.allowTrialRunOption',
    type: 'boolean',
    defaultValue: true,
    risk: 'MED',
    description: '审批选项中允许“仅试运行一次”。',
  }),
  entry({
    key: 'intake.stats.windowN',
    type: 'integer',
    minimum: 3,
    maximum: 50,
    defaultValue: 10,
    risk: 'MED',
    description: '来源统计滑动窗口大小 N（按审批事件）。',
  }),
  entry({
    key: 'intake.stats.hardDenyWhenUsefulLessThanRejected',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '当 U<R 时默认否决该来源。',
  }),
  entry({
    key: 'intake.stats.downrankThresholdRatioX100',
    type: 'integer',
    minimum: 100,
    maximum: 500,
    defaultValue: 150,
    risk: 'MED',
    description: '降权阈值比率（X100，默认 150 表示 1.5 倍）。',
  }),
  entry({
    key: 'intake.stats.downrankExplorePercent',
    type: 'integer',
    minimum: 0,
    maximum: 100,
    defaultValue: 30,
    risk: 'MED',
    description: '来源降权后探索概率百分比。',
  }),
  entry({
    key: 'intake.stats.sourceUnit',
    type: 'enum',
    enumValues: ['DOMAIN_PATH_PREFIX', 'DOMAIN', 'PATH_PREFIX'],
    defaultValue: 'DOMAIN_PATH_PREFIX',
    risk: 'MED',
    description: '来源统计单元。',
  }),

  entry({
    key: 'killswitch.active',
    type: 'boolean',
    defaultValue: false,
    risk: 'HIGH',
    description: '急停总开关状态。',
  }),
  entry({
    key: 'killswitch.lockdownOnHighRisk',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '高风险拒绝后进入锁定。',
  }),
  entry({
    key: 'killswitch.unlockPolicy',
    type: 'enum',
    enumValues: ['explicit'],
    defaultValue: 'explicit',
    risk: 'HIGH',
    description: '急停解锁策略。',
  }),
  entry({
    key: 'killswitch.stopTargets',
    type: 'object',
    defaultValue: {
      desktop: true,
      outbound: true,
      exec: true,
      browser: true,
      voice: false,
    },
    risk: 'HIGH',
    description: '急停需要停止的目标模块。',
  }),

  entry({
    key: 'gateway.bindHost',
    type: 'string',
    defaultValue: '127.0.0.1',
    risk: 'MED',
    description: 'Gateway 绑定地址。',
  }),
  entry({
    key: 'gateway.port',
    type: 'integer',
    minimum: 1024,
    maximum: 65535,
    defaultValue: 17321,
    risk: 'MED',
    description: 'Gateway 监听端口。',
  }),
  entry({
    key: 'gateway.baseUrl',
    type: 'string',
    defaultValue: 'http://127.0.0.1:17321',
    risk: 'MED',
    description: 'Gateway 基础 URL。',
  }),
  entry({
    key: 'gateway.wsPath',
    type: 'string',
    defaultValue: '/ws',
    risk: 'MED',
    description: 'Gateway WebSocket 路径。',
  }),
  entry({
    key: 'gateway.staticSpa.enabled',
    type: 'boolean',
    defaultValue: true,
    risk: 'MED',
    description: '是否启用静态网页控制台。',
  }),
  entry({
    key: 'gateway.auth.mode',
    type: 'enum',
    enumValues: ['localToken', 'none'],
    defaultValue: 'localToken',
    risk: 'HIGH',
    description: 'Gateway 鉴权模式。',
  }),

  entry({
    key: 'runtime.backpressure.max_in_flight',
    type: 'integer',
    minimum: 1,
    maximum: 128,
    defaultValue: 8,
    risk: 'MED',
    description: 'Gateway 最大并发执行数。',
  }),
  entry({
    key: 'runtime.backpressure.max_queued',
    type: 'integer',
    minimum: 1,
    maximum: 1024,
    defaultValue: 64,
    risk: 'MED',
    description: 'Gateway 最大排队请求数。',
  }),
  entry({
    key: 'runtime.backpressure.queue_timeout_ms',
    type: 'integer',
    minimum: 100,
    maximum: 120000,
    defaultValue: 15000,
    risk: 'MED',
    description: 'Gateway 排队超时时间（毫秒）。',
  }),
  entry({
    key: 'runtime.backpressure.daemon_max_pending_requests',
    type: 'integer',
    minimum: 4,
    maximum: 1024,
    defaultValue: 64,
    risk: 'MED',
    description: 'Daemon Launcher 最大挂起请求数。',
  }),
  entry({
    key: 'runtime.notifications.job_toast',
    type: 'boolean',
    defaultValue: true,
    risk: 'LOW',
    description: '任务完成/失败时是否推送 toast 通知。',
  }),
  entry({
    key: 'runtime.multimodal.test_mode',
    type: 'boolean',
    defaultValue: false,
    risk: 'LOW',
    description: '多模态单元测试模式（使用可追溯降级资产）。',
  }),
  entry({
    key: 'security.ownerCheck',
    type: 'boolean',
    defaultValue: false,
    risk: 'HIGH',
    description: '是否强制 Owner 模式校验（默认关闭以避免本机控制台陷入 owner_mode_required 循环）。',
  }),
  entry({
    key: 'security.voiceprint.strict',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '声纹校验严格模式开关。',
  }),

  entry({
    key: 'skills.enabled',
    type: 'boolean',
    defaultValue: true,
    risk: 'MED',
    description: '是否启用技能系统。',
  }),
  entry({
    key: 'skills.packages',
    type: 'array',
    defaultValue: [],
    risk: 'MED',
    description: '已启用技能包列表。',
  }),
  entry({
    key: 'skills.versionLock.enabled',
    type: 'boolean',
    defaultValue: true,
    risk: 'MED',
    description: '技能包版本锁定。',
  }),
  entry({
    key: 'skills.compat.openCodeNative',
    type: 'boolean',
    defaultValue: true,
    risk: 'LOW',
    description: '兼容 OpenCode 原生技能。',
  }),

  entry({
    key: 'desktop.enabled',
    type: 'boolean',
    defaultValue: false,
    risk: 'HIGH',
    description: '桌面自动化开关。',
  }),
  entry({
    key: 'desktop.preferUia',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '优先 UIA 自动化。',
  }),
  entry({
    key: 'desktop.requirePreSendScreenshotVerify',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '发送前截图核验。',
  }),
  entry({
    key: 'desktop.requirePostActionVerify',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '动作后状态核验。',
  }),
  entry({
    key: 'desktop.focusPolicy',
    type: 'enum',
    enumValues: ['strict', 'relaxed'],
    defaultValue: 'strict',
    risk: 'HIGH',
    description: '桌面焦点策略。',
  }),

  entry({
    key: 'outbound.enabled',
    type: 'boolean',
    defaultValue: false,
    risk: 'HIGH',
    description: '外发消息总开关。',
  }),
  entry({
    key: 'outbound.channels',
    type: 'object',
    defaultValue: {
      qq: true,
      wechat: true,
    },
    risk: 'HIGH',
    description: '外发渠道配置（仅 QQ/微信）。',
  }),
  entry({
    key: 'outbound.requireDraftInChat',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '外发前先在对话中生成草稿。',
  }),
  entry({
    key: 'outbound.requireVerifierSign',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '外发前强制 verifier 签字。',
  }),

  entry({
    key: 'voice.enabled',
    type: 'boolean',
    defaultValue: false,
    risk: 'HIGH',
    description: '语音能力总开关。',
  }),
  entry({
    key: 'voice.input.stt',
    type: 'enum',
    enumValues: ['local', 'off'],
    defaultValue: 'local',
    risk: 'MED',
    description: '语音输入 STT 模式。',
  }),
  entry({
    key: 'voice.output.tts',
    type: 'enum',
    enumValues: ['local', 'off'],
    defaultValue: 'local',
    risk: 'MED',
    description: '语音输出 TTS 模式。',
  }),
  entry({
    key: 'voice.wakeWord.enabled',
    type: 'boolean',
    defaultValue: false,
    risk: 'MED',
    description: '唤醒词开关。',
  }),
  entry({
    key: 'voice.oneShotMode',
    type: 'boolean',
    defaultValue: true,
    risk: 'MED',
    description: '一句话触发模式。',
  }),
  entry({
    key: 'voice.routeToChat',
    type: 'boolean',
    defaultValue: true,
    risk: 'MED',
    description: '语音输入统一写入会话。',
  }),

  entry({
    key: 'git.autoPush.enabled',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '自动推送开关。',
  }),
  entry({
    key: 'git.autoPush.remote',
    type: 'string',
    defaultValue: 'https://github.com/mmy4shadow/miya-for-opencode.git',
    risk: 'HIGH',
    description: '自动推送远端仓库。',
  }),
  entry({
    key: 'git.autoPush.branchPattern',
    type: 'string',
    defaultValue: 'refs/heads/miya/<session-id>',
    risk: 'HIGH',
    description: '自动推送分支策略。',
  }),
  entry({
    key: 'git.autoPush.maxFileSizeMB',
    type: 'integer',
    minimum: 1,
    maximum: 50,
    defaultValue: 2,
    risk: 'HIGH',
    description: '自动推送单文件大小上限。',
  }),
  entry({
    key: 'git.autoPush.blockWhenKillSwitchActive',
    type: 'boolean',
    defaultValue: true,
    risk: 'HIGH',
    description: '急停时阻断自动推送。',
  }),
  entry({
    key: 'git.autoPush.excludeGlobs',
    type: 'array',
    defaultValue: [
      '.opencode/**',
      '.venv/**',
      'node_modules/**',
      '**/*.pem',
      '**/*.key',
      '**/.env*',
    ],
    risk: 'HIGH',
    description: '自动推送排除列表。',
  }),
];

const REGISTRY_MAP = new Map(
  SETTINGS_REGISTRY.map((item) => [item.key, item] as const),
);

function leafSchema(entryValue: MiyaSettingEntry): Record<string, unknown> {
  if (entryValue.type === 'boolean') return { type: 'boolean' };
  if (entryValue.type === 'integer') {
    const schema: Record<string, unknown> = { type: 'integer' };
    if (typeof entryValue.minimum === 'number') schema.minimum = entryValue.minimum;
    if (typeof entryValue.maximum === 'number') schema.maximum = entryValue.maximum;
    return schema;
  }
  if (entryValue.type === 'string') return { type: 'string' };
  if (entryValue.type === 'enum') {
    return { type: 'string', enum: [...(entryValue.enumValues ?? [])] };
  }
  if (entryValue.type === 'array') return { type: 'array' };
  return { type: 'object' };
}

function setSchemaAtPath(
  root: Record<string, unknown>,
  key: string,
  schema: Record<string, unknown>,
): void {
  const segments = keySegments(key);
  if (segments.length === 0) return;

  let current = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const existing = current[segment];
    if (!existing || typeof existing !== 'object') {
      current[segment] = {
        type: 'object',
        additionalProperties: true,
        properties: {},
      };
    }
    const node = current[segment] as Record<string, unknown>;
    if (!node.properties || typeof node.properties !== 'object') {
      node.properties = {};
    }
    current = node.properties as Record<string, unknown>;
  }
  current[segments[segments.length - 1]] = schema;
}

export function getSettingEntry(key: string): MiyaSettingEntry | undefined {
  return REGISTRY_MAP.get(key);
}

export function listSettingEntries(): MiyaSettingEntry[] {
  return SETTINGS_REGISTRY.map((item) => cloneValue(item));
}

export function buildDefaultConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const item of SETTINGS_REGISTRY) {
    setNestedValue(config, item.key, cloneValue(item.defaultValue));
  }
  return config;
}

export function buildRegistryDocument(): Record<string, unknown> {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    settings: listSettingEntries(),
  };
}

export function buildSchemaDocument(): Record<string, unknown> {
  const rootProperties: Record<string, unknown> = {};
  for (const item of SETTINGS_REGISTRY) {
    setSchemaAtPath(rootProperties, item.key, leafSchema(item));
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Miya Config',
    type: 'object',
    additionalProperties: true,
    properties: rootProperties,
  };
}
