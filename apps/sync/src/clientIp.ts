import type { IncomingMessage } from "node:http";

type AnyRequest = Pick<IncomingMessage, "headers" | "socket"> | { headers: Headers | IncomingMessage["headers"] };

const headerOf = (req: AnyRequest, name: string): string | undefined => {
  const raw = req.headers instanceof Headers ? req.headers.get(name) : (req.headers[name] as string | string[] | undefined);
  return (Array.isArray(raw) ? raw.join(",") : raw) ?? undefined;
};

/**
 * Which header carries the visitor's address, when one can be trusted.
 *
 * On Railway it is X-Real-IP: the edge sets it to the address it saw on every
 * request, over anything the visitor sent. X-Forwarded-For is NOT the answer
 * there, and believing it was is how every entry in Account activity came to
 * read as one of Railway's own front-door servers (22 Oct 2026, found while
 * checking sign-ins after the hosting provider's security incident): behind
 * the current edge the right-most entry is the edge's address, so the owner's
 * Mac in Sydney showed as San Jose, a sign-in from a phone as Singapore, and
 * the sign-in attempt limit counted everyone arriving through one front door
 * as a single visitor.
 *
 * `CLIENT_IP_HEADER` names the header outright; on Railway (which sets
 * `RAILWAY_ENVIRONMENT_ID`) it defaults to x-real-ip.
 */
const trustedHeader = (env: NodeJS.ProcessEnv): string | null => {
  const named = env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (named) return named;
  return env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_ENVIRONMENT ? "x-real-ip" : null;
};

/**
 * The address a request really came from.
 *
 * Where a header is trusted (above), that. Otherwise X-Forwarded-For's
 * right-most entry — the one the nearest proxy appended; anything to its left
 * was written by the client and can say anything — and without either (local
 * development) the socket's own address.
 */
export function clientIp(req: AnyRequest, env: NodeJS.ProcessEnv = process.env): string {
  const trusted = trustedHeader(env);
  if (trusted && trusted !== "x-forwarded-for") {
    const value = headerOf(req, trusted)?.split(",")[0]?.trim();
    if (value) return normalise(value);
  }
  const header = headerOf(req, "x-forwarded-for");
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
