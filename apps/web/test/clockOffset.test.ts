import { describe, expect, it } from "vitest";
import { clockOffset } from "../lib/clockOffset";

describe("clockOffset", () => {
  it("is a ping's sum when the server's two stamps are equal", () => {
    // t0 = 1000 on the device, t1 = 5100 on the server, back at 1200:
    // offset = t1 + rtt/2 − now = 5100 + 100 − 1200.
    expect(clockOffset(1000, 5100, 5100, 1200)).toBe(4000);
  });

  it("leaves out the time the server spent on a hello", () => {
    // Server is 4000 ahead; 85 ms each way; 60 ms of sign-in and lookups.
    const sent = 1000;
    const arrived = sent + 85 + 4000;
    const left = arrived + 60;
    const received = left - 4000 + 85;
    expect(clockOffset(sent, arrived, left, received)).toBe(4000);
    // Counting the 60 ms as travel, as one stamp alone would, is 30 ms out.
    expect(left + (received - sent) / 2 - received).toBe(4030);
  });

  it("works with the server behind the device", () => {
    expect(clockOffset(10_000, 7_090, 7_100, 10_190)).toBe(-3000);
  });
});
