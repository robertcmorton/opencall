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
  return scope.eventIds.includes(g.targetId);
}

/**
 * Fill in what the caller had no way to name.
 *
 * "Everything at this company" is chosen from a menu that never showed an id,
 * because a company signed in as itself has exactly one and being asked which
 * would be a strange question. So the id arrives empty and is resolved here,
 * to the caller's own company — never to a company it merely mentioned.
 *
 * An admin gets no such favour: `all` scope means an empty company id really
 * is ambiguous, and guessing on behalf of somebody who can reach every company
 * is how access ends up somewhere nobody chose.
 */
export function resolveGrants(scope: PeopleScope, asked: { kind: unknown; targetId?: unknown }[]): Grant[] {
  return asked.map((g) => {
    const kind = String(g.kind);
    const targetId = String(g.targetId ?? "");
    if (kind === "company" && !targetId && !scope.all) return { kind, targetId: scope.teamIds[0]! };
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
