import { getDefaultHostId, invokeOn } from "../transport";
import { formatProjectRef, hostPathArgs, sessionRefKey, type HostId } from "../host";
import { stripHostRef } from "../paths";
import { persistableAttachment } from "../attachments";
import type { ContextUsage } from "../contextUsage";
import { normalizeProjectPath } from "../recents";
import type {
  Block,
  HarnessId,
  HandoffMeta,
  HandoffStatus,
  RuntimeMode,
  SecondOpinionMeta,
  Session,
  SessionScope,
} from "../session";
import { HARNESSES, RUNTIME_MODES, sessionScope } from "../session";

export type SessionSummary = {
  id: string;
  /** The machine that minted this id and owns the transcript behind it. */
  hostId: HostId;
  cwd: string;
  harness: HarnessId;
  model: string;
  runtimeMode: RuntimeMode;
  title: string;
  providerSessionId?: string;
  branch?: string;
  repo?: string;
  additions?: number;
  deletions?: number;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  pinned?: boolean;
  scope: SessionScope;
};

type SessionRecord = {
  id: string;
  cwd: string;
  harness: string;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: string;
  title: string;
  providerSessionId?: string | null;
  blocks: Block[];
  contextUsed?: number | null;
  contextWindow?: number | null;
  branch?: string | null;
  worktreeCwd?: string | null;
  scope?: string | null;
  createdAt: number;
  updatedAt: number;
};

type SessionUpsertPayload = {
  id: string;
  cwd: string;
  harness: string;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: string;
  title: string;
  providerSessionId?: string;
  blocks: Block[];
  contextUsed?: number;
  contextWindow?: number;
  branch?: string;
  worktreeCwd?: string;
  scope?: SessionScope;
};

/**
 * Only real chats belong in history — blank tabs stay ephemeral. A coding
 * session also needs a project; a work chat has none, so its scratch cwd
 * carries no meaning and cannot gate the write.
 */
export function shouldPersistSession(session: Session): boolean {
  if (!session.blocks.some((block) => block.role === "user")) return false;
  return sessionScope(session) === "work" || session.cwd !== "~";
}

/** Matches Rust `validate_id` — a path here fails the whole upsert. */
export function isPersistableId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

/**
 * The host stores a path on itself and compares `session_list_by_project`
 * against it, so the reference form a remote project carries in the workspace
 * is stripped back to the bare path before it goes over the wire.
 */
function persistableMeta(session: Session): Omit<SessionUpsertPayload, "blocks"> {
  return {
    id: session.id,
    cwd: normalizeProjectPath(stripHostRef(session.cwd)),
    harness: session.harness,
    model: session.model,
    modelSettings: session.modelSettings,
    runtimeMode: session.runtimeMode,
    title: session.title,
    ...(session.providerSessionId && isPersistableId(session.providerSessionId)
      ? { providerSessionId: session.providerSessionId }
      : {}),
    ...(session.context ? { contextUsed: session.context.used } : {}),
    ...(session.context?.window ? { contextWindow: session.context.window } : {}),
    ...(session.branch ? { branch: session.branch } : {}),
    ...(session.worktreeCwd ? { worktreeCwd: session.worktreeCwd } : {}),
    scope: sessionScope(session),
  };
}

export function sanitizeSessionForPersist(session: Session): SessionUpsertPayload {
  return {
    ...persistableMeta(session),
    blocks: session.blocks.map(sanitizeBlock).filter((block): block is Block => block != null),
  };
}

/**
 * `session_upsert` runs off the main thread, so two writes for the same
 * session could otherwise land in either order and let an older transcript
 * overwrite a newer one. Chain them per session; different sessions still
 * write concurrently.
 */
const sessionWriteQueues = new Map<string, Promise<unknown>>();
const deletedSessionRefs = new Set<string>();

function enqueueSessionWrite<T>(queueKey: string, operation: () => Promise<T>): Promise<T> {
  const previous = sessionWriteQueues.get(queueKey) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  sessionWriteQueues.set(queueKey, tail);
  void tail.then(() => {
    if (sessionWriteQueues.get(queueKey) === tail) {
      sessionWriteQueues.delete(queueKey);
    }
  });
  return run;
}

export async function upsertSession(
  session: Session,
  hostIdArg?: HostId,
): Promise<SessionSummary | null> {
  const hostId = hostPathArgs(session.cwd, hostIdArg, getDefaultHostId()).hostId;
  const queueKey = sessionRefKey(hostId, session.id);
  if (!shouldPersistSession(session) || deletedSessionRefs.has(queueKey)) {
    return null;
  }
  const payload = sanitizeSessionForPersist(session);
  const summary = await enqueueSessionWrite(queueKey, async () => {
    if (deletedSessionRefs.has(queueKey)) return null;
    return invokeOn<SessionSummary>(hostId, "session_upsert", { session: payload });
  });
  return summary ? normalizeSummary(summary, hostId) : null;
}

/**
 * Blocks are replaced, never mutated in place, so identity stands in for
 * content. Serializing the session here instead meant a full deep copy and a
 * `JSON.stringify` of the whole transcript — megabytes on a long chat — on the
 * main thread every time a save was considered. Header fields go through
 * `persistableMeta` so a new persisted column cannot be forgotten here.
 */
const blockTokens = new WeakMap<Block, number>();
let lastBlockToken = 0;

function blockToken(block: Block): number {
  const seen = blockTokens.get(block);
  if (seen !== undefined) return seen;
  const token = ++lastBlockToken;
  blockTokens.set(block, token);
  return token;
}

export function persistFingerprint(session: Session): string {
  return `${JSON.stringify(persistableMeta(session))}|${session.blocks.map(blockToken).join(",")}`;
}

export async function listSessionsByProject(
  cwd: string,
  hostIdArg?: HostId,
): Promise<SessionSummary[]> {
  if (!cwd || cwd === "~") return [];
  const target = hostPathArgs(cwd, hostIdArg, getDefaultHostId());
  const rows = await invokeOn<SessionSummary[]>(target.hostId, "session_list_by_project", {
    cwd: normalizeProjectPath(target.path),
  });
  return rows.map((row) => normalizeSummary(row, target.hostId));
}

/** Work chats have no project, so they list by scope instead of by cwd. */
export async function listSessionsByScope(
  scope: SessionScope,
  hostId: HostId = getDefaultHostId(),
): Promise<SessionSummary[]> {
  const rows = await invokeOn<SessionSummary[]>(hostId, "session_list_by_scope", { scope });
  return rows.map((row) => normalizeSummary(row, hostId));
}

export type SessionSearchHit = {
  kind: "conversation" | "message";
  sessionId: string;
  hostId: HostId;
  cwd: string;
  harness: string;
  title: string;
  updatedAt: number;
  blockId?: string;
  role?: string;
  preview: string;
};

export type SessionSearchResult = {
  hits: SessionSearchHit[];
  truncated: boolean;
};

export async function searchSessions(options: {
  query: string;
  cwd?: string;
  includeArchived?: boolean;
  /** Defaults to coding so project search never surfaces a work chat. */
  scope?: SessionScope;
  hostId?: HostId;
}): Promise<SessionSearchResult> {
  const query = options.query.trim();
  if (!query) return { hits: [], truncated: false };
  const hostId = options.hostId ?? getDefaultHostId();
  const result = await invokeOn<SessionSearchResult>(hostId, "session_search", {
    options: {
      query,
      ...(options.cwd && options.cwd !== "~" ? { cwd: normalizeProjectPath(options.cwd) } : {}),
      ...(options.includeArchived ? { includeArchived: true } : {}),
      scope: options.scope ?? "coding",
    },
  });
  return {
    hits: Array.isArray(result?.hits) ? result.hits.map((hit) => ({ ...hit, hostId })) : [],
    truncated: !!result?.truncated,
  };
}

export async function getSession(
  sessionId: string,
  hostId: HostId = getDefaultHostId(),
): Promise<Session | null> {
  const record = await invokeOn<SessionRecord | null>(hostId, "session_get", {
    sessionId,
  });
  if (!record) return null;
  return recordToSession(record, hostId);
}

export async function deleteSession(
  sessionId: string,
  hostId: HostId = getDefaultHostId(),
): Promise<void> {
  const queueKey = sessionRefKey(hostId, sessionId);
  deletedSessionRefs.add(queueKey);
  try {
    await enqueueSessionWrite(queueKey, () =>
      invokeOn<void>(hostId, "session_delete", { sessionId }),
    );
  } catch (error) {
    deletedSessionRefs.delete(queueKey);
    throw error;
  }
}

export async function setSessionArchived(
  sessionId: string,
  archived: boolean,
  hostId: HostId = getDefaultHostId(),
): Promise<void> {
  await enqueueSessionWrite(sessionRefKey(hostId, sessionId), () =>
    invokeOn<void>(hostId, "session_set_archived", { sessionId, archived }),
  );
}

export async function setSessionPinned(
  sessionId: string,
  pinned: boolean,
  hostId: HostId = getDefaultHostId(),
): Promise<void> {
  await invokeOn<void>(hostId, "session_set_pinned", { sessionId, pinned });
}

/**
 * `session_set_in_flight` runs off the main thread, so two replaces could
 * otherwise land in either order and restore a stale busy snapshot.
 */
const inFlightWrites = new Map<HostId, Promise<unknown>>();

export async function replaceInFlightSessions(
  refs: { sessionId: string; cwd: string }[],
  hostId: HostId = getDefaultHostId(),
): Promise<void> {
  const run = (inFlightWrites.get(hostId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() =>
      invokeOn(hostId, "session_set_in_flight", {
        sessions: refs.map((ref) => ({
          sessionId: ref.sessionId,
          cwd: normalizeProjectPath(ref.cwd),
        })),
      }),
    );
  inFlightWrites.set(hostId, run);
  await run;
}

/** Kept across Vite reloads; boot must not delete the only copy. */
export async function listInFlightSessions(
  hostId: HostId = getDefaultHostId(),
): Promise<{ sessionId: string; cwd: string }[]> {
  const rows = await invokeOn<{ sessionId: string; cwd: string }[]>(
    hostId,
    "session_list_in_flight",
  );
  return Array.isArray(rows) ? rows : [];
}

/** Destructive: the first window to boot after a quit owns these chats. */
export async function takeInFlightSessions(
  hostId: HostId = getDefaultHostId(),
): Promise<{ sessionId: string; cwd: string }[]> {
  const rows = await invokeOn<{ sessionId: string; cwd: string }[]>(
    hostId,
    "session_take_in_flight",
  );
  return Array.isArray(rows) ? rows : [];
}

/**
 * `workspace_set_snapshot` runs off the main thread, so two saves could
 * otherwise finish out of order and keep an older layout.
 */
let workspaceWrite: Promise<unknown> = Promise.resolve();

export async function saveWorkspaceSnapshot(snapshot: unknown): Promise<void> {
  const run = workspaceWrite
    .catch(() => undefined)
    .then(() => invokeOn(getDefaultHostId(), "workspace_set_snapshot", { snapshot }));
  workspaceWrite = run;
  await run;
}

export async function loadWorkspaceSnapshot(): Promise<unknown | null> {
  const raw = await invokeOn<unknown | null>(getDefaultHostId(), "workspace_get_snapshot");
  return raw ?? null;
}

function sanitizeBlock(block: Block): Block | null {
  const next: Block = {
    id: block.id,
    role: block.role,
    text: block.text,
  };
  if (block.attachments?.length) {
    next.attachments = block.attachments.map(persistableAttachment);
  }
  if (block.startedAt != null) next.startedAt = block.startedAt;
  if (block.durationMs != null) next.durationMs = block.durationMs;
  if (block.tool) next.tool = block.tool;
  if (block.approval?.decided) {
    next.approval = {
      requestId: block.approval.requestId,
      decided: block.approval.decided,
    };
  } else if (block.approval && !block.approval.decided) {
    // Drop stale live approval prompts; request ids don't survive restarts.
    if (block.role === "approval") return null;
  }
  const handoff = sanitizeHandoff(block.handoff);
  if (handoff) next.handoff = handoff;
  else if (block.role === "handoff") return null;
  const secondOpinion = sanitizeSecondOpinion(block.secondOpinion);
  if (secondOpinion) next.secondOpinion = secondOpinion;
  const noteCard = sanitizeNoteCard(block.noteCard);
  if (noteCard) next.noteCard = noteCard;
  if (block.imageRequest) next.imageRequest = true;
  return next;
}

/**
 * A host answers with a path on itself. A project root is carried through the
 * workspace as a reference, so it is qualified again on the way back in — the
 * one reply shape that needs it, because it is the one that is a project root.
 */
function normalizeSummary(summary: SessionSummary, hostId: HostId): SessionSummary {
  return {
    ...summary,
    hostId,
    cwd: formatProjectRef({ hostId, path: summary.cwd }),
    harness: asHarness(summary.harness),
    runtimeMode: asRuntimeMode(summary.runtimeMode),
    ...(summary.providerSessionId ? { providerSessionId: summary.providerSessionId } : {}),
    ...(summary.branch ? { branch: summary.branch } : {}),
    ...(summary.repo ? { repo: summary.repo } : {}),
    additions: summary.additions ?? 0,
    deletions: summary.deletions ?? 0,
    archived: summary.archived || undefined,
    pinned: summary.pinned || undefined,
    scope: asScope(summary.scope),
  };
}

function recordToSession(record: SessionRecord, hostId: HostId): Session {
  const blocks = Array.isArray(record.blocks)
    ? record.blocks.map(sanitizeBlock).filter((block): block is Block => block != null)
    : [];
  return {
    id: record.id,
    hostId,
    cwd: formatProjectRef({ hostId, path: record.cwd }),
    harness: asHarness(record.harness),
    model: record.model,
    modelSettings:
      record.modelSettings && typeof record.modelSettings === "object" ? record.modelSettings : {},
    runtimeMode: asRuntimeMode(record.runtimeMode),
    title: record.title,
    blocks,
    busy: false,
    ...(record.providerSessionId ? { providerSessionId: record.providerSessionId } : {}),
    ...(record.branch ? { branch: record.branch } : {}),
    ...(record.worktreeCwd ? { worktreeCwd: record.worktreeCwd } : {}),
    ...(asScope(record.scope) === "work" ? { scope: "work" as const } : {}),
    ...contextFromRecord(record),
  };
}

/**
 * Last known reading from a stored session. The harness re-reports on the next
 * turn, so this only has to survive until then.
 */
function contextFromRecord(record: SessionRecord): { context: ContextUsage } | undefined {
  const used = record.contextUsed;
  if (typeof used !== "number" || !Number.isFinite(used) || used <= 0) {
    return undefined;
  }
  const window = record.contextWindow;
  return {
    context:
      typeof window === "number" && Number.isFinite(window) && window > 0
        ? { used, window }
        : { used },
  };
}

/** An unknown scope reads as coding, matching the Rust normalizer. */
function asScope(value: unknown): SessionScope {
  return value === "work" ? "work" : "coding";
}

function asHarness(value: string): HarnessId {
  return (HARNESSES as string[]).includes(value) ? (value as HarnessId) : "cursor";
}

const HANDOFF_STATUSES: HandoffStatus[] = ["preparing", "ready"];

function sanitizeHandoff(value: Block["handoff"]): HandoffMeta | undefined {
  if (!value) return undefined;
  if (!(HARNESSES as string[]).includes(value.from)) return undefined;
  if (!(HARNESSES as string[]).includes(value.to)) return undefined;
  if (!HANDOFF_STATUSES.includes(value.status)) return undefined;
  const interrupted = value.status === "preparing";
  return {
    from: value.from,
    to: value.to,
    status: "ready",
    pending: interrupted || !!value.pending,
  };
}

function sanitizeSecondOpinion(value: Block["secondOpinion"]): SecondOpinionMeta | undefined {
  if (!value) return undefined;
  if (!(HARNESSES as string[]).includes(value.from)) return undefined;
  if (!(HARNESSES as string[]).includes(value.to)) return undefined;
  const request = typeof value.request === "string" ? value.request.trim().slice(0, 240) : "";
  const files =
    typeof value.files === "number" && Number.isFinite(value.files)
      ? Math.max(0, Math.round(value.files))
      : 0;
  return {
    from: value.from,
    to: value.to,
    ...(request ? { request } : {}),
    ...(files > 0 ? { files } : {}),
    ...(value.kind === "handoff" ? { kind: "handoff" as const } : {}),
  };
}

function sanitizeNoteCard(value: Block["noteCard"]): Block["noteCard"] {
  if (!value || typeof value !== "object") return undefined;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) return undefined;
  const slug = typeof value.slug === "string" ? value.slug.trim() : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const sourceCwd = typeof value.sourceCwd === "string" ? value.sourceCwd.trim() : "";
  return {
    id,
    slug,
    title,
    ...(sourceCwd ? { sourceCwd } : {}),
  };
}

function asRuntimeMode(value: string): RuntimeMode {
  return (RUNTIME_MODES as string[]).includes(value) ? (value as RuntimeMode) : "supervised";
}
