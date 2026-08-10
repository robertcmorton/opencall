"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EDIT_LOCK_HEARTBEAT_MS, type EditLockView } from "@opencall/core";
import { api } from "./api";

/**
 * Holding the sheet while you edit it.
 *
 * There is no Save button in this app — the document is a CRDT and stores
 * itself continuously — so "released on save" cannot mean what it means in a
 * file-based tool. It means released when you are FINISHED: press Done, close
 * the tab, or go quiet long enough that the server stops believing you.
 *
 * The heartbeat is the whole design. A lock you had to give back by hand
 * would strand a sheet the first time somebody shut a laptop on a train, and
 * a run sheet nobody can edit because a producer went home is a worse problem
 * than the one the lock is solving.
 */
export interface EditLockHandle {
  /** What to show: yours, free, held by somebody, or held but gone quiet. */
  view: EditLockView | null;
  /** You hold it, so the sheet is writable. */
  mine: boolean;
  /** Take it — used both for a first claim and to take over a stale one. */
  claim: () => Promise<boolean>;
  /** Give it back, so the next person can go in. */
  release: () => Promise<void>;
  /** A claim was refused; the sheet stays read-only. */
  refused: boolean;
}

export function useEditLock(rundownId: string, wanted: boolean): EditLockHandle {
  const [view, setView] = useState<EditLockView | null>(null);
  const [mine, setMine] = useState(false);
  const [refused, setRefused] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const mineRef = useRef(false);
  mineRef.current = mine;

  const claim = useCallback(async (): Promise<boolean> => {
    try {
      const r = await api.claimEditLock(rundownId, tokenRef.current);
      tokenRef.current = r.token;
      setMine(true);
      setRefused(false);
      setView({ kind: "yours" });
      return true;
    } catch {
      setMine(false);
      setRefused(true);
      // Whoever has it, and since when — so the screen can name them.
      await api.editLock(rundownId).then(setView).catch(() => undefined);
      return false;
    }
  }, [rundownId]);

  const release = useCallback(async (): Promise<void> => {
    const token = tokenRef.current;
    tokenRef.current = null;
    setMine(false);
    if (token) await api.releaseEditLock(rundownId, token).catch(() => undefined);
    await api.editLock(rundownId).then(setView).catch(() => undefined);
  }, [rundownId]);

  // Claim when editing starts; hand back when it stops.
  useEffect(() => {
    if (!wanted) {
      if (mineRef.current) void release();
      else void api.editLock(rundownId).then(setView).catch(() => undefined);
      return;
    }
    void claim();
  }, [wanted, rundownId, claim, release]);

  // Keep saying we are here. Re-claiming with our own token IS the heartbeat,
  // so a lock that expired while a laptop slept is retaken on the next beat
  // rather than needing the person to notice and press something.
  useEffect(() => {
    if (!wanted || !mine) return;
    const id = setInterval(() => void claim(), EDIT_LOCK_HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [wanted, mine, claim]);

  // Watch while waiting, so "Sam is editing" becomes "take it" by itself.
  useEffect(() => {
    if (!wanted || mine) return;
    const id = setInterval(() => {
      void api.editLock(rundownId).then(setView).catch(() => undefined);
    }, 5000);
    return () => clearInterval(id);
  }, [wanted, mine, rundownId]);

  /**
   * Give it back when the tab goes.
   *
   * `pagehide` rather than `beforeunload`: it fires on mobile when the browser
   * backgrounds a tab, which is exactly the case where somebody walks away
   * holding a sheet. `keepalive` lets the request outlive the page.
   */
  useEffect(() => {
    if (!mine) return;
    const hand = () => {
      const token = tokenRef.current;
      if (!token) return;
      api.releaseEditLockBeacon(rundownId, token);
    };
    window.addEventListener("pagehide", hand);
    return () => window.removeEventListener("pagehide", hand);
  }, [mine, rundownId]);

  return { view, mine, claim, release, refused };
}
