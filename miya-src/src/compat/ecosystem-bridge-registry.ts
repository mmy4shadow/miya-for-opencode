export interface EcosystemBridgeEntry {
  id: string;
  name: string;
  repository: string;
  integrationMode: 'reference' | 'adapter' | 'skill-pack' | 'runtime-link';
  versionPolicy: {
    pinRequired: boolean;
    updateCadence: 'manual' | 'scheduled';
  };
  compatibilityMatrix: {
    minMiyaVersion: string;
    minOpenCodeVersion: string;
    platforms: Array<'windows' | 'linux' | 'macos'>;
  };
  permissionMetadata: {
    sideEffects: string[];
    requiredDomains: string[];
  };
  rollbackPlan: {
    strategy: 'disable_entry' | 'rollback_adapter' | 'pin_previous';
    steps: string[];
  };
  auditFields: string[];
  tags: string[];
}

const AUDIT_FIELDS = [
  'source',
  'version',
  'policyHash',
  'capabilityID',
  'timestamp',
  'operator',
  'result',
];

const DEFAULT_ROLLBACK: EcosystemBridgeEntry['rollbackPlan'] = {
  strategy: 'disable_entry',
  steps: [
    'disable ecosystem entry in registry',
    're-run smoke regression suite',
    'restore previous pinned version',
  ],
};

const ECOSYSTEM_BRIDGE_ENTRIES: EcosystemBridgeEntry[] = [
  {
    id: 'opensouls',
    name: 'OpenSouls',
    repository: 'https://github.com/opensouls/opensouls.git',
    integrationMode: 'reference',
    versionPolicy: { pinRequired: true, updateCadence: 'manual' },
    compatibilityMatrix: {
      minMiyaVersion: '0.7.0',
      minOpenCodeVersion: '1.1.56',
      platforms: ['windows', 'linux', 'macos'],
    },
    permissionMetadata: {
      sideEffects: ['memory_write'],
      requiredDomains: ['memory_write'],
    },
    rollbackPlan: DEFAULT_ROLLBACK,
    auditFields: AUDIT_FIELDS,
    tags: ['memory', 'agent-runtime'],
  },
  {
    id: 'letta',
    name: 'Letta',
    repository: 'https://github.com/letta-ai/letta.git',
    integrationMode: 'reference',
    versionPolicy: { pinRequired: true, updateCadence: 'manual' },
    compatibilityMatrix: {
      minMiyaVersion: '0.7.0',
      minOpenCodeVersion: '1.1.56',
      platforms: ['windows', 'linux', 'macos'],
    },
    permissionMetadata: {
      sideEffects: ['memory_write'],
      requiredDomains: ['memory_write'],
    },
    rollbackPlan: DEFAULT_ROLLBACK,
    auditFields: AUDIT_FIELDS,
    tags: ['memory', 'agent'],
  },
  {
    id: 'openhands',
    name: 'OpenHands',
    repository: 'https://github.com/OpenHands/OpenHands.git',
    integrationMode: 'reference',
    versionPolicy: { pinRequired: true, updateCadence: 'manual' },
    compatibilityMatrix: {
      minMiyaVersion: '0.7.0',
      minOpenCodeVersion: '1.1.56',
      platforms: ['windows', 'linux', 'macos'],
    },
    permissionMetadata: {
      sideEffects: ['local_build', 'fs_write'],
      requiredDomains: ['local_build', 'fs_write'],
    },
    rollbackPlan: DEFAULT_ROLLBACK,
    auditFields: AUDIT_FIELDS,
    tags: ['autonomy', 'coding-agent'],
  },
  {
    id: 'open-llm-vtuber',
    name: 'Open-LLM-VTuber',
    repository: 'https://github.com/Open-LLM-VTuber/Open-LLM-VTuber.git',
    integrationMode: 'reference',
    versionPolicy: { pinRequired: true, updateCadence: 'manual' },
    compatibilityMatrix: {
      minMiyaVersion: '0.7.0',
      minOpenCodeVersion: '1.1.56',
      platforms: ['windows', 'linux', 'macos'],
    },
    permissionMetadata: {
      sideEffects: ['voice_output', 'media_generation'],
      requiredDomains: ['memory_write'],
    },
    rollbackPlan: DEFAULT_ROLLBACK,
    auditFields: AUDIT_FIELDS,
    tags: ['companion', 'voice', 'avatar'],
  },
  {
    id: 'mem0',
    name: 'Mem0',
    repository: 'https://github.com/mem0ai/mem0.git',
    integrationMode: 'reference',
    versionPolicy: { pinRequired: true, updateCadence: 'manual' },
    compatibilityMatrix: {
      minMiyaVersion: '0.7.0',
      minOpenCodeVersion: '1.1.56',
      platforms: ['windows', 'linux', 'macos'],
    },
    permissionMetadata: {
      sideEffects: ['memory_write'],
      requiredDomains: ['memory_write'],
    },
    rollbackPlan: DEFAULT_ROLLBACK,
    auditFields: AUDIT_FIELDS,
    tags: ['memory', 'retrieval'],
  },
  {
    id: 'sillytavern',
    name: 'SillyTavern',
    repository: 'https://github.com/SillyTavern/SillyTavern.git',
    integrationMode: 'reference',
    versionPolicy: { pinRequired: true, updateCadence: 'manual' },
    compatibilityMatrix: {
      minMiyaVersion: '0.7.0',
      minOpenCodeVersion: '1.1.56',
      platforms: ['windows', 'linux', 'macos'],
    },
    permissionMetadata: {
      sideEffects: ['memory_write', 'voice_output'],
      requiredDomains: ['memory_write'],
    },
    rollbackPlan: DEFAULT_ROLLBACK,
    auditFields: AUDIT_FIELDS,
    tags: ['companion', 'persona'],
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    repository: 'https://github.com/openclaw/openclaw.git',
    integrationMode: 'adapter',
    versionPolicy: { pinRequired: true, updateCadence: 'scheduled' },
    compatibilityMatrix: {
      minMiyaVersion: '0.7.0',
      minOpenCodeVersion: '1.1.56',
      platforms: ['windows', 'linux', 'macos'],
    },
    permissionMetadata: {
      sideEffects: ['channel_send', 'desktop_control'],
      requiredDomains: ['outbound_send', 'desktop_control'],
    },
    rollbackPlan: {
      strategy: 'rollback_adapter',
      steps: [
        'disable openclaw adapter routes',
        'switch to direct gateway methods',
        'restore previous adapter pin',
      ],
    },
    auditFields: AUDIT_FIELDS,
    tags: ['skills', 'ecosystem', 'adapter'],
  },
  {
    id: 'oh-my-claudecode',
    name: 'oh-my-claudecode',
    repository: 'https://github.com/Yeachan-Heo/oh-my-claudecode.git',
    integrationMode: 'skill-pack',
    versionPolicy: { pinRequired: true, updateCadence: 'scheduled' },
    compatibilityMatrix: {
      minMiyaVersion: '0.7.0',
      minOpenCodeVersion: '1.1.56',
      platforms: ['windows', 'linux', 'macos'],
    },
    permissionMetadata: {
      sideEffects: ['local_build'],
      requiredDomains: ['local_build'],
    },
    rollbackPlan: DEFAULT_ROLLBACK,
    auditFields: AUDIT_FIELDS,
    tags: ['workflow', 'autonomy'],
  },
  {
    id: 'clawra',
    name: 'Clawra',
    repository: 'https://github.com/SumeLabs/clawra.git',
    integrationMode: 'reference',
    versionPolicy: { pinRequired: true, updateCadence: 'manual' },
    compatibilityMatrix: {
      minMiyaVersion: '0.7.0',
      minOpenCodeVersion: '1.1.56',
      platforms: ['windows', 'linux', 'macos'],
    },
    permissionMetadata: {
      sideEffects: ['memory_write', 'voice_output'],
      requiredDomains: ['memory_write'],
    },
    rollbackPlan: DEFAULT_ROLLBACK,
    auditFields: AUDIT_FIELDS,
    tags: ['persona', 'companion'],
  },
  {
    id: 'openclaw-girl-agent',
    name: 'OpenClaw AI Girlfriend by Clawra',
    repository:
      'https://github.com/openclaw-girl-agent/openclaw-ai-girlfriend-by-clawra.git',
    integrationMode: 'reference',
    versionPolicy: { pinRequired: true, updateCadence: 'manual' },
    compatibilityMatrix: {
      minMiyaVersion: '0.7.0',
      minOpenCodeVersion: '1.1.56',
      platforms: ['windows', 'linux', 'macos'],
    },
    permissionMetadata: {
      sideEffects: ['memory_write', 'voice_output'],
      requiredDomains: ['memory_write'],
    },
    rollbackPlan: DEFAULT_ROLLBACK,
    auditFields: AUDIT_FIELDS,
    tags: ['companion', 'persona'],
  },
  {
    id: 'oh-my-opencode',
    name: 'oh-my-opencode',
    repository: 'https://github.com/code-yeongyu/oh-my-opencode.git',
    integrationMode: 'skill-pack',
    versionPolicy: { pinRequired: true, updateCadence: 'scheduled' },
    compatibilityMatrix: {
      minMiyaVersion: '0.7.0',
      minOpenCodeVersion: '1.1.56',
      platforms: ['windows', 'linux', 'macos'],
    },
    permissionMetadata: {
      sideEffects: ['local_build', 'fs_write'],
      requiredDomains: ['local_build', 'fs_write'],
    },
    rollbackPlan: DEFAULT_ROLLBACK,
    auditFields: AUDIT_FIELDS,
    tags: ['workflow', 'autonomy'],
  },
  {
    id: 'memos',
    name: 'MemOS',
    repository: 'https://github.com/MemTensor/MemOS.git',
    integrationMode: 'reference',
    versionPolicy: { pinRequired: true, updateCadence: 'manual' },
    compatibilityMatrix: {
      minMiyaVersion: '0.7.0',
      minOpenCodeVersion: '1.1.56',
      platforms: ['windows', 'linux', 'macos'],
    },
    permissionMetadata: {
      sideEffects: ['memory_write'],
      requiredDomains: ['memory_write'],
    },
    rollbackPlan: DEFAULT_ROLLBACK,
    auditFields: AUDIT_FIELDS,
    tags: ['memory', 'knowledge'],
  },
  {
    id: 'oh-my-opencode-slim',
    name: 'oh-my-opencode-slim',
    repository: 'https://github.com/alvinunreal/oh-my-opencode-slim.git',
    integrationMode: 'skill-pack',
    versionPolicy: { pinRequired: true, updateCadence: 'scheduled' },
    compatibilityMatrix: {
      minMiyaVersion: '0.7.0',
      minOpenCodeVersion: '1.1.56',
      platforms: ['windows', 'linux', 'macos'],
    },
    permissionMetadata: {
      sideEffects: ['local_build'],
      requiredDomains: ['local_build'],
    },
    rollbackPlan: DEFAULT_ROLLBACK,
    auditFields: AUDIT_FIELDS,
    tags: ['workflow', 'slim'],
  },
  {
    id: 'zeroclaw',
    name: 'ZeroClaw',
    repository: 'https://github.com/zeroclaw-labs/zeroclaw.git',
    integrationMode: 'reference',
    versionPolicy: { pinRequired: true, updateCadence: 'manual' },
    compatibilityMatrix: {
      minMiyaVersion: '0.7.0',
      minOpenCodeVersion: '1.1.56',
      platforms: ['windows', 'linux', 'macos'],
    },
    permissionMetadata: {
      sideEffects: ['local_build', 'desktop_control'],
      requiredDomains: ['local_build', 'desktop_control'],
    },
    rollbackPlan: DEFAULT_ROLLBACK,
    auditFields: AUDIT_FIELDS,
    tags: ['agent-runtime', 'automation'],
  },
];

export const ECOSYSTEM_BRIDGE_REGISTRY: EcosystemBridgeEntry[] = [
  ...ECOSYSTEM_BRIDGE_ENTRIES,
].sort((a, b) => a.id.localeCompare(b.id));

export function listEcosystemBridgeRegistry(): EcosystemBridgeEntry[] {
  return ECOSYSTEM_BRIDGE_REGISTRY.map((entry) => ({
    ...entry,
    versionPolicy: { ...entry.versionPolicy },
    compatibilityMatrix: {
      ...entry.compatibilityMatrix,
      platforms: [...entry.compatibilityMatrix.platforms],
    },
    permissionMetadata: {
      ...entry.permissionMetadata,
      sideEffects: [...entry.permissionMetadata.sideEffects],
      requiredDomains: [...entry.permissionMetadata.requiredDomains],
    },
    rollbackPlan: {
      ...entry.rollbackPlan,
      steps: [...entry.rollbackPlan.steps],
    },
    auditFields: [...entry.auditFields],
    tags: [...entry.tags],
  }));
}

export function getEcosystemBridgeEntry(
  id: string,
): EcosystemBridgeEntry | null {
  const normalized = String(id ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  const hit = ECOSYSTEM_BRIDGE_REGISTRY.find(
    (entry) => entry.id === normalized,
  );
  if (!hit) return null;
  return (
    listEcosystemBridgeRegistry().find((entry) => entry.id === normalized) ??
    null
  );
}
