/**
 * Who may administer whom, as rules rather than as code inside a request.
 *
 * Crew are freelancers. The same person works for several production companies
 * in the same month, and every one of those grants lives in one table. So the
 * question "what may this company see about this person" has a wrong answer
 * that looks perfectly reasonable: all of it. Showing one company that its
 * camera operator also works for a rival is not a display bug to be tidied up
 * in the UI — it is a disclosure, and the only place to prevent it is before
 * the data is sent.
 *
 * These functions are pure and exported so the rules can be tested directly.
 * They were closures inside the /people handler, which meant the only way to
 * check them was to stand up a server and read the JSON — so in practice they
 * were checked once, by hand, and never again.
 */

/** The slice of the world a caller may administer people within. */
export type PeopleScope = { all: true } | { all: false; teamIds: string[]; eventIds: string[] };

export interface Grant {
  kind: string;
  targetId: string;
}

/**
 * May this grant be seen, given, or taken away by this caller?
 *
 * Deliberately the same test for all three. A company that can see a grant it
 * cannot revoke, or hand out access it cannot see, is a rule with a seam in
 * it, and seams are where this sort of thing goes wrong.
 */
export function grantInScope(scope: PeopleScope, g: Grant): boolean {
  if (scope.all) return true;
  // Only an admin makes admins. A company handing out `admin` would be a
  // company granting itself the whole installation.
  if (g.kind === "admin") return false;
  if (g.kind === "company") return scope.teamIds.includes(g.targetId);
  // Named kinds only. This used to end in a bare `return scope.eventIds
  // .includes(...)`, which reads as "events" but actually means "anything that
  // is not admin or company" — so a kind nobody has written yet, or one made
  // up in a request body, was allowed the moment it quoted an event this
  // caller could reach. Refusing by default costs one line and means a new
  // kind has to be let in deliberately.
  if (g.kind === "event" || g.kind === "view") return scope.eventIds.includes(g.targetId);
  return false;
}

/**
 * Fill in what the caller had no way to name.
 *
 * "Everything at this company" is chosen from a menu that never showed an id,
 * so the id arrives empty and is resolved here — to the caller's own company,
 * never to a company it merely mentioned.
 *
 * ONLY when there is exactly one it could mean. An account may hold several
 * companies, and this used to answer `teamIds[0]` for those too: not a choice
 * but Postgres row order, and one that sailed through the refusal check
 * because the id really is held. Under the merge rules below that is worse
 * than a wrong label — it edits the wrong company's slice of somebody's
 * access. A caller with two companies is asked which, and the handler's
 * existing 400 catches the blank.
 *
 * An admin gets no such favour either: `all` scope means an empty company id
 * really is ambiguous, and guessing on behalf of somebody who can reach every
 * company is how access ends up somewhere nobody chose.
 */
export function resolveGrants(scope: PeopleScope, asked: { kind: unknown; targetId?: unknown }[]): Grant[] {
  return asked.map((g) => {
    const kind = String(g.kind);
    const targetId = String(g.targetId ?? "");
    if (kind === "company" && !targetId && !scope.all && scope.teamIds.length === 1)
      return { kind, targetId: scope.teamIds[0]! };
    return { kind, targetId };
  });
}

/**
 * The grants in this request that the caller may not give.
 *
 * The caller of this decides what to do about them, and the answer is always
 * to refuse the whole request. Carrying out the allowed part of a request and
 * quietly dropping the rest reports success for something that did not happen:
 * a company that tried to add a freelancer to two events and was entitled to
 * one would be told it worked, and would find out at the venue.
 */
export const refusedGrants = (scope: PeopleScope, grants: Grant[]): Grant[] =>
  grants.filter((g) => !grantInScope(scope, g));

/** What an edit does: what to add, what to take away, and what was never the
 *  editor's business. */
export interface GrantMerge {
  add: Grant[];
  remove: Grant[];
  /** Outside this caller's scope — carried through untouched. */
  keep: Grant[];
}

const grantKey = (g: Grant): string => `${g.kind}:${g.targetId}`;

/**
 * What a person's access should become, given what it is and what was asked.
 *
 * The asked-for list describes ONLY the slice the editor can see, because that
 * is the only slice they were ever shown. This is the whole reason the
 * function exists. The obvious implementation of an editable grant list —
 * delete everything for this person, insert what the form sent — is correct
 * for an administrator and catastrophic for anybody else: the same freelancer
 * works for four companies in a month, and a company saving a rota it was
 * shown three rows of would silently delete the fourth. Nobody would notice,
 * least of all the company that did it, because it was never allowed to see
 * what it destroyed.
 *
 * So `keep` is untouchable by construction, and `remove` is drawn only from
 * rows that were both already there AND in scope. Deletions are therefore a
 * conclusion the server reaches about rows it read itself, never an
 * instruction it was handed — a client that sends a list of things to delete
 * would walk straight back into the same hole through the front door.
 *
 * For an administrator `keep` is empty, so this collapses to the full replace
 * that already happens today: one path for both, and no admin behaviour
 * changes.
 *
 * The caller still owes `resolveGrants` and `refusedGrants` first — this
 * decides WHAT CHANGES, not who is allowed to change it. It re-filters
 * anyway, so a forgotten check cannot turn into a write out of scope.
 */
export function mergeGrants(scope: PeopleScope, existing: Grant[], desired: Grant[]): GrantMerge {
  const keep = existing.filter((g) => !grantInScope(scope, g));
  const mine = existing.filter((g) => grantInScope(scope, g));
  // A Map, so a body that names the same grant twice cannot try to insert it
  // twice and break the (userId, kind, targetId) primary key half way through.
  const wanted = new Map(desired.filter((g) => grantInScope(scope, g)).map((g) => [grantKey(g), g]));
  const held = new Set(mine.map(grantKey));
  return {
    keep,
    remove: mine.filter((g) => !wanted.has(grantKey(g))),
    add: [...wanted.values()].filter((g) => !held.has(grantKey(g))),
  };
}
