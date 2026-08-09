import { describe, expect, it } from "vitest";
import { grantInScope, refusedGrants, resolveGrants, type PeopleScope } from "../src/scope";

const ALPHA = "team_alpha";
const BETA = "team_beta";
const ALPHA_EVENT = "event_alpha_1";
const BETA_EVENT = "event_beta_1";

/** A company signed in as itself: one team, and the events that team owns. */
const alpha: PeopleScope = { all: false, teamIds: [ALPHA], eventIds: [ALPHA_EVENT] };
const admin: PeopleScope = { all: true };

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
