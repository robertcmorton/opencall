import { eq, isNull, or } from "drizzle-orm";
import { schema, type Db } from "@opencall/db";
import { eventType, isCustomEventType, type EventTypeSpec } from "@opencall/core";

/**
 * The kinds of show a company may choose from, beyond the built-in list.
 *
 * A company sees its own plus anything an administrator added for the whole
 * installation (`team_id IS NULL`). It does not see another company's — a list
 * of the formats a production house runs is a small thing, but it is theirs.
 */
export async function customEventTypes(
  db: Db,
  teamId: string | null | undefined,
): Promise<(EventTypeSpec & { rowId: string; own: boolean })[]> {
  const rows = await db.query.customEventTypes.findMany({
    where: teamId
      ? or(isNull(schema.customEventTypes.teamId), eq(schema.customEventTypes.teamId, teamId))
      : isNull(schema.customEventTypes.teamId),
  });
  // `id` is the CODE, because that is what a sheet stores and what everything
  // resolves against. Removing one needs the row it lives in, which is a
  // different identifier — sending only the code left the delete endpoint with
  // no caller that could reach it. `own` is false for the installation-wide
  // ones a company may use but must not delete.
  return rows.map((r) => ({ ...rowToSpec(r), rowId: r.id, own: Boolean(teamId) && r.teamId === teamId }));
}

export const rowToSpec = (r: typeof schema.customEventTypes.$inferSelect): EventTypeSpec => ({
  id: r.code,
  label: r.label,
  group: "Yours",
  fullTime: r.fullTime,
  afterExtra: r.afterExtra,
  extraLabel: r.extraLabel,
  resultDuePhrases: r.resultDuePhrases,
  blurb: r.blurb,
});

/**
 * The one definition a live screen needs, or nothing.
 *
 * Only looked up when the sheet actually uses a custom type: the built-in ones
 * are already in the client's own copy of the list, and a database round trip
 * on every connection to re-send what it already has would be a cost paid by
 * every phone on the venue wifi.
 */
export async function customEventTypeSpec(
  db: Db,
  code: string | null | undefined,
  teamId: string | null | undefined,
): Promise<EventTypeSpec | null> {
  if (!code || !isCustomEventType(code) || eventType(code)) return null;
  const row = await db.query.customEventTypes.findFirst({ where: eq(schema.customEventTypes.code, code) });
  if (!row) return null;
  // A type belonging to another company is not applied merely because a sheet
  // names it; installation-wide ones (no team) are fair game for everybody.
  if (row.teamId && teamId && row.teamId !== teamId) return null;
  return rowToSpec(row);
}
