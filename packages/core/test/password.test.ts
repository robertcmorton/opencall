import { describe, expect, it } from "vitest";
import { passwordProblem, PASSWORD_MIN } from "../src/password";

describe("password rule", () => {
  it("accepts a long, varied password", () => {
    expect(passwordProblem("correct horse battery staple", "sam@example.com")).toBeNull();
  });
  it(`refuses anything under ${PASSWORD_MIN} characters`, () => {
    expect(passwordProblem("short1!", null)).toMatch(/at least 12/);
  });
  it("refuses over 200 characters", () => {
    expect(passwordProblem("ab3$x".repeat(41), null)).toMatch(/at most 200/);
  });
  it("refuses too few different characters", () => {
    expect(passwordProblem("aaaaaaaaaaaabbbb", null)).toMatch(/5 different/);
  });
  it("refuses the name part of the email address", () => {
    expect(passwordProblem("RobertMorton2026!", "robertmorton@example.com")).toMatch(/email/);
  });
  it("ignores a very short email name (too common to forbid)", () => {
    expect(passwordProblem("bob-is-not-here-123", "bob@example.com")).toBeNull();
  });
});
