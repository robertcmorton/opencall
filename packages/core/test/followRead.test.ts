import { describe, expect, it } from "vitest";
import { followRead, type ReadRow } from "../src/live";

/**
 * The sheet that produced the bug: a long day where the words to be read are
 * a handful of rows scattered among sixty. Indices are positions in the FULL
 * sheet — that is the whole point, since the prompter only renders the reads.
 */
const reads: ReadRow[] = [
  { id: "welcome", index: 10 },
  { id: "openingRead", index: 11 },
  { id: "secondMatch", index: 39 },
];

describe("followRead", () => {
  it("holds nothing when no show is running", () => {
    expect(followRead({ liveIndex: -1, reads })).toEqual({ onAirId: null, followId: null });
  });

  it("holds nothing when the sheet has no reads at all", () => {
    expect(followRead({ liveIndex: 12, reads: [] })).toEqual({ onAirId: null, followId: null });
  });

  it("marks a read that is on air", () => {
    expect(followRead({ liveIndex: 11, reads })).toEqual({ onAirId: "openingRead", followId: "openingRead" });
  });

  // The regression. The live cue is the golden point period at row 22 — not a
  // read, so the old lookup by row id found no element and scrolled nowhere.
  it("follows the NEXT read when the live cue is not a read", () => {
    const r = followRead({ liveIndex: 22, reads });
    expect(r.onAirId).toBeNull();
    expect(r.followId).toBe("secondMatch");
  });

  it("shows the first read before the show reaches any of them", () => {
    expect(followRead({ liveIndex: 0, reads }).followId).toBe("welcome");
  });

  it("treats a read one row ahead as the next one", () => {
    expect(followRead({ liveIndex: 9, reads }).followId).toBe("welcome");
  });

  // Between two reads: the one behind is done, so the one ahead is what
  // matters. Picking the nearest by distance would hand back the wrong one.
  it("picks the read ahead, not the nearer one behind", () => {
    expect(followRead({ liveIndex: 38, reads }).followId).toBe("secondMatch");
    expect(followRead({ liveIndex: 12, reads }).followId).toBe("secondMatch");
  });

  // Once every read is behind, hold the last one. Falling back to the first
  // would throw the prompter to the top of the day during the closing minutes.
  it("holds the last read once they are all behind", () => {
    expect(followRead({ liveIndex: 40, reads }).followId).toBe("secondMatch");
    expect(followRead({ liveIndex: 200, reads }).followId).toBe("secondMatch");
  });

  it("holds the last read on the row straight after it", () => {
    expect(followRead({ liveIndex: 39, reads })).toEqual({ onAirId: "secondMatch", followId: "secondMatch" });
  });

  it("does not report a read as on air merely because it is next", () => {
    expect(followRead({ liveIndex: 22, reads }).onAirId).toBeNull();
  });
});
