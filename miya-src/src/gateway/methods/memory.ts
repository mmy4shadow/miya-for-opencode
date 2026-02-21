import {
  type CompanionMemoryVector,
  archiveCompanionMemoryVector,
  confirmCompanionMemoryVector,
  decayCompanionMemoryVectors,
  listCompanionMemoryCorrections,
  listCompanionMemoryVectors,
  listPendingCompanionMemoryVectors,
  searchCompanionMemoryVectors,
  updateCompanionMemoryVector,
  upsertCompanionMemoryVector,
} from '../../companion/memory-vector';
import {
  randomUUID,
} from 'node:crypto';
import {
  readCompanionProfile,
  syncCompanionProfileMemoryFacts,
} from '../../companion/store';
import type { GatewayMethodRegistrarDeps } from './types';

interface LearningGateSnapshot {
  candidateMode: 'toast_gate' | 'silent_audit';
  persistentRequiresApproval: boolean;
}

export interface MemoryMethodDeps extends GatewayMethodRegistrarDeps {
  requireOwnerMode: (projectDir: string) => void;
  requirePolicyHash: (
    projectDir: string,
    providedHash: string | undefined,
  ) => string;
  requireDomainRunning: (projectDir: string, domain: 'memory_write') => void;
  resolveApprovalTicket: (input: {
    projectDir: string;
    sessionID: string;
    permission: string;
    patterns: string[];
  }) => { ok: true } | { ok: false; reason: string };
  getLearningGate: () => LearningGateSnapshot;
}

export function registerMemoryMethods(deps: MemoryMethodDeps): void {
  const { methods, projectDir, parseText } = deps;

  const isMemoryRuntimeUnavailable = (error: unknown): boolean =>
    String(error instanceof Error ? error.message : error).includes(
      'sqlite_runtime_unavailable',
    );

  const createDegradedCandidate = (fact: string): CompanionMemoryVector => {
    const now = new Date().toISOString();
    return {
      id: `volatile_${randomUUID()}`,
      text: fact,
      source: 'conversation',
      embedding: [],
      score: 0,
      confidence: 0.3,
      tier: 'L2',
      status: 'candidate',
      accessCount: 0,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
    };
  };

  methods.register('companion.memory.add', async (params) => {
    deps.requireOwnerMode(projectDir);
    const policyHash = parseText(params.policyHash) || undefined;
    const fact = parseText(params.fact);
    if (!fact) throw new Error('invalid_memory_fact');
    deps.requirePolicyHash(projectDir, policyHash);
    deps.requireDomainRunning(projectDir, 'memory_write');
    let created: CompanionMemoryVector;
    let degraded = false;
    try {
      created = upsertCompanionMemoryVector(projectDir, {
        text: fact,
        source: 'conversation',
        activate: false,
        sourceType:
          parseText(params.sourceType) === 'direct_correction'
            ? 'direct_correction'
            : 'conversation',
      });
    } catch (error) {
      if (!isMemoryRuntimeUnavailable(error)) throw error;
      created = createDegradedCandidate(fact);
      degraded = true;
    }
    const profile = syncCompanionProfileMemoryFacts(projectDir);
    const learningGate = deps.getLearningGate();
    return {
      memory: created,
      stage: created.status,
      learningGate: {
        stage: 'candidate',
        approvalMode: learningGate.candidateMode,
        interruptsUser: false,
      },
      needsCorrectionWizard: Boolean(created.conflictWizardID),
      message: created.conflictWizardID
        ? 'memory_pending_conflict_requires_correction_wizard'
        : degraded
          ? 'memory_pending_confirmation_required:degraded_sqlite_runtime'
          : 'memory_pending_confirmation_required',
      profile,
    };
  });

  methods.register('companion.memory.list', async () => {
    deps.requireOwnerMode(projectDir);
    return readCompanionProfile(projectDir).memoryFacts;
  });
  methods.register('companion.memory.pending.list', async () => {
    deps.requireOwnerMode(projectDir);
    return listPendingCompanionMemoryVectors(projectDir);
  });
  methods.register('companion.memory.corrections.list', async () => {
    deps.requireOwnerMode(projectDir);
    return listCompanionMemoryCorrections(projectDir);
  });

  methods.register('companion.memory.confirm', async (params) => {
    deps.requireOwnerMode(projectDir);
    const policyHash = parseText(params.policyHash) || undefined;
    deps.requirePolicyHash(projectDir, policyHash);
    deps.requireDomainRunning(projectDir, 'memory_write');
    const memoryID = parseText(params.memoryID);
    const sessionID = parseText(params.sessionID) || 'main';
    if (!memoryID) throw new Error('invalid_memory_id');
    const learningGate = deps.getLearningGate();
    if (learningGate.persistentRequiresApproval) {
      const ticket = deps.resolveApprovalTicket({
        projectDir,
        sessionID,
        permission: 'memory_write',
        patterns: [
          'memory_stage=persistent',
          `memory_id=${memoryID}`,
          'action=confirm',
        ],
      });
      if (!ticket.ok) throw new Error(`approval_required:${ticket.reason}`);
    }

    const confirm =
      typeof params.confirm === 'boolean' ? Boolean(params.confirm) : true;
    const updated = confirmCompanionMemoryVector(projectDir, {
      memoryID,
      confirm,
      supersedeConflicts:
        typeof params.supersedeConflicts === 'boolean'
          ? Boolean(params.supersedeConflicts)
          : true,
    });
    if (!updated) throw new Error('memory_not_found');
    const profile = syncCompanionProfileMemoryFacts(projectDir);
    return {
      memory: updated,
      stage: updated.status,
      learningGate: {
        stage: 'persistent',
        approvalMode: learningGate.persistentRequiresApproval
          ? 'modal_approval'
          : 'toast_gate',
        interruptsUser: learningGate.persistentRequiresApproval,
      },
      profile,
    };
  });

  methods.register('companion.memory.update', async (params) => {
    deps.requireOwnerMode(projectDir);
    const policyHash = parseText(params.policyHash) || undefined;
    deps.requirePolicyHash(projectDir, policyHash);
    deps.requireDomainRunning(projectDir, 'memory_write');
    const memoryID = parseText(params.memoryID);
    if (!memoryID) throw new Error('invalid_memory_id');
    const updated = updateCompanionMemoryVector(projectDir, {
      memoryID,
      text: parseText(params.text) || undefined,
      memoryKind:
        parseText(params.memoryKind) === 'Fact' ||
        parseText(params.memoryKind) === 'Insight' ||
        parseText(params.memoryKind) === 'UserPreference'
          ? (parseText(params.memoryKind) as
              | 'Fact'
              | 'Insight'
              | 'UserPreference')
          : undefined,
      confidence:
        typeof params.confidence === 'number' &&
        Number.isFinite(params.confidence)
          ? Number(params.confidence)
          : undefined,
      tier:
        parseText(params.tier) === 'L0' ||
        parseText(params.tier) === 'L1' ||
        parseText(params.tier) === 'L2' ||
        parseText(params.tier) === 'L3'
          ? (parseText(params.tier) as 'L0' | 'L1' | 'L2' | 'L3')
          : undefined,
      status:
        parseText(params.status) === 'candidate' ||
        parseText(params.status) === 'pending' ||
        parseText(params.status) === 'active' ||
        parseText(params.status) === 'superseded' ||
        parseText(params.status) === 'archived'
          ? (parseText(params.status) as
              | 'candidate'
              | 'pending'
              | 'active'
              | 'superseded'
              | 'archived')
          : undefined,
    });
    if (!updated) throw new Error('memory_not_found');
    const profile = syncCompanionProfileMemoryFacts(projectDir);
    return { memory: updated, profile };
  });

  methods.register('companion.memory.archive', async (params) => {
    deps.requireOwnerMode(projectDir);
    const policyHash = parseText(params.policyHash) || undefined;
    deps.requirePolicyHash(projectDir, policyHash);
    deps.requireDomainRunning(projectDir, 'memory_write');
    const memoryID = parseText(params.memoryID);
    if (!memoryID) throw new Error('invalid_memory_id');
    const archived =
      typeof params.archived === 'boolean' ? Boolean(params.archived) : true;
    const updated = archiveCompanionMemoryVector(projectDir, {
      memoryID,
      archived,
    });
    if (!updated) throw new Error('memory_not_found');
    return { memory: updated };
  });

  methods.register('companion.memory.search', async (params) => {
    deps.requireOwnerMode(projectDir);
    const query = parseText(params.query);
    if (!query) throw new Error('invalid_memory_query');
    const limit =
      typeof params.limit === 'number' && params.limit > 0
        ? Math.min(20, Number(params.limit))
        : 5;
    const threshold =
      typeof params.threshold === 'number' && params.threshold >= 0
        ? Number(params.threshold)
        : undefined;
    const recencyHalfLifeDays =
      typeof params.recencyHalfLifeDays === 'number' &&
      params.recencyHalfLifeDays > 0
        ? Number(params.recencyHalfLifeDays)
        : undefined;
    return searchCompanionMemoryVectors(projectDir, query, limit, {
      threshold,
      recencyHalfLifeDays,
      mode:
        parseText(params.mode) === 'vector' ||
        parseText(params.mode) === 'keyword'
          ? (parseText(params.mode) as 'vector' | 'keyword')
          : 'hybrid',
    });
  });

  methods.register('companion.memory.decay', async (params) => {
    deps.requireOwnerMode(projectDir);
    const policyHash = parseText(params.policyHash) || undefined;
    deps.requirePolicyHash(projectDir, policyHash);
    deps.requireDomainRunning(projectDir, 'memory_write');
    const halfLifeDays =
      typeof params.halfLifeDays === 'number' && params.halfLifeDays > 0
        ? Number(params.halfLifeDays)
        : 30;
    return decayCompanionMemoryVectors(projectDir, halfLifeDays);
  });

  methods.register('companion.memory.vector.list', async () => {
    deps.requireOwnerMode(projectDir);
    return listCompanionMemoryVectors(projectDir);
  });
}
