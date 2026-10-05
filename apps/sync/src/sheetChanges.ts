import { desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as Y from "yjs";
import { describeChange, schema, summarizeChange, type ChangeDetail, type DbHandle } from "@opencall/db";

/**
 * The sheet's change log (see `sheet_changes` in the schema).
 *
 * Who a connection is, as the document channel learned it at sign-in. `key`
 * matches the edit lock's holder key, so "Done editing" can close the session
 * of exactly the person who pressed it.
 */
export interface Who {
  key: string;
  userId: string | null;
  name: string;
}

/**
 * The version to restore to "just before" a change: the newest saved version
 * when it already IS that state, otherwise a new one. Dated `at`, not now —
 * a person's session is written when it ends, but its version is of how the
 * sheet stood when it began.
 */
export async function versionBefore(
  handle: DbHandle,
  rundownId: string,
  before: Uint8Array,
  v: { label: string; kind: string; createdBy: string | null; at?: Date },
): Promise<string> {
  const latest = await handle.db.query.rundownSnapshots.findFirst({
    where: eq(schema.rundownSnapshots.rundownId, rundownId),
    orderBy: [desc(schema.rundownSnapshots.createdAt)],
    columns: { id: true, doc: true },
  });
  if (latest && Buffer.from(Y.encodeStateVectorFromUpdate(latest.doc)).equals(Buffer.from(Y.encodeStateVectorFromUpdate(before)))) return latest.id;
  const id = ulid();
  await handle.db.insert(schema.rundownSnapshots).values({
    id,
    rundownId,
    doc: before,
    label: v.label.slice(0, 160),
    kind: v.kind,
    createdBy: v.createdBy,
    ...(v.at ? { createdAt: v.at } : {}),
  });
  return id;
}

/**
 * Writes one entry, or nothing when before and after are the same. Returns
 * the entry's id and what it recorded.
 */
export async function recordChange(
  handle: DbHandle,
  e: {
    rundownId: string;
    kind: "edit" | "assistant" | "import" | "restore" | "undo" | "copy";
    startedAt: Date;
    at?: Date;
    actorUserId: string | null;
    actorName: string | null;
    assistant?: string | null;
    beforeSnapshotId: string | null;
    before: Y.Doc;
    after: Y.Doc;
    undoes?: string | null;
  },
): Promise<{ id: string; detail: ChangeDetail } | null> {
  const detail = describeChange(e.before, e.after);
  if (!detail) return null;
  const id = ulid();
  // A user deleted between the change and its record would break the insert.
  const actorUserId = e.actorUserId && (await handle.db.query.users.findFirst({ where: eq(schema.users.id, e.actorUserId), columns: { id: true } })) ? e.actorUserId : null;
  await handle.db.insert(schema.sheetChanges).values({
    id,
    rundownId: e.rundownId,
    kind: e.kind,
    startedAt: e.startedAt,
    at: e.at ?? new Date(),
    actorUserId,
    actorName: e.actorName,
    assistant: e.assistant ?? null,
    summary: summarizeChange(detail),
    beforeSnapshotId: e.beforeSnapshotId,
    detail,
    undoes: e.undoes ?? null,
  });
  return { id, detail };
}

/** A pause this long ends a person's editing session. */
export const EDIT_SESSION_IDLE_MS = 2 * 60_000;

interface Session {
  rundownId: string;
  docName: string;
  doc: Y.Doc;
  who: Who;
  before: Uint8Array;
  startedAt: Date;
  lastAt: Date;
}

/**
 * Notices people editing and writes one log entry per editing session.
 *
 * A session starts at a person's first change to a sheet — the sheet as it
 * stood just then is kept in memory — and ends after two quiet minutes, when
 * they press Done editing, when the sheet closes, or when the server stops.
 * Then the sheet as it is is compared with how it was; if anything differs,
 * the "before" becomes a version and the difference an entry.
 *
 * Only changes from people's connections count. The assistant, restores and
 * undos change the sheet from the server and write their own entries.
 *
 * Two people editing at once each get a session, and each session's
 * difference includes the other's work over the same minutes. The edit lock
 * makes that rare; the entry is honest about the period it covers.
 */
export function createEditTracker(handle: DbHandle, parseDocName: (name: string) => { rundownId: string }) {
  const sessions = new Map<string, Session>();
  const isLoaded = new Map<string, () => boolean>();

  const close = async (key: string): Promise<void> => {
    const s = sessions.get(key);
    if (!s) return;
    sessions.delete(key);
    try {
      const before = new Y.Doc();
      Y.applyUpdate(before, s.before);
      if (!describeChange(before, s.doc)) return;
      const rundown = await handle.db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, s.rundownId), columns: { id: true } });
      if (!rundown) return; // deleted meanwhile
      const beforeSnapshotId = await versionBefore(handle, s.rundownId, s.before, {
        label: `Before ${s.who.name}'s edits`,
        kind: "edit",
        createdBy: s.who.userId,
        at: s.startedAt,
      });
      await recordChange(handle, {
        rundownId: s.rundownId,
        kind: "edit",
        startedAt: s.startedAt,
        at: s.lastAt,
        actorUserId: s.who.userId,
        actorName: s.who.name,
        beforeSnapshotId,
        before,
        after: s.doc,
      });
    } catch (err) {
      console.error("[changes] could not record an editing session:", err);
    }
  };

  /** Watches one loaded document. Called once per load. */
  const attach = (docName: string, doc: Y.Doc, loaded: () => boolean) => {
    const { rundownId } = parseDocName(docName);
    isLoaded.set(docName, loaded);
    let opened: string | null = null;
    doc.on("beforeTransaction", (tr: Y.Transaction) => {
      opened = null;
      const origin = tr.origin as { source?: string; connection?: { context?: { who?: Who } } } | null;
      if (origin?.source !== "connection") return;
      const who = origin.connection?.context?.who;
      if (!who) return;
      const key = `${docName}|${who.key}`;
      const now = new Date();
      const s = sessions.get(key);
      if (s) return;
      sessions.set(key, { rundownId, docName, doc, who, before: Y.encodeStateAsUpdate(doc), startedAt: now, lastAt: now });
      opened = key;
    });
    doc.on("afterTransaction", (tr: Y.Transaction) => {
      const origin = tr.origin as { source?: string; connection?: { context?: { who?: Who } } } | null;
      if (origin?.source !== "connection") return;
      const who = origin.connection?.context?.who;
      if (!who) return;
      const key = `${docName}|${who.key}`;
      const s = sessions.get(key);
      if (!s) return;
      if (tr.changed.size > 0 || tr.deleteSet.clients.size > 0) s.lastAt = new Date();
      // Joining a sheet syncs it, and a sync with nothing new is not editing:
      // a session opened by a transaction that changed nothing is dropped.
      else if (opened === key && s.lastAt.getTime() === s.startedAt.getTime()) sessions.delete(key);
      opened = null;
    });
  };

  const sweep = () => {
    const now = Date.now();
    for (const [key, s] of sessions) {
      const stillOpen = isLoaded.get(s.docName)?.() ?? false;
      if (!stillOpen || now - s.lastAt.getTime() > EDIT_SESSION_IDLE_MS) void close(key);
    }
  };
  const timer = setInterval(sweep, 15_000);
  timer.unref?.();

  return {
    attach,
    /** "Done editing": the session of the person who pressed it ends now. */
    closeFor: async (rundownId: string, whoKey: string) => {
      await Promise.all([...sessions].filter(([, s]) => s.rundownId === rundownId && s.who.key === whoKey).map(([k]) => close(k)));
    },
    /** Every open session, now — before a restore replaces the sheet, or the server stops. */
    closeRundown: async (rundownId: string) => {
      await Promise.all([...sessions].filter(([, s]) => s.rundownId === rundownId).map(([k]) => close(k)));
    },
    closeAll: async () => {
      clearInterval(timer);
      await Promise.all([...sessions.keys()].map(close));
    },
    /** For tests: how many people are mid-session. */
    openCount: () => sessions.size,
  };
}

export type EditTracker = ReturnType<typeof createEditTracker>;
