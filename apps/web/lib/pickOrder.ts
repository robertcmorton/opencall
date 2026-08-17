/**
 * The order things are offered in, when somebody is choosing one.
 *
 * Lists that come back from the API arrive in whatever order the database
 * found them, which is stable but arbitrary — fine for a machine, useless for
 * a person hunting a name in a dropdown. A menu you have to read all of is a
 * menu that is too long.
 *
 * Kept in one place so every picker agrees: a company appearing third in one
 * list and seventh in another is its own small confusion, and these lists show
 * up beside each other on the same screen.
 */

/**
 * A to Z, the way a person reads it rather than the way bytes sort.
 *
 * `localeCompare` with `sensitivity: "base"` puts "acme" next to "Acme"
 * instead of sorting every capital letter ahead of every lowercase one, and
 * `numeric` keeps "Studio 2" ahead of "Studio 10", which plain string order
 * gets backwards.
 */
export function byName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
}

/**
 * Oldest first, which is the order a diary runs in.
 *
 * Dates are stored as `YYYY-MM-DD`, so comparing them as text is already
 * chronological — no parsing, and no timezone to get wrong, which matters here
 * because an event's date belongs to the event's own timezone and not to
 * whoever happens to be reading the list.
 *
 * Same-day events fall back to their name so the order is total: two events on
 * one date would otherwise sit in whichever order the API returned them, and
 * swap around between loads.
 */
export function byDate<T extends { startDate: string; name: string }>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
  );
}
