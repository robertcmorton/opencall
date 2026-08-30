"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";

export interface RowNote {
  id: string;
  rowId: string;
  at: string;
  byName: string | null;
  byRole: string | null;
  body: string | null;
  resolvedAt: string | null;
}

/**
 * Notes raised by the crew against individual rows.
 *
 * The comments column on a printed sheet is written before the day starts and
 * read by nobody after it. What a camera operator actually needs is to say
 * "this one" during the show and have the showcaller see it — so a note is
 * attached to a ROW, raised from a view-only link, and answered by whoever is
 * calling.
 *
 * Polled rather than pushed. The show channel carries transport, which is
 * timing-critical and must not queue behind anything; a note is a message
 * between two people and fifteen seconds late is fifteen seconds late. It also
 * refreshes when the tab comes back, because a phone in a pocket stops timers.
 */
export function useRowNotes(
  rundownId: string,
  opts: { canRead: boolean; joinCode?: string | null; everySec?: number },
): {
  notes: RowNote[];
  /** Unresolved notes by row id — what the sheet marks. */
  openByRow: Map<string, RowNote[]>;
  openCount: number;
  refresh: () => void;
  raise: (rowId: string, body: { byName?: string | null; byRole?: string | null; body?: string | null }) => Promise<void>;
  resolve: (noteId: string) => Promise<void>;
} {
  const [notes, setNotes] = useState<RowNote[]>([]);
  const { canRead, joinCode } = opts;
  const everySec = opts.everySec ?? 15;

  const refresh = useCallback(() => {
    if (!canRead || !rundownId) return;
    api
      .notes(rundownId)
      .then(setNotes)
      // A sheet nobody may read answers 401, and a viewer without access is a
      // normal state rather than a fault — leave what we had and stay quiet.
      .catch(() => undefined);
  }, [canRead, rundownId]);

  useEffect(() => {
    refresh();
    if (!canRead) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, everySec * 1000);
    const onShow = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [refresh, canRead, everySec]);

  const openByRow = useMemo(() => {
    const m = new Map<string, RowNote[]>();
    for (const n of notes) {
      if (n.resolvedAt) continue;
      const list = m.get(n.rowId) ?? [];
      list.push(n);
      m.set(n.rowId, list);
    }
    return m;
  }, [notes]);

  const raise = useCallback(
    async (rowId: string, body: { byName?: string | null; byRole?: string | null; body?: string | null }) => {
      if (!joinCode) return;
      await api.raiseNote(joinCode, { rowId, ...body });
      refresh();
    },
    [joinCode, refresh],
  );

  const resolve = useCallback(
    async (noteId: string) => {
      // Gone from the sheet the moment it is pressed; the refresh only confirms
      // it. A showcaller pressing this is clearing something they have dealt
      // with, and waiting a round trip to see it go reads as a failed press.
      setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, resolvedAt: new Date().toISOString() } : n)));
      await api.resolveNote(noteId).catch(() => undefined);
      refresh();
    },
    [refresh],
  );

  return { notes, openByRow, openCount: [...openByRow.values()].reduce((n, l) => n + l.length, 0), refresh, raise, resolve };
}
