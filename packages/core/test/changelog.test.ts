import { describe, expect, it } from "vitest";
import { parseChangelog } from "../src";

const SAMPLE = `# Changelog

Some preamble that is not an entry.

## [Unreleased]

### Fixed
- **A tooltip appears next to the thing it explains.** The bar was centred with
  a transform, and a transformed element becomes the frame of reference.

  A second paragraph of detail, after a blank line.

### Added
- **The prompter follows the walkthrough too.** It followed a live cue only.

## [0.36.0] - 2026-08-28

### Changed
- Something written without a bold lead. It has a second sentence too.
`;

describe("parseChangelog", () => {
  it("takes the bold opening sentence as the headline", () => {
    const [unreleased] = parseChangelog(SAMPLE);
    expect(unreleased!.version).toBe("Unreleased");
    expect(unreleased!.entries[0]).toMatchObject({
      kind: "Fixed",
      headline: "A tooltip appears next to the thing it explains",
    });
  });

  it("keeps the detail paragraphs that come after a blank line", () => {
    // A blank line separates the paragraphs WITHIN one entry; only the next
    // bullet or heading ends it. Stopping at the blank line would throw away
    // most of what every entry in this project actually says.
    const detail = parseChangelog(SAMPLE)[0]!.entries[0]!.detail;
    expect(detail).toContain("frame of reference");
    expect(detail).toContain("second paragraph of detail");
  });

  it("keeps each entry under the heading it was written below", () => {
    const kinds = parseChangelog(SAMPLE)[0]!.entries.map((e) => e.kind);
    expect(kinds).toEqual(["Fixed", "Added"]);
  });

  it("reads a released version and its date", () => {
    const released = parseChangelog(SAMPLE)[1]!;
    expect(released.version).toBe("0.36.0");
    expect(released.date).toBe("2026-08-28");
  });

  it("falls back to the first sentence when an entry has no bold lead", () => {
    expect(parseChangelog(SAMPLE)[1]!.entries[0]).toMatchObject({
      headline: "Something written without a bold lead",
      detail: "It has a second sentence too.",
    });
  });

  it("strips the markdown rather than showing it", () => {
    const md = "## [Unreleased]\n\n### Fixed\n- **A `code` word and a [link](http://x).** With **bold** inside.\n";
    const e = parseChangelog(md)[0]!.entries[0]!;
    expect(e.headline).toBe("A code word and a link");
    expect(e.detail).toBe("With bold inside.");
  });

  it("ignores the preamble above the first version", () => {
    expect(parseChangelog(SAMPLE).every((r) => r.entries.every((e) => !e.headline.includes("preamble")))).toBe(true);
  });

  it("stops once it has enough to read, rather than returning the whole history", () => {
    const many = ["## [Unreleased]", "### Fixed", ...Array.from({ length: 100 }, (_, i) => `- **Entry ${i}.** detail`)].join("\n");
    expect(parseChangelog(many, 10)[0]!.entries).toHaveLength(100); // the release it is inside is kept whole
    const two = `## [a]\n### Fixed\n- **One.** x\n\n## [b]\n### Fixed\n- **Two.** y\n`;
    expect(parseChangelog(two, 1).map((r) => r.version)).toEqual(["a"]);
  });
});
