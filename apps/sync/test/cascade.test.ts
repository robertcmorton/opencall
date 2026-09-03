import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every table that points at a company, an event or a run sheet must be
 * named in the code that deletes one — or the database refuses the delete
 * and the dashboard button, until tonight, said nothing.
 *
 * This is the bug that reached production on 3 September 2026: invitations,
 * kinds of show, folders, files and per-person sheet preferences had all been
 * added since the cascade was written, and none of them had been added TO it.
 * Deleting "The Showcaller" failed on the first of them, and would then have
 * failed on each of the others in turn.
 *
 * Read from the source rather than run against a database, so that it runs
 * everywhere, every time, with no Postgres. It is deliberately dumb: a table
 * whose foreign key does not say ON DELETE CASCADE must have its export name
 * appear in the delete helpers. Adding a table that points at one of the
 * three and forgetting the cascade fails here before it fails on production.
 */
const schema = readFileSync(new URL("../../../packages/db/src/schema.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");

/** [export name, column line] for every FK to one of the three parents that the database will not cascade itself. */
function foreignKeysTo(parent: "teams" | "events" | "rundowns"): string[] {
  const out: string[] = [];
  let current: string | null = null;
  for (const line of schema.split("\n")) {
    const table = /^export const (\w+) = pgTable\(/.exec(line);
    if (table) current = table[1]!;
    const ref = new RegExp(`references\\(\\(\\) => ${parent}\\.id`).exec(line);
    if (ref && current && !/onDelete:\s*"cascade"/.test(line)) out.push(current);
  }
  return out;
}

/** The text of one delete helper or route, from its first line to its closing brace. */
function block(startMarker: string): string {
  const at = api.indexOf(startMarker);
  expect(at, `${startMarker} exists in api.ts`).toBeGreaterThan(-1);
  const rest = api.slice(at);
  // The helpers are `const x = async (...) => { ... };` and the route is an
  // if-block; both end at the first line that is just `};` or `}` at their
  // own indentation. Reading to the next top-level marker is close enough.
  const end = rest.search(/\n {4}(?:const \w+ = async|try \{|\/\/ ── )/);
  return end > 0 ? rest.slice(0, end) : rest;
}

const deleteRundown = block("const deleteRundown = async");
const deleteEvent = block("const deleteEvent = async");
const deleteCompany = (() => {
  const at = api.indexOf('req.method === "DELETE" && /^\\/companies\\/[^/]+$/');
  expect(at, "the company delete route exists").toBeGreaterThan(-1);
  // Not the first `return true;` — that is the admin gate on the next line.
  // The route ends where it answers.
  return api.slice(at, api.indexOf("json(res, 200, { id });", at));
})();

describe("every table that points at a parent is deleted with it", () => {
  it("run sheets: nothing points at a sheet that deleteRundown does not remove", () => {
    const tables = foreignKeysTo("rundowns").filter((t) => t !== "rundowns");
    expect(tables.length).toBeGreaterThan(3);
    for (const t of tables) expect(deleteRundown, `deleteRundown removes ${t}`).toContain(`schema.${t}`);
  });

  it("events: nothing points at an event that deleteEvent does not remove", () => {
    const tables = foreignKeysTo("events").filter((t) => t !== "events");
    expect(tables.length).toBeGreaterThan(2);
    for (const t of tables) expect(deleteEvent, `deleteEvent removes ${t}`).toContain(`schema.${t}`);
  });

  it("companies: nothing points at a company that the company route does not remove", () => {
    const tables = foreignKeysTo("teams").filter((t) => t !== "teams" && t !== "events");
    expect(tables.length).toBeGreaterThan(3);
    for (const t of tables) expect(deleteCompany, `company route removes ${t}`).toContain(`schema.${t}`);
    // and the events under it go through the shared helper, not a private copy
    expect(deleteCompany).toContain("deleteEvent(");
  });

  it("the company route also drops the grants that pointed at the company", () => {
    // Not a foreign key — grants store a bare target id — which is exactly why
    // this one has to be said out loud rather than found by the scan above.
    expect(deleteCompany).toContain("schema.userGrants");
    expect(deleteEvent).toContain("schema.userGrants");
  });
});
