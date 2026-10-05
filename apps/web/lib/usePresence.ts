"use client";

import { useEffect, useState } from "react";

/** Where someone is on the sheet: a row, and the cell in it they are editing (if any). */
export interface PresenceSpot {
  rowId: string;
  columnId: string | null;
}

export interface Peer {
  clientId: number;
  name: string;
  color: string;
  spot: PresenceSpot | null;
}

/** The shape of the shared presence object (the Yjs awareness protocol). */
interface AwarenessLike {
  clientID: number;
  getStates(): Map<number, Record<string, unknown>>;
  setLocalStateField(field: string, value: unknown): void;
  on(event: "change", cb: () => void): void;
  off(event: "change", cb: () => void): void;
}

const PALETTE = ["#4c8dff", "#e8833a", "#3fbf7f", "#c063d6", "#e0b423", "#3fb6c8", "#e05a7a", "#8a9cff"];

/** A colour that is always the same for the same name. */
export function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/**
 * Who else has this sheet open to work on it, and where.
 *
 * Built on the document connection's awareness channel, which the server
 * relays and never stores: it is "who is here right now", nothing more. Only
 * the editing surfaces publish — a crew phone following the show is not
 * somebody "in the sheet" in the sense that matters here.
 */
export function usePresence(awareness: AwarenessLike | null, me: { name: string } | null, spot: PresenceSpot | null): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    if (!awareness || !me) return;
    awareness.setLocalStateField("user", { name: me.name, color: colorFor(me.name) });
  }, [awareness, me?.name]);

  useEffect(() => {
    if (!awareness || !me) return;
    awareness.setLocalStateField("spot", spot);
  }, [awareness, me?.name, spot?.rowId, spot?.columnId]);

  useEffect(() => {
    if (!awareness) {
      setPeers([]);
      return;
    }
    const read = () => {
      const out: Peer[] = [];
      for (const [clientId, state] of awareness.getStates()) {
        if (clientId === awareness.clientID) continue;
        const user = state.user as { name?: string; color?: string } | undefined;
        if (!user?.name) continue;
        out.push({ clientId, name: user.name, color: user.color ?? colorFor(user.name), spot: (state.spot as PresenceSpot | null) ?? null });
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
      setPeers(out);
    };
    read();
    awareness.on("change", read);
    return () => awareness.off("change", read);
  }, [awareness]);

  return peers;
}
