import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { isIP } from "node:net";
import { Reader, type CityResponse } from "mmdb-lib";

/**
 * Where an address is, in words: "Sydney, Australia" (24 Oct 2026).
 *
 * Worked out on this server, never by asking anyone else: the lookup table is
 * DB-IP's free "IP to City Lite" file (CC BY 4.0 — the timeline credits it),
 * fetched once when the server starts and read from memory after that. The
 * addresses themselves never leave the server.
 *
 * Optional by design. Until the file has arrived — or if it never does — every
 * lookup answers null and everything that records an address carries on
 * without a place. Off outside production unless GEO_LOOKUP=1, so tests and
 * local runs make no downloads.
 *
 * A city from an address is a guess: right for a home connection more often
 * than not, often wrong for a phone, whose address belongs to wherever its
 * network hands traffic out. Good enough to notice "a sign-in from another
 * country", never proof of where somebody is.
 */
export interface Place {
  /** "Sydney, Australia", or just "Australia". */
  place: string;
  /** "AU". */
  country: string;
}

let reader: Reader<CityResponse> | null = null;

const monthOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** Start fetching the table; resolves when it is ready or has failed. Never throws. */
export async function loadPlaces(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const wanted = env.GEO_LOOKUP === "1" || (env.GEO_LOOKUP !== "0" && Boolean(env.RAILWAY_ENVIRONMENT_ID ?? env.RAILWAY_ENVIRONMENT));
  if (!wanted || reader) return;
  const dir = join(tmpdir(), "opencall-places");
  try {
    mkdirSync(dir, { recursive: true });
    const now = new Date();
    // This month's file appears a day or two in; last month's is always there.
    const months = [monthOf(now), monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)))];
    for (const month of months) {
      const file = join(dir, `dbip-city-lite-${month}.mmdb`);
      if (!existsSync(file)) {
        const res = await fetch(`https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz`, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok || !res.body) continue;
        const part = `${file}.part`;
        await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createGunzip(), createWriteStream(part));
        renameSync(part, file);
      }
      reader = new Reader<CityResponse>(readFileSync(file));
      console.log(`[places] address lookups ready (DB-IP City Lite ${month})`);
      return;
    }
    console.warn("[places] no address table could be fetched; places will be blank");
  } catch (err) {
    console.warn("[places] address table unavailable; places will be blank:", err instanceof Error ? err.message : err);
  }
}

/** For tests: use a table already in memory. */
export const usePlaceTable = (table: Reader<CityResponse> | null): void => {
  reader = table;
};

/** Private, loopback and link-local addresses have no place. */
const isPublic = (ip: string): boolean => {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return !(a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a === 0);
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return !(lower === "::1" || lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd"));
  }
  return false;
};

/** The place an address is in, or null when it can't be told. */
export function placeOf(ip: string | null | undefined): Place | null {
  if (!reader || !ip) return null;
  // An IPv4 address written the IPv6 way (::ffff:1.2.3.4).
  const bare = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (!isPublic(bare)) return null;
  try {
    const hit = reader.get(bare);
    const country = hit?.country?.names?.en;
    const code = hit?.country?.iso_code;
    if (!country || !code) return null;
    const city = hit?.city?.names?.en;
    return { place: city ? `${city}, ${country}` : country, country: code };
  } catch {
    return null;
  }
}
