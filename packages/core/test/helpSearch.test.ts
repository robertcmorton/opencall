import { describe, expect, it } from "vitest";
import { helpContents, helpShortcutsText, helpTopic, searchHelp } from "../src/helpSearch";

/** The Help page, as the AI connector reads it (20 Oct). */
describe("searching Help", () => {
  it("finds the topic a person would ask about, best first", () => {
    const hits = searchHelp("end walkthrough");
    expect(hits[0]?.id).toBe("walkthrough");
    expect(hits[0]?.text).toContain("tap the lit **Walkthrough** label");
  });
  it("needs every word, so a question narrows rather than widens", () => {
    expect(searchHelp("walkthrough zzzqqq")).toEqual([]);
    expect(searchHelp("")).toEqual([]);
  });
  it("reads one topic in full by id, and nothing for an unknown id", () => {
    expect(helpTopic("start-time")?.text).toContain("Move them all");
    expect(helpTopic("no-such-topic")).toBeNull();
  });
  it("lists every section and topic, and the shortcuts", () => {
    const contents = helpContents();
    expect(contents.length).toBeGreaterThan(5);
    expect(contents.flatMap((s) => s.topics).some((t) => t.id === "notes")).toBe(true);
    expect(helpShortcutsText()).toContain("Keyboard shortcuts:");
  });
  it("every topic id is unique — they are the page's link targets", () => {
    const ids = helpContents().flatMap((s) => s.topics.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
