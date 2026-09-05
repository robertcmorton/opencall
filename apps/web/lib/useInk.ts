"use client";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { countStrokes, eraseAt, INK_ERASE_RADIUS, type InkDoc, type Stroke } from "@opencall/core";
import { api } from "./api";

/**
 * A person's ink on one sheet: what is drawn, the last fifty states for
 * undo, and where it is kept.
 *
 * Storage follows who is looking. An account's ink goes to the server so the
 * same marks are on the iPad in the truck and the laptop at home; a crew
 * member on a join code, and an admin token, have no user row, so theirs
 * stays in this browser. The browser copy is written either way — it is what
 * the sheet shows while the server answers, and what survives a dead link.
 */

const KEY = (rundownId: string) => `oc:ink:${rundownId}`;
const HISTORY = 50;
const SAVE_AFTER_MS = 600;

interface State {
  doc: InkDoc;
  history: InkDoc[];
}

type Action =
  | { type: "load"; doc: InkDoc }
  | { type: "add"; rowId: string; stroke: Stroke }
  | { type: "erase"; rowId: string; xFrac: number; yPx: number; rowWidth: number }
  | { type: "undo" }
  | { type: "clear" };

function reduce(s: State, a: Action): State {
  switch (a.type) {
    case "load":
      return { doc: a.doc, history: [] };
    case "add": {
      const strokes = s.doc[a.rowId] ?? [];
      return push(s, { ...s.doc, [a.rowId]: [...strokes, a.stroke] });
    }
    case "erase": {
      const strokes = s.doc[a.rowId];
      if (!strokes?.length) return s;
      const kept = eraseAt(strokes, a.xFrac, a.yPx, INK_ERASE_RADIUS, a.rowWidth);
      if (kept === strokes) return s;
      const doc = { ...s.doc };
      if (kept.length) doc[a.rowId] = kept;
      else delete doc[a.rowId];
      return push(s, doc);
    }
    case "undo": {
      const prev = s.history[s.history.length - 1];
      if (!prev) return s;
      return { doc: prev, history: s.history.slice(0, -1) };
    }
    case "clear":
      return countStrokes(s.doc) === 0 ? s : push(s, {});
  }
}

const push = (s: State, doc: InkDoc): State => ({ doc, history: [...s.history.slice(-(HISTORY - 1)), s.doc] });

function readLocal(rundownId: string): InkDoc | null {
  try {
    const raw = localStorage.getItem(KEY(rundownId));
    return raw ? (JSON.parse(raw) as InkDoc) : null;
  } catch {
    return null;
  }
}

function writeLocal(rundownId: string, doc: InkDoc) {
  try {
    if (countStrokes(doc) === 0) localStorage.removeItem(KEY(rundownId));
    else localStorage.setItem(KEY(rundownId), JSON.stringify(doc));
  } catch {
    /* private mode, full store — the server copy still has it */
  }
}

export function useInk(rundownId: string): {
  doc: InkDoc;
  canUndo: boolean;
  addStroke: (rowId: string, stroke: Stroke) => void;
  erase: (rowId: string, xFrac: number, yPx: number, rowWidth: number) => void;
  undo: () => void;
  clear: () => void;
} {
  const [state, dispatch] = useReducer(reduce, { doc: {}, history: [] });
  const stored = useRef<"server" | "local" | "unknown">("unknown");
  // Set by every edit and cleared by every save. A server answer that lands
  // after the first stroke must not wipe that stroke.
  const dirty = useRef(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    stored.current = "unknown";
    dirty.current = false;
    const local = readLocal(rundownId);
    dispatch({ type: "load", doc: local ?? {} });
    api
      .ink(rundownId)
      .then((r) => {
        if (!alive) return;
        stored.current = r.stored;
        if (r.stored === "server" && r.ink && countStrokes(r.ink) > 0 && !dirty.current) {
          dispatch({ type: "load", doc: r.ink });
          writeLocal(rundownId, r.ink);
        } else if (r.stored === "server" && local && countStrokes(local) > 0 && !r.ink) {
          // Drawn here before signing in, or on a link the server could not
          // hear: the browser has the only copy, so it goes up.
          dirty.current = true;
        }
      })
      .catch(() => {
        if (alive) stored.current = "local";
      });
    return () => {
      alive = false;
    };
  }, [rundownId]);

  const { doc } = state;
  useEffect(() => {
    if (!dirty.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      writeLocal(rundownId, doc);
      if (stored.current !== "server") {
        dirty.current = false;
        return;
      }
      api
        .saveInk(rundownId, doc)
        .then(() => {
          dirty.current = false;
        })
        // The browser copy stands; the next stroke tries again.
        .catch(() => undefined);
    }, SAVE_AFTER_MS);
  }, [doc, rundownId]);

  const mark = () => {
    dirty.current = true;
  };
  const addStroke = useCallback((rowId: string, stroke: Stroke) => {
    mark();
    dispatch({ type: "add", rowId, stroke });
  }, []);
  const erase = useCallback((rowId: string, xFrac: number, yPx: number, rowWidth: number) => {
    mark();
    dispatch({ type: "erase", rowId, xFrac, yPx, rowWidth });
  }, []);
  const undo = useCallback(() => {
    mark();
    dispatch({ type: "undo" });
  }, []);
  const clear = useCallback(() => {
    mark();
    dispatch({ type: "clear" });
  }, []);

  return { doc, canUndo: state.history.length > 0, addStroke, erase, undo, clear };
}
