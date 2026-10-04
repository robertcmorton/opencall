import type { IncomingMessage } from "node:http";

/**
 * The address a request really came from.
 *
 * Behind Railway's edge every request carries X-Forwarded-For, and the edge
 * APPENDS the address it saw. Anything to its left was written by the client
 * and can say anything, so only the right-most entry is trusted. X-Real-IP is
 * ignored for the same reason. Without the header (local development) the
 * socket's own address is used.
 */
export function clientIp(req: Pick<IncomingMessage, "headers" | "socket"> | { headers: Headers | IncomingMessage["headers"] }): string {
  const raw =
    req.headers instanceof Headers ? req.headers.get("x-forwarded-for") : (req.headers["x-forwarded-for"] as string | string[] | undefined);
  const header = Array.isArray(raw) ? raw.join(",") : raw;
  if (header) {
    const parts = header.split(",").map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return normalise(last);
  }
  const socket = "socket" in req ? req.socket : undefined;
  return normalise(socket?.remoteAddress ?? "unknown");
}

const normalise = (ip: string): string => (ip.startsWith("::ffff:") ? ip.slice(7) : ip);

/**
 * The bucket an address counts against. IPv4 as itself; IPv6 by its /64,
 * because one household or phone is handed a whole /64 and could otherwise
 * rotate through addresses to dodge a limit.
 */
export function ipBucket(ip: string): string {
  if (!ip.includes(":")) return ip;
  const full = expandV6(ip);
  return full ? `${full.slice(0, 4).join(":")}::/64` : ip;
}

function expandV6(ip: string): string[] | null {
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail ? tail.split(":") : [];
  if (ip.includes("::")) {
    const fill = 8 - h.length - t.length;
    if (fill < 0) return null;
    return [...h, ...Array(fill).fill("0"), ...t].map((g) => g.toLowerCase());
  }
  return h.length === 8 ? h.map((g) => g.toLowerCase()) : null;
}
