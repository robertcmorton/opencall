import { describe, expect, it } from "vitest";
import { formatTimeOfDayWithDay } from "../src/format";

const H = 3600;

describe("formatTimeOfDayWithDay", () => {
  it("says nothing extra on a same-day sheet", () => {
    expect(formatTimeOfDayWithDay(9 * H, true)).toBe("09:00:00");
    expect(formatTimeOfDayWithDay(23 * H + 59 * 60, true)).toBe("23:59:00");
  });

  // The case that prompted this: 48 hours of running order, ending at
  // midnight two days out, printed as though it finished tonight.
  it("names the day once the sheet has run past midnight", () => {
    expect(formatTimeOfDayWithDay(24 * H, true)).toBe("00:00:00 +1d");
    expect(formatTimeOfDayWithDay(25 * H, true)).toBe("01:00:00 +1d");
    expect(formatTimeOfDayWithDay(48 * H, true)).toBe("00:00:00 +2d");
    expect(formatTimeOfDayWithDay(72 * H + 30 * 60, true)).toBe("00:30:00 +3d");
  });

  it("carries the day through the 12-hour clock too", () => {
    expect(formatTimeOfDayWithDay(48 * H, false)).toBe("12:00:00 AM +2d");
  });

  it("treats the last second before midnight as the same day", () => {
    expect(formatTimeOfDayWithDay(86399, true)).toBe("23:59:59");
    expect(formatTimeOfDayWithDay(86400, true)).toBe("00:00:00 +1d");
  });
});
