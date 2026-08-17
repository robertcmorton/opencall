import { describe, expect, it } from "vitest";
import { grantInScope, mergeGrants, refusedGrants, resolveGrants, type PeopleScope } from "../src/scope";

const ALPHA = "team_alpha";
const BETA = "team_beta";
const ALPHA_EVENT = "event_alpha_1";
const BETA_EVENT = "event_beta_1";

/** A company signed in as itself: one team, and the events that team owns. */
const alpha: PeopleScope = { all: false, teamIds: [ALPHA], eventIds: [ALPHA_EVENT] };
const admin: PeopleScope = { all: true };
/** An account an admin has put in charge of two companies. */
const both: PeopleScope = { all: false, teamIds: [ALPHA, BETA], eventIds: [ALPHA_EVENT, BETA_EVENT] };

describe("what a company may see", () => {
  it("shows a company its own grant and hides the other company's", () => {
    // One freelancer, two employers. Each employer may know about itself only:
    // that Sam also works for the competition is not theirs to be told.
    const samsGrants = [
      { kind: "company", targetId: ALPHA },
      { kind: "company", targetId: BETA },
    ];
    expect(samsGrants.filter((g) => grantInScope(alpha, g))).toEqual([{ kind: "company", targetId: ALPHA }]);
    expect(samsGrants.filter((g) => grantInScope(admin, g))).toHaveLength(2);
  });

  it("scopes event grants to the events the company owns", () => {
    expect(grantInScope(alpha, { kind: "event", targetId: ALPHA_EVENT })).toBe(true);
    expect(grantInScope(alpha, { kind: "view", targetId: ALPHA_EVENT })).toBe(true);
    expect(grantInScope(alpha, { kind: "event", targetId: BETA_EVENT })).toBe(false);
    expect(grantInScope(alpha, { kind: "view", targetId: BETA_EVENT })).toBe(false);
  });

  it("never lets a company make an administrator", () => {
    // Otherwise a company grants itself the whole installation, including
    // every other company on it.
    expect(grantInScope(alpha, { kind: "admin", targetId: "" })).toBe(false);
    expect(grantInScope(alpha, { kind: "admin", targetId: ALPHA })).toBe(false);
    expect(grantInScope(admin, { kind: "admin", targetId: "" })).toBe(true);
  });
});

describe("what a company may give", () => {
  it("reads 'everything at this company' as the company doing the inviting", () => {
    // The picker never showed an id, so none comes back. Resolving it to the
    // caller's own team is what keeps the commonest path in the UI working.
    expect(resolveGrants(alpha, [{ kind: "company", targetId: "" }])).toEqual([{ kind: "company", targetId: ALPHA }]);
  });

  it("does not guess a company for an admin, who has more than one", () => {
    expect(resolveGrants(admin, [{ kind: "company", targetId: "" }])).toEqual([{ kind: "company", targetId: "" }]);
    expect(refusedGrants(admin, resolveGrants(admin, [{ kind: "company", targetId: "" }]))).toHaveLength(0);
  });

  it("refuses the whole request rather than quietly dropping the bad part", () => {
    // The failure this prevents: a company adds a freelancer to two events,
    // owns one of them, is told it worked, and finds out at the venue.
    const mixed = resolveGrants(alpha, [
      { kind: "event", targetId: ALPHA_EVENT },
      { kind: "event", targetId: BETA_EVENT },
    ]);
    expect(refusedGrants(alpha, mixed)).toEqual([{ kind: "event", targetId: BETA_EVENT }]);
  });

  it("passes a request that is entirely within scope", () => {
    const ok = resolveGrants(alpha, [
      { kind: "company", targetId: "" },
      { kind: "event", targetId: ALPHA_EVENT },
    ]);
    expect(refusedGrants(alpha, ok)).toEqual([]);
  });

  it("treats a missing targetId as absent rather than as a wildcard", () => {
    // An event grant with no id must not match the first event in scope.
    expect(grantInScope(alpha, { kind: "event", targetId: "" })).toBe(false);
    expect(refusedGrants(alpha, resolveGrants(alpha, [{ kind: "event" }]))).toHaveLength(1);
  });
});

/**
 * Editing access, without destroying what the editor cannot see.
 *
 * The dangerous version of this feature is one line long — delete every grant
 * for this person, insert what the form sent — and it is right for an
 * administrator and ruinous for everybody else. These pin the difference.
 */
describe("editing a person's access", () => {
  it("leaves a rival employer alone when a company clears everything", () => {
    // Alpha saves Sam with no access at all. Sam also works for Beta, which
    // Alpha has never been shown. Beta's grant must survive.
    const { keep, remove, add } = mergeGrants(
      alpha,
      [
        { kind: "company", targetId: ALPHA },
        { kind: "company", targetId: BETA },
      ],
      [],
    );
    expect(keep).toEqual([{ kind: "company", targetId: BETA }]);
    expect(remove).toEqual([{ kind: "company", targetId: ALPHA }]);
    expect(add).toEqual([]);
  });

  it("never demotes an administrator who also works for the company", () => {
    const { keep, remove } = mergeGrants(
      alpha,
      [
        { kind: "admin", targetId: "" },
        { kind: "company", targetId: ALPHA },
      ],
      [{ kind: "company", targetId: ALPHA }],
    );
    expect(remove).toEqual([]);
    expect(keep).toContainEqual({ kind: "admin", targetId: "" });
  });

  it("does not remove an event belonging to a company it cannot see", () => {
    const { remove, keep } = mergeGrants(
      alpha,
      [
        { kind: "company", targetId: ALPHA },
        { kind: "event", targetId: BETA_EVENT },
      ],
      [{ kind: "company", targetId: ALPHA }],
    );
    expect(remove).toEqual([]);
    expect(keep).toEqual([{ kind: "event", targetId: BETA_EVENT }]);
  });

  it("still replaces everything for an admin, exactly as before", () => {
    const { keep, remove } = mergeGrants(
      admin,
      [
        { kind: "company", targetId: ALPHA },
        { kind: "company", targetId: BETA },
        { kind: "admin", targetId: "" },
      ],
      [],
    );
    expect(keep).toEqual([]);
    expect(remove).toHaveLength(3);
  });

  it("changes nothing when nothing changed", () => {
    const m = mergeGrants(alpha, [{ kind: "event", targetId: ALPHA_EVENT }], [{ kind: "event", targetId: ALPHA_EVENT }]);
    expect(m.add).toEqual([]);
    expect(m.remove).toEqual([]);
  });

  it("inserts a repeated grant once", () => {
    // The composite primary key is (userId, kind, targetId); inserting the
    // same tuple twice in one save would throw half way through.
    const { add } = mergeGrants(alpha, [], [
      { kind: "event", targetId: ALPHA_EVENT },
      { kind: "event", targetId: ALPHA_EVENT },
    ]);
    expect(add).toHaveLength(1);
  });

  it("ignores a body naming a grant the caller cannot see", () => {
    // A crafted payload must not be able to delete or re-create somebody
    // else's access by naming it.
    const m = mergeGrants(alpha, [{ kind: "company", targetId: BETA }], [{ kind: "company", targetId: BETA }]);
    expect(m.add).toEqual([]);
    expect(m.remove).toEqual([]);
    expect(m.keep).toEqual([{ kind: "company", targetId: BETA }]);
  });

  // The two invariants the whole design rests on. Stated over a mixed set
  // rather than one arrangement, because the failure this prevents is the kind
  // nobody sees: the company that did the damage was never shown the damage.
  const mixed = [
    { kind: "admin", targetId: "" },
    { kind: "company", targetId: ALPHA },
    { kind: "company", targetId: BETA },
    { kind: "event", targetId: ALPHA_EVENT },
    { kind: "event", targetId: BETA_EVENT },
  ];

  it("keeps only what is out of scope, whatever was asked for", () => {
    for (const desired of [[], mixed, [{ kind: "company", targetId: ALPHA }]]) {
      for (const g of mergeGrants(alpha, mixed, desired).keep) {
        expect(grantInScope(alpha, g)).toBe(false);
      }
    }
  });

  it("only ever removes rows that were already there", () => {
    for (const desired of [[], [{ kind: "event", targetId: ALPHA_EVENT }]]) {
      for (const g of mergeGrants(alpha, mixed, desired).remove) {
        expect(mixed).toContainEqual(g);
      }
    }
  });
});

describe("an account holding two companies", () => {
  it("reaches both, and still makes no administrators", () => {
    expect(grantInScope(both, { kind: "company", targetId: ALPHA })).toBe(true);
    expect(grantInScope(both, { kind: "company", targetId: BETA })).toBe(true);
    expect(grantInScope(both, { kind: "admin", targetId: "" })).toBe(false);
  });

  it("is not guessed for when it leaves the company unnamed", () => {
    // teamIds[0] is Postgres row order, not a decision. Under the merge rules
    // guessing would edit the wrong company's slice of somebody's access.
    expect(resolveGrants(both, [{ kind: "company", targetId: "" }])).toEqual([{ kind: "company", targetId: "" }]);
  });

  it("still fills the blank in for an account holding exactly one", () => {
    expect(resolveGrants(alpha, [{ kind: "company", targetId: "" }])).toEqual([{ kind: "company", targetId: ALPHA }]);
  });
});

describe("kinds nobody has defined", () => {
  it("refuses an invented kind even when it names a reachable event", () => {
    expect(grantInScope(alpha, { kind: "owner", targetId: ALPHA_EVENT })).toBe(false);
  });

  it("does not narrow what an admin may do", () => {
    expect(grantInScope(admin, { kind: "owner", targetId: "" })).toBe(true);
  });
});
