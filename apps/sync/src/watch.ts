import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { schema, type DbHandle } from "@opencall/db";
import { describeDevice } from "@opencall/core";
import { audit } from "./audit.ts";
import { notify, quarterHour } from "./notices.ts";
import { placeOf } from "./place.ts";

/**
 * Watching for what doesn't belong (24 Oct 2026): the moments worth telling
 * an administrator about, checked as they happen. Each check is a query or
 * two and runs after the action it watches has been answered, so nobody
 * waits on it; none of them throws.
 *
 * What counts as unusual is deliberately plain — a device or country this
 * account has never signed in from, one address trying many accounts, one
 * account opening many sheets in minutes, two countries an hour apart. A
 * human reads the alert and decides; nothing here locks anyone out.
 */

const day = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
const hour = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 13);
const safely = (what: string, run: () => Promise<void>) => void run().catch((err) => console.error(`[watch] ${what} failed:`, err));

/**
 * A successful sign-in: from a device, or a country, this account has not
 * signed in from in the last 90 days? And another country within two hours?
 */
export function onSignIn(handle: DbHandle, user: { id: string; name: string }, ip: string, ua: string | null): void {
  safely("sign-in", async () => {
    const since = new Date(Date.now() - 90 * 86_400_000);
    const before = await handle.db
      .select({ at: schema.auditLog.at, ip: schema.auditLog.ip, detail: schema.auditLog.detail })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.actor, user.id), eq(schema.auditLog.action, "login.ok"), gte(schema.auditLog.at, since)))
      .limit(500);
    // The sign-in being checked is already in the log (it is recorded first);
    // only the ones before it say what is usual.
    const earlier = before.filter((b) => Date.now() - b.at.getTime() > 5_000);
    if (earlier.length === 0) return; // a first sign-in has nothing to differ from
    const device = describeDevice(ua).label;
    const where = placeOf(ip);
    const devices = new Set(earlier.map((b) => describeDevice(((b.detail as { ua?: string } | null)?.ua) ?? null).label));
    const countries = new Set(earlier.map((b) => placeOf(b.ip)?.country).filter((c): c is string => !!c));
    if (where && countries.size > 0 && !countries.has(where.country)) {
      notify(handle, {
        kind: "signin.new_country",
        urgent: true,
        title: `${user.name} signed in from a country they haven't before: ${where.place}`,
        body: `On ${device}. If that wasn't them, sign that device out from Users and change their password.`,
        userId: user.id,
        detail: { ip, place: where.place, device },
        key: `signin.new_country:${user.id}:${where.country}:${day()}`,
      });
    } else if (!devices.has(device)) {
      notify(handle, {
        kind: "signin.new_device",
        title: `${user.name} signed in on a new device: ${device}`,
        body: where ? `From ${where.place}.` : undefined,
        userId: user.id,
        detail: { ip, place: where?.place ?? null, device },
        key: `signin.new_device:${user.id}:${device}:${day()}`,
      });
    }
    // Two countries close together in time: the account may be in two hands.
    if (where) {
      const recent = earlier.filter((b) => Date.now() - b.at.getTime() < 2 * 3_600_000);
      const other = recent.map((b) => placeOf(b.ip)).find((p) => p && p.country !== where.country);
      if (other)
        notify(handle, {
          kind: "unusual.travel",
          urgent: true,
          title: `${user.name} signed in from ${where.place} and from ${other.place} within two hours`,
          body: "One person can't usually be in both places. Check with them, and if in doubt sign their devices out and change their password.",
          userId: user.id,
          detail: { ip, place: where.place, other: other.place },
          key: `unusual.travel:${user.id}:${hour()}`,
        });
    }
  });
}

/** A wrong password: has this address tried five or more different accounts this quarter-hour? */
export function onFailedSignIn(handle: DbHandle, ip: string): void {
  safely("failed sign-in", async () => {
    const res = await handle.db
      .select({ n: sql<number>`count(distinct ${schema.auditLog.target})` })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, "login.failed"), eq(schema.auditLog.ip, ip), gte(schema.auditLog.at, new Date(Date.now() - 15 * 60_000))));
    const n = Number(res[0]?.n ?? 0);
    if (n >= 5) {
      const where = placeOf(ip);
      notify(handle, {
        kind: "unusual.many_accounts",
        urgent: true,
        title: `One address tried ${n} different accounts in a quarter of an hour${where ? ` (${where.place})` : ""}`,
        body: "That is someone guessing, not someone who forgot their password. The address is already slowed down; nothing else is needed unless it keeps up.",
        detail: { ip, place: where?.place ?? null, accounts: n },
        key: `unusual.many_accounts:${ip}:${quarterHour()}`,
      });
    }
  });
}

/**
 * The server's admin code used from an address it hasn't been used from
 * before. The code is the one secret that works from anywhere on the
 * internet, so every new place it turns up is worth a look.
 */
const adminAddressesSeen = new Set<string>();
export function onAdminCode(handle: DbHandle, ip: string, ua: string | null): void {
  if (!ip || adminAddressesSeen.has(ip)) return;
  adminAddressesSeen.add(ip);
  safely("admin code", async () => {
    const known = await handle.db
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, "admin_code.new_address"), eq(schema.auditLog.ip, ip)))
      .limit(1);
    if (known.length > 0) return;
    audit(handle, { actor: "admin", action: "admin_code.new_address", ip, ua });
    const where = placeOf(ip);
    const device = describeDevice(ua).label;
    notify(handle, {
      kind: "admin_code.new_address",
      urgent: true,
      title: `The administrator code was used from a new address${where ? `: ${where.place}` : ""}`,
      body: `On ${device}. If this was you on a new connection, there's nothing to do. If not, change ADMIN_TOKEN in Railway at once — see the security guide.`,
      detail: { ip, place: where?.place ?? null, device },
      key: `admin_code.new_address:${ip}`,
    });
  });
}

/** One account opening ten or more different sheets in five minutes — reading everything, fast. */
export function onSheetOpened(handle: DbHandle, who: { userId: string | null; who: string | null }, deviceId: string | null): void {
  if (!who.userId && !deviceId) return;
  safely("sheets opened", async () => {
    const a = schema.activity;
    const res = await handle.db
      .select({ n: sql<number>`count(distinct ${a.rundownId})` })
      .from(a)
      .where(
        and(
          who.userId ? eq(a.userId, who.userId) : eq(a.deviceId, deviceId!),
          isNotNull(a.rundownId),
          inArray(a.kind, ["connect", "page"]),
          gte(a.at, new Date(Date.now() - 5 * 60_000)),
        ),
      );
    const n = Number(res[0]?.n ?? 0);
    if (n >= 10)
      notify(handle, {
        kind: "unusual.many_sheets",
        urgent: true,
        title: `${who.who ?? "One device"} opened ${n} different sheets in five minutes`,
        body: "People don't usually read that many sheets that fast. It can mean a copied sign-in being used to collect everything. Check the timeline for that person.",
        userId: who.userId,
        detail: { deviceId, sheets: n },
        key: `unusual.many_sheets:${who.userId ?? deviceId}:${hour()}`,
      });
  });
}

/** Something touched the trap — a page nothing real links to. */
export function onTrap(handle: DbHandle, path: string, ip: string, ua: string | null): void {
  const where = placeOf(ip);
  notify(handle, {
    kind: "trap",
    title: `Something tried ${path}${where ? ` from ${where.place}` : ""}`,
    body: `Nothing in OpenCall links there, so it was a program looking for a weakness. It got nothing. It called itself: ${describeDevice(ua).label}. One a day per address is shown.`,
    detail: { ip, place: where?.place ?? null, path },
    key: `trap:${ip}:${day()}`,
  });
}
