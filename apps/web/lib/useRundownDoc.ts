"use client";

import { useEffect, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import { API_URL } from "./api";
import { resolveSyncUrl } from "./syncUrl";

const DOC_WS_URL = resolveSyncUrl(process.env.NEXT_PUBLIC_DOC_WS_URL, "ws://localhost:8787/doc");

/**
 * Shared rundown document connection; re-renders the consumer on every doc
 * update. `joinCode` (or the stored admin token) authenticates the connection
 * on locked-down servers; follower codes get a read-only doc.
 *
 * Connections are scoped to the rundown's DOC EPOCH (`<id>@<epoch>`). An
 * in-place restore bumps the epoch and kicks every client; on auth failure
 * the hook refetches the epoch and, if it moved, reconnects with a FRESH
 * Y.Doc — pre-restore state can never merge back.
 */
/** What the document connection is doing — surfaced in the diagnostics bar. */
export interface DocStatus {
  connected: boolean;
  synced: boolean;
  /** Last thing that happened, in words a person can read out of a screenshot. */
  phase: string;
  authFailed: boolean;
  attempts: number;
  epoch: number | null;
  url: string;
  /** Kind of credential sent — never the credential itself. */
  tokenKind: string;
  lastError: string | null;
  /**
   * Set once the server has refused for good. While this is null the screen is
   * still legitimately loading; once it is set, waiting will never help and the
   * surface must say what is wrong instead of spinning forever.
   */
  blocked: DocBlock | null;
}

/** A refusal the server explained, resolved against who the credential turned out to be. */
export interface DocBlock {
  reason: string;
  /** Plain words for whoever is holding the device. */
  title: string;
  detail: string;
  /** The fix that will actually work: sign in again, or ask for access. */
  action: "sign-in" | "reload" | "ask-for-access" | "none";
  /** Who the server says the credential belongs to — the missing half of the diagnosis. */
  identity: string | null;
}

/** Maps a server refusal onto something worth reading on a phone at a venue. */
function describeRefusal(reason: string, identity: string | null, signedIn: boolean): DocBlock {
  const known: Record<string, { title: string; detail: string; action: DocBlock["action"] }> = {
    "no-such-rundown": {
      title: "This run sheet no longer exists",
      detail: "It was deleted, or this link points at a different server.",
      action: "none",
    },
    "sheet-restored-reload": {
      title: "This run sheet was restored from a snapshot",
      detail: "Reload to pick up the restored version.",
      action: "reload",
    },
    "not-signed-in": {
      title: "You are not signed in on this device",
      detail: "Signing in on a computer does not sign in this phone or tablet — each device needs its own sign-in.",
      action: "sign-in",
    },
    "signin-not-recognised": {
      title: "This device's sign-in has expired",
      detail: "The saved sign-in is no longer valid — it expired, or was revoked. Signing in again fixes it.",
      action: "sign-in",
    },
    "no-access-for-this-account": {
      title: "This account cannot open this run sheet",
      detail: "The sign-in works, but it has not been given access to this event. Ask for access, or open the sheet with a join code.",
      action: "ask-for-access",
    },
    "code-is-view-only": {
      title: "This code is for viewing only",
      detail:
        "Codes open the run sheet read-only. Running or editing a show needs an account — ask whoever runs the sheet to sign you in.",
      action: "sign-in",
    },
    "viewing-closed": {
      title: "This run sheet is closed",
      detail: "The event is over and the showcaller has closed the sheet. Whoever ran the show can open it again if you still need it.",
      action: "none",
    },
  };
  // With no credential at all there is no identity worth reporting — saying
  // "not recognised" implies a sign-in that failed, which is a different story.
  const shown = reason === "not-signed-in" ? null : identity;
  const hit = known[reason];
  if (hit) return { reason, identity: shown, ...hit };
  // An unknown refusal still beats an endless spinner: name it and let the
  // screenshot carry the exact string back.
  return {
    reason,
    identity,
    title: "The server refused this connection",
    detail: `Reason: ${reason}.`,
    action: signedIn ? "ask-for-access" : "sign-in",
  };
}

export function useRundownDoc(
  rundownId: string,
  joinCode?: string,
  /**
   * The epoch, already known — see the note on the show page.
   *
   * When the server render has it, the socket opens on the first frame instead
   * of after a cross-origin round trip. Left undefined, everything behaves
   * exactly as it did.
   */
  initialEpoch?: number,
): { doc: Y.Doc; revision: number; connected: boolean; synced: boolean; status: DocStatus } {
  const [epoch, setEpoch] = useState<number | null>(initialEpoch ?? null);
  const [doc, setDoc] = useState(() => new Y.Doc());
  const [connected, setConnected] = useState(false);
  // The socket opening is not the same as the CONTENT arriving: a long sheet
  // over a phone connection takes a moment, and until it lands the document
  // is legitimately empty. Surfaces use this to say "loading" rather than
  // claiming the rundown has no rows.
  const [synced, setSynced] = useState(false);
  const [phase, setPhase] = useState("starting");
  const [authFailed, setAuthFailed] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [tokenKind, setTokenKind] = useState("none");
  const [blocked, setBlocked] = useState<DocBlock | null>(null);
  /**
   * How many times the document has changed.
   *
   * This counter already existed, purely to force a re-render on every update —
   * its value was thrown away. Handing it out turns it into the thing consumers
   * can memoise against, which nothing could do before: a `Y.Doc` is the SAME
   * object before and after an edit, so `useMemo(..., [doc])` never recomputes
   * and `useMemo(..., [])`-style caching on identity is simply wrong. The
   * revision changes exactly when the contents do.
   */
  const [revision, setTick] = useState(0);

  /**
 * Drop this sheet's stores from older epochs.
 *
 * A sheet restored in place gets a new epoch and therefore a new store, and the
 * old one would sit on the device forever holding a copy of a run sheet nobody
 * can reach any more. Only this sheet's own leftovers are removed — another
 * sheet's store belongs to whoever is using that sheet, and a tab open on it
 * right now would not thank us.
 *
 * Everything here is best-effort: `databases()` does not exist in every browser
 * (Firefox notably), and a failure means a little wasted space, never a broken
 * sheet.
 */
async function pruneStaleStores(rundownId: string, keep: string): Promise<void> {
  try {
    const list = (indexedDB as { databases?: () => Promise<{ name?: string }[]> }).databases;
    if (!list) return;
    const dbs = await list.call(indexedDB);
    for (const db of dbs) {
      const name = db.name;
      if (!name || name === keep) continue;
      if (name.startsWith(`oc:${rundownId}@`)) indexedDB.deleteDatabase(name);
    }
  } catch {
    // Wasted space is not worth a thrown error on the way into a show.
  }
}

/** null = the rundown does not exist; the caller must not open a socket for it. */
  const fetchEpoch = (id: string): Promise<number | null> =>
    fetch(`${API_URL}/rundowns/${id}/epoch`)
      .then((r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`epoch HTTP ${r.status}`);
        return (r.json() as Promise<{ epoch?: number }>).then((b) => b.epoch ?? 0);
      })
      .catch((err) => {
        // The API being unreachable is itself the diagnosis worth showing.
        setLastError(`epoch: ${String(err?.message ?? err)}`);
        return 0;
      });

  useEffect(() => {
    // Already answered by the server render — connect, do not ask again.
    if (initialEpoch != null) {
      setEpoch(initialEpoch);
      return;
    }
    let cancelled = false;
    setPhase("fetching epoch");
    void fetchEpoch(rundownId).then((e) => {
      if (cancelled) return;
      // A deleted rundown is settled here, before any socket is opened. Asking
      // the document server for one it does not have gets a refusal that it
      // journals as a server error — a stale tab or bookmark then reports a
      // fault on every load, for something the client already knew.
      if (e === null) {
        setPhase("no such rundown");
        setLastError("this run sheet no longer exists");
        setBlocked(describeRefusal("no-such-rundown", null, false));
        return;
      }
      setEpoch(e);
    });
    return () => {
      cancelled = true;
    };
  }, [rundownId, initialEpoch]);

  useEffect(() => {
    if (epoch == null) return;
    let cancelled = false;
    const fresh = new Y.Doc();
    /**
     * Keep the document on the device, so opening it again is a delta.
     *
     * The browser started from an empty document every time, which means it had
     * nothing to diff against and the server had to send the WHOLE sheet — 1.7MB
     * on a real one, measured, on every single load and every reload. Held here,
     * the browser arrives with a state vector and gets back only what changed
     * since, which for a sheet reopened between two halves is usually nothing.
     *
     * It is also why a sheet now appears at all on a dead connection: the rows
     * are already on the device, so the last known running order is on screen
     * while the socket is still trying. A run sheet you cannot reach is worse
     * than one that is a few minutes old and says so.
     *
     * SAFE BECAUSE OF WHAT YJS IS. This is not a cache that can go stale and
     * win: the stored document is loaded AND the socket still syncs, and a CRDT
     * merges the two — anything the server has that the device does not arrives
     * and is applied. The device cannot hold back a change.
     *
     * The one case that is NOT a merge is a sheet whose content was replaced
     * wholesale (an in-place restore), and that is exactly what the epoch marks:
     * it is part of the key, so a restored sheet reads from a different store
     * and starts clean. The epoch was already doing this job for the socket.
     */
    const store = `oc:${rundownId}@${epoch}`;
    const persistence = new IndexeddbPersistence(store, fresh);
    void pruneStaleStores(rundownId, store);
    setDoc(fresh);
    setSynced(false);
    setBlocked(null);
    const stored = localStorage.getItem("oc:admintoken");
    const token = joinCode ?? stored ?? "dev";
    // Only ever record the KIND of credential — a screenshot must never carry
    // the credential itself.
    setTokenKind(
      joinCode
        ? "join code"
        : !stored
          ? "none (dev)"
          : stored.startsWith("ses_")
            ? "session"
            : stored.startsWith("usr_")
              ? "personal"
              : stored.startsWith("co_")
                ? "company"
                : "admin",
    );
    setPhase("connecting");
    setAttempts((n) => n + 1);
    let concluded = false;
    /**
     * Set once a refusal is FINAL. The provider's own reconnect logic can fire
     * after `disconnect()` — a retry scheduled before the call, or a close
     * arriving during it — and each refused attempt used to restart the loop:
     * the tab showed "this run sheet no longer exists" for twenty-five
     * seconds and then went back to "disconnected, retrying" with the bare
     * 4401, measured on 3 September. Once settled, every later close is
     * answered with another disconnect and nothing else.
     */
    let settled = false;
    /**
     * Conclude a refused connection, once.
     *
     * Reached two ways, and the second was missing. The document server
     * refuses a connection by sending a permission-denied message carrying its
     * reason and then closing the socket with 4401 — and the provider surfaces
     * that as `onAuthenticationFailed`. But a refusal can also arrive as the
     * bare close: seen on the night of 3 September on a sheet that had been
     * DELETED while a signed-in tab was open on it. The tab's reconnects were
     * refused, `onClose` logged "socket closed 4401 Unauthorized", nothing
     * concluded, and the screen sat on "disconnected, retrying" over rows that
     * existed only in that tab's memory — with no word that the sheet was
     * gone. A fresh load of the same link said so at once, because the epoch
     * pre-check above settles a deleted sheet before any socket is opened.
     *
     * So both paths conclude the same way, and the epoch lookup is the
     * authority: gone means gone whatever the socket said; moved means an
     * in-place restore to follow; unchanged means the refusal is final.
     */
    const conclude = (reason: string | undefined): void => {
      if (concluded) return;
      concluded = true;
      void fetchEpoch(rundownId).then(async (current) => {
        if (cancelled) return;
        if (current !== null && current !== epoch) {
          concluded = false; // a moved epoch is a fresh start, not a refusal
          setEpoch(current);
          return;
        }
        // Nothing about this will change by asking again: stop reconnecting
        // so the device isn't retrying a hopeless socket for the rest of the
        // show. "Try again" and sign-in both reload the page.
        settled = true;
        provider.disconnect();
        if (current === null) {
          setPhase("no such rundown");
          setLastError("this run sheet no longer exists");
          setBlocked(describeRefusal("no-such-rundown", null, false));
          return;
        }
        // Ask the server who this credential belongs to. That single answer
        // separates "your sign-in died" from "your account lacks access" —
        // the two causes look identical from inside the socket.
        let identity: string | null = null;
        let signedIn = false;
        try {
          const res = await fetch(`${API_URL}/me`, { headers: { authorization: `Bearer ${token}` } });
          if (res.ok) {
            const me = (await res.json()) as { role?: string | null; name?: string; teamName?: string };
            if (me.role) {
              signedIn = true;
              identity = me.name ?? me.teamName ?? me.role;
            } else {
              identity = "not recognised by the server";
            }
          }
        } catch {
          identity = null;
        }
        if (!cancelled) setBlocked(describeRefusal(reason ?? "permission-denied", identity, signedIn));
      });
    };
    const provider = new HocuspocusProvider({
      url: DOC_WS_URL,
      name: `${rundownId}@${epoch}`,
      document: fresh,
      token,
      onConnect: () => {
        setConnected(true);
        setPhase("connected, waiting for content");
      },
      onSynced: () => {
        setSynced(true);
        setPhase("synced");
      },
      onDisconnect: () => {
        setConnected(false);
        // A settled refusal keeps its own phase ("no such rundown", …) rather
        // than being overwritten by the disconnect it caused.
        if (settled) return;
        setPhase("disconnected, retrying");
      },
      onClose: ({ event }: { event: { code?: number; reason?: string } }) => {
        if (settled) {
          provider.disconnect();
          return;
        }
        if (event?.code && event.code !== 1000) {
          setLastError(`socket closed ${event.code}${event.reason ? ` ${event.reason}` : ""}`);
        }
        // 4401 is the document server refusing us. When the refusal reaches
        // us only as this close — see `conclude` — it still has to be
        // concluded, or the tab retries a dead socket for the rest of the show.
        if (event?.code === 4401) conclude(undefined);
      },
      onAuthenticationFailed: ({ reason }: { reason?: string }) => {
        setAuthFailed(true);
        setPhase("authentication refused");
        setLastError(`auth refused${reason ? `: ${reason}` : ""}`);
        // The provider retries forever. Diagnosing the same refusal on every
        // attempt would put a steady stream of requests on the server from a
        // screen that is going nowhere, so conclude it once — see `conclude`.
        conclude(reason);
      },
    });
    const bump = () => setTick((n) => n + 1);
    fresh.on("update", bump);
    return () => {
      cancelled = true;
      fresh.off("update", bump);
      provider.destroy();
      // Closes the connection, keeps what is stored — the point is that it
      // survives to the next load.
      void persistence.destroy();
    };
  }, [rundownId, joinCode, epoch]);

  return {
    doc,
    revision,
    connected,
    synced,
    status: { connected, synced, phase, authFailed, attempts, epoch, url: DOC_WS_URL, tokenKind, lastError, blocked },
  };
}

/** Keeps the screen awake while the surface is visible (companion surfaces in show use). */
export function useWakeLock(): void {
  useEffect(() => {
    type WakeLockSentinel = { release: () => Promise<void> };
    let lock: WakeLockSentinel | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> } };
    const acquire = () => nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, []);
}
