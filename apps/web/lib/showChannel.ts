"use client";

import { useEffect, useRef, useState } from "react";
import { ulid } from "ulid";
import {
  PROTOCOL_VERSION,
  type CmdAction,
  type Role,
  type ShowStatePayload,
} from "@opencall/protocol";
import type { EventTypeSpec } from "@opencall/core";
import { resolveSyncUrl } from "./syncUrl";

const SHOW_WS_URL = resolveSyncUrl(process.env.NEXT_PUBLIC_SYNC_WS_URL, "ws://localhost:8787");
const OFFSET_SAMPLES = 5;

/**
 * How long the channel may be silent before we stop believing it.
 *
 * The server sends a heartbeat every 15 seconds, so this is roughly three
 * missed beats. It exists because a TCP connection can die WITHOUT a close
 * event — a laptop sleeps, wifi drops, a proxy times the socket out — and the
 * browser goes on reporting `readyState === OPEN` to a socket with nothing at
 * the other end.
 *
 * That is not a theoretical failure. A show was left open and ended on the
 * server, but the screen went on counting from state frozen at the moment the
 * connection died, and Stop went into the dead socket and vanished. The page
 * had to be reloaded before the show could be stopped. A timer that is wrong
 * and a Stop that does nothing are the two worst things this app can do.
 */
const CHANNEL_STALE_MS = 40_000;

export interface ShowChannel {
  connected: boolean;
  role: Role | null;
  /** IANA timezone of the event — governs every clock on this surface. */
  timezone: string | null;
  /**
   * The SHEET's kind of show ("nrl"), falling back to the event's — drives
   * sport-specific live flows.
   */
  sport: string | null;
  /**
   * The whole definition when the sheet uses a kind of show a company added.
   * Built-in types are already in the client's own list; this arrives only for
   * the ones that are not, so a custom type behaves live like any other.
   */
  eventTypeSpec: EventTypeSpec | null;
  show: ShowStatePayload | null;
  /** Server clock now: Date.now() + measured offset. */
  serverNow: () => number;
  /**
   * `atPlanned` marks a jump as "put the show where the SHEET says it is"
   * rather than "take this row now" — sync cue and catch-up, not an ordinary
   * jump. The row then inherits its planned start instead of starting now.
   */
  sendCmd: (action: CmdAction, rowId?: string, opts?: { atPlanned?: boolean }) => void;
  /**
   * The last transport command the SERVER refused, with the reason it gave.
   * A rejected command used to be dropped on the floor: the button appeared
   * to do nothing, which is indistinguishable from a broken button when you
   * are live. Surfaces show this and it is journaled.
   */
  lastCmdError: { action: string; msg: string; at: number } | null;
  clearCmdError: () => void;
}

/**
 * Client for the PROTOCOL.md show channel: hello/welcome, NTP-style clock
 * offset (median of 5 pings, refreshed each connect), seq-guarded show_state,
 * jittered reconnect backoff, idempotent command ids.
 */
export function useShowChannel(rundownId: string, device: "console" | "companion", joinCode?: string): ShowChannel {
  const [connected, setConnected] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [sport, setSport] = useState<string | null>(null);
  const [eventTypeSpec, setEventTypeSpec] = useState<EventTypeSpec | null>(null);
  const [show, setShow] = useState<ShowStatePayload | null>(null);
  const [lastCmdError, setLastCmdError] = useState<{ action: string; msg: string; at: number } | null>(null);
  // command id → what it was trying to do, so a refusal can name the action.
  const sentRef = useRef(new Map<string, CmdAction>());
  const wsRef = useRef<WebSocket | null>(null);
  const offsetRef = useRef(0);
  const lastSeqRef = useRef(-1);
  // Commands sent while the socket is CONNECTING (or between reconnects) are
  // queued and flushed once the server has welcomed us — never thrown at a
  // socket that isn't ready. Stale entries (>15s) are dropped at flush.
  const welcomedRef = useRef(false);
  /** When the server was last heard from — any frame, heartbeats included. */
  const lastHeardRef = useRef(Date.now());
  const pendingRef = useRef<{ frame: string; at: number }[]>([]);
  const flushPending = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    for (const { frame, at } of pendingRef.current.splice(0)) {
      if (now - at < 15_000) ws.send(frame);
    }
  };

  useEffect(() => {
    let closed = false;
    let retryDelay = 500;
    let ws: WebSocket;

    const connect = () => {
      if (closed) return;
      // Bound to THIS socket, not to whichever one is current.
      //
      // Every handler used to close over the mutable `ws`, so a reconnect
      // pointed them at the new socket. A late onopen from a socket that had
      // already been replaced then sent the hello down a socket still opening:
      // "Failed to execute 'send' on 'WebSocket': Still in CONNECTING state",
      // uncaught, three times in production. A handler belongs to the socket
      // that raised it.
      const sock = new WebSocket(`${SHOW_WS_URL}/?rundown=${encodeURIComponent(rundownId)}`);
      ws = sock;
      wsRef.current = sock;
      const pings: number[] = [];

      sock.onopen = () => {
        retryDelay = 500;
        lastHeardRef.current = Date.now();
        // A join code always wins (it carries the role). Otherwise any stored
        // sign-in token authenticates — consoles AND companions (follow /
        // timer / prompter opened from the dashboard have no code, and the
        // DEV123 fallback is dead on locked servers, which left them
        // "reconnecting" forever). DEV123 remains the dev-open last resort.
        const stored = localStorage.getItem("oc:admintoken");
        const auth = joinCode
          ? { kind: "join" as const, code: joinCode.toUpperCase() }
          : device === "console" || stored
            ? { kind: "session" as const, token: stored ?? "dev" }
            : { kind: "join" as const, code: "DEV123" };
        if (sock.readyState !== WebSocket.OPEN) return;
        sock.send(JSON.stringify({ v: PROTOCOL_VERSION, t: "hello", auth, device, lastSeq: lastSeqRef.current >= 0 ? lastSeqRef.current : undefined }));
      };

      sock.onmessage = (event) => {
        // Anything at all counts as proof of life, including the server's
        // heartbeat, which is otherwise ignored below.
        lastHeardRef.current = Date.now();
        const msg = JSON.parse(String(event.data));
        if (msg.v !== PROTOCOL_VERSION) return;
        switch (msg.t) {
          case "welcome": {
            setConnected(true);
            setRole(msg.role);
            setTimezone(msg.timezone ?? null);
            setSport(msg.sport ?? null);
            setEventTypeSpec((msg.eventTypeSpec as EventTypeSpec | undefined) ?? null);
            lastSeqRef.current = msg.show.seq;
            setShow(msg.show);
            welcomedRef.current = true;
            flushPending();
            for (let i = 0; i < OFFSET_SAMPLES; i++)
              setTimeout(() => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify({ v: PROTOCOL_VERSION, t: "ping", t0: Date.now() })), i * 200);
            break;
          }
          case "pong": {
            const rtt = Date.now() - msg.t0;
            pings.push(msg.t1 + rtt / 2 - Date.now());
            if (pings.length >= 1) {
              const sorted = [...pings].sort((a, b) => a - b);
              offsetRef.current = sorted[Math.floor(sorted.length / 2)]!;
            }
            break;
          }
          case "cmd_error": {
            const action = sentRef.current.get(msg.id) ?? "command";
            sentRef.current.delete(msg.id);
            setLastCmdError({ action, msg: String(msg.msg ?? "refused"), at: Date.now() });
            void import("./errorReport").then((m) =>
              m.reportClientError(`transport "${action}" refused by the server: ${msg.msg} (code ${msg.code})`),
            );
            break;
          }
          case "show_state": {
            if (msg.seq <= lastSeqRef.current) break;
            lastSeqRef.current = msg.seq;
            const { v: _v, t: _t, ...payload } = msg;
            setShow(payload as ShowStatePayload);
            break;
          }
        }
      };

      sock.onclose = () => {
        // A socket that has already been replaced is not the one to reconnect
        // from — the watchdog closes a quiet socket and reconnects, and if the
        // dying socket also reconnected there would be two of them, each
        // reconnecting the other's losses.
        if (wsRef.current !== sock) return;
        setConnected(false);
        welcomedRef.current = false;
        if (closed) return;
        setTimeout(connect, retryDelay + Math.random() * 250);
        retryDelay = Math.min(retryDelay * 2, 8000);
      };
    };

    /**
     * Stop trusting a socket that has gone quiet.
     *
     * Closing it is what starts the reconnect — and the reconnect is what
     * re-reads the show state, so a screen that has been counting a show that
     * already ended corrects itself instead of waiting for somebody to reload.
     */
    const checkAlive = () => {
      if (closed) return;
      const quietFor = Date.now() - lastHeardRef.current;
      const live = ws && ws.readyState === WebSocket.OPEN;
      if (live && quietFor > CHANNEL_STALE_MS) {
        // The browser still calls this OPEN. It is not.
        ws.close();
      } else if (ws && ws.readyState === WebSocket.CLOSED) {
        connect();
      }
    };
    const watchdog = setInterval(checkAlive, 5_000);

    /**
     * Check the moment the machine comes back, not on the next tick.
     *
     * A sleeping laptop does not run intervals, so on waking the watchdog is
     * as far behind as the sleep was long. These events fire first, which is
     * the difference between a screen that is right when you look at it and
     * one that is right five seconds later.
     */
    const wake = () => {
      if (document.visibilityState === "visible") checkAlive();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", checkAlive);
    window.addEventListener("focus", checkAlive);
    window.addEventListener("pageshow", checkAlive);

    connect();
    return () => {
      closed = true;
      clearInterval(watchdog);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", checkAlive);
      window.removeEventListener("focus", checkAlive);
      window.removeEventListener("pageshow", checkAlive);
      ws?.close();
    };
  }, [rundownId, device, joinCode]);

  return {
    connected,
    role,
    timezone,
    sport,
    eventTypeSpec,
    show,
    serverNow: () => Date.now() + offsetRef.current,
    lastCmdError,
    clearCmdError: () => setLastCmdError(null),
    sendCmd: (action, rowId, opts) => {
      const id = ulid();
      // Remember what each id was for, so a refusal can name the button.
      sentRef.current.set(id, action);
      if (sentRef.current.size > 50) sentRef.current.delete(sentRef.current.keys().next().value!);
      const payload: Record<string, unknown> = { v: PROTOCOL_VERSION, t: "cmd", id, action };
      if (rowId) payload.rowId = rowId;
      if (opts?.atPlanned) payload.atPlanned = true;
      if (action === "stop") payload.confirm = true;
      const frame = JSON.stringify(payload);
      const ws = wsRef.current;
      // A socket that has gone quiet still reports OPEN, and sending into it
      // succeeds silently — which is how a Stop disappeared and a show could
      // not be stopped without reloading. Treat silence as not connected, so
      // the command is QUEUED and goes out on the reconnect instead.
      const quiet = Date.now() - lastHeardRef.current > CHANNEL_STALE_MS;
      if (ws && ws.readyState === WebSocket.OPEN && welcomedRef.current && !quiet) ws.send(frame);
      else {
        // Not connected: queue it, but say so — a command that has not left
        // the device must never look like one the server accepted.
        pendingRef.current.push({ frame, at: Date.now() });
        if (pendingRef.current.length > 20) pendingRef.current.shift();
        setLastCmdError({ action, msg: "not connected — queued until the server is back", at: Date.now() });
      }
    },
  };
}
