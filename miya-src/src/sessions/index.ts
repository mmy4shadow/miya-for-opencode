import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
} from '../security/system-keyring';
import { getMiyaRuntimeDir } from '../workflow';

export type SessionKind = 'opencode' | 'channel' | 'wizard' | 'system';
export type SessionActivation = 'active' | 'queued' | 'muted';
export type SessionReplyMode = 'auto' | 'manual' | 'summary_only';
export type SessionQueueStrategy = 'fifo' | 'priority' | 'cooldown';

export interface MiyaQueuedMessage {
  id: string;
  text: string;
  source: string;
  createdAt: string;
}

export interface MiyaSession {
  id: string;
  kind: SessionKind;
  groupId: string;
  title?: string;
  policy: {
    activation: SessionActivation;
    reply: SessionReplyMode;
    queueStrategy: SessionQueueStrategy;
  };
  routing: {
    opencodeSessionID: string;
    agent: string;
  };
  queue: MiyaQueuedMessage[];
  createdAt: string;
  updatedAt: string;
}

interface SessionStore {
  sessions: Record<string, MiyaSession>;
}

const DEFAULT_POLICY: MiyaSession['policy'] = {
  activation: 'active',
  reply: 'auto',
  queueStrategy: 'fifo',
};

function nowIso(): string {
  return new Date().toISOString();
}

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'sessions.json');
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function readStore(projectDir: string): SessionStore {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) {
    return { sessions: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as SessionStore;
    if (!parsed || typeof parsed !== 'object' || !parsed.sessions) {
      return { sessions: {} };
    }
    const normalized: SessionStore = { sessions: {} };
    for (const [id, session] of Object.entries(parsed.sessions ?? {})) {
      normalized.sessions[id] = {
        ...session,
        groupId: decryptSensitiveValue(
          projectDir,
          String(session.groupId ?? ''),
        ),
        title:
          typeof session.title === 'string'
            ? decryptSensitiveValue(projectDir, session.title)
            : session.title,
        routing: {
          ...(session.routing ?? {
            opencodeSessionID: 'main',
            agent: '1-task-manager',
          }),
          opencodeSessionID: decryptSensitiveValue(
            projectDir,
            String(session.routing?.opencodeSessionID ?? 'main'),
          ),
        },
        queue: Array.isArray(session.queue)
          ? session.queue.map((item) => ({
              ...item,
              text: decryptSensitiveValue(projectDir, String(item.text ?? '')),
              source: decryptSensitiveValue(
                projectDir,
                String(item.source ?? ''),
              ),
            }))
          : [],
      } as MiyaSession;
    }
    return normalized;
  } catch {
    return { sessions: {} };
  }
}

function writeStore(projectDir: string, store: SessionStore): void {
  const file = filePath(projectDir);
  ensureDir(file);
  const encrypted: SessionStore = { sessions: {} };
  for (const [id, session] of Object.entries(store.sessions)) {
    encrypted.sessions[id] = {
      ...session,
      groupId: encryptSensitiveValue(projectDir, session.groupId),
      title: session.title
        ? encryptSensitiveValue(projectDir, session.title)
        : session.title,
      routing: {
        ...session.routing,
        opencodeSessionID: encryptSensitiveValue(
          projectDir,
          session.routing.opencodeSessionID,
        ),
      },
      queue: session.queue.map((item) => ({
        ...item,
        text: encryptSensitiveValue(projectDir, item.text),
        source: encryptSensitiveValue(projectDir, item.source),
      })),
    };
  }
  fs.writeFileSync(file, `${JSON.stringify(encrypted, null, 2)}\n`, 'utf-8');
}

function sanitizeSession(value: MiyaSession): MiyaSession {
  return {
    ...value,
    policy: {
      activation: value.policy?.activation ?? DEFAULT_POLICY.activation,
      reply: value.policy?.reply ?? DEFAULT_POLICY.reply,
      queueStrategy:
        value.policy?.queueStrategy ?? DEFAULT_POLICY.queueStrategy,
    },
    routing: {
      opencodeSessionID: value.routing?.opencodeSessionID ?? 'main',
      agent: value.routing?.agent ?? '1-task-manager',
    },
    queue: Array.isArray(value.queue) ? value.queue : [],
  };
}

export function listSessions(projectDir: string): MiyaSession[] {
  const store = readStore(projectDir);
  return Object.values(store.sessions)
    .map(sanitizeSession)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getSession(
  projectDir: string,
  sessionID: string,
): MiyaSession | null {
  const store = readStore(projectDir);
  const session = store.sessions[sessionID];
  return session ? sanitizeSession(session) : null;
}

export function upsertSession(
  projectDir: string,
  input: {
    id: string;
    kind?: SessionKind;
    groupId?: string;
    title?: string;
    routingSessionID?: string;
    agent?: string;
  },
): MiyaSession {
  const store = readStore(projectDir);
  const existing = store.sessions[input.id];
  const createdAt = existing?.createdAt ?? nowIso();

  const session: MiyaSession = sanitizeSession({
    id: input.id,
    kind: input.kind ?? existing?.kind ?? 'channel',
    groupId: input.groupId ?? existing?.groupId ?? input.id,
    title: input.title ?? existing?.title,
    policy: existing?.policy ?? DEFAULT_POLICY,
    routing: {
      opencodeSessionID:
        input.routingSessionID ??
        existing?.routing?.opencodeSessionID ??
        'main',
      agent: input.agent ?? existing?.routing?.agent ?? '1-task-manager',
    },
    queue: existing?.queue ?? [],
    createdAt,
    updatedAt: nowIso(),
  });

  store.sessions[input.id] = session;
  writeStore(projectDir, store);
  return session;
}

export function setSessionPolicy(
  projectDir: string,
  sessionID: string,
  patch: Partial<MiyaSession['policy']>,
): MiyaSession | null {
  const store = readStore(projectDir);
  const existing = store.sessions[sessionID];
  if (!existing) return null;

  const next: MiyaSession = sanitizeSession({
    ...existing,
    policy: {
      ...existing.policy,
      ...patch,
    },
    updatedAt: nowIso(),
  });

  store.sessions[sessionID] = next;
  writeStore(projectDir, store);
  return next;
}

export function enqueueSessionMessage(
  projectDir: string,
  sessionID: string,
  input: { text: string; source: string },
): MiyaQueuedMessage {
  const store = readStore(projectDir);
  const existing = sanitizeSession(
    store.sessions[sessionID] ??
      upsertSession(projectDir, {
        id: sessionID,
      }),
  );

  const message: MiyaQueuedMessage = {
    id: `queue_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    text: input.text,
    source: input.source,
    createdAt: nowIso(),
  };

  const nextQueue = [...existing.queue, message];
  const next: MiyaSession = {
    ...existing,
    queue: nextQueue,
    updatedAt: nowIso(),
  };

  store.sessions[sessionID] = next;
  writeStore(projectDir, store);
  return message;
}

export function dequeueSessionMessage(
  projectDir: string,
  sessionID: string,
): MiyaQueuedMessage | null {
  const store = readStore(projectDir);
  const existing = store.sessions[sessionID];
  if (!existing || existing.queue.length === 0) {
    return null;
  }

  const [first, ...rest] = existing.queue;
  store.sessions[sessionID] = {
    ...existing,
    queue: rest,
    updatedAt: nowIso(),
  };
  writeStore(projectDir, store);
  return first;
}
