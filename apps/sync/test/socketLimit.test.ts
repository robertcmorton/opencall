import { describe, expect, it } from "vitest";
import { SocketCounter, SOCKETS_PER_ADDRESS } from "../src/socketLimit";
import { postPinned } from "../src/cueSignals";

describe("open connections per address (24 Oct)", () => {
  it("allows up to the most, then says no until one closes", () => {
    const c = new SocketCounter(3);
    expect([c.tryTake("a"), c.tryTake("a"), c.tryTake("a"), c.tryTake("a")]).toEqual([true, true, true, false]);
    expect(c.tryTake("b")).toBe(true); // another address is not affected
    c.give("a");
    expect(c.tryTake("a")).toBe(true);
    expect(c.held("a")).toBe(3);
  });
  it("forgets an address once everything it held has closed", () => {
    const c = new SocketCounter(2);
    c.tryTake("a");
    c.give("a");
    c.give("a"); // a close counted twice must not go negative
    expect(c.held("a")).toBe(0);
    expect([c.tryTake("a"), c.tryTake("a"), c.tryTake("a")]).toEqual([true, true, false]);
  });
  it("is room for a whole crew on one venue's Wi-Fi", () => {
    expect(SOCKETS_PER_ADDRESS).toBeGreaterThanOrEqual(150);
  });
});

describe("a webhook goes only to the address that was checked (24 Oct)", () => {
  it("refuses a name that leads to a private address, at the moment of connecting", async () => {
    await expect(postPinned("https://localhost:9/hook", { headers: {}, body: "{}", signal: AbortSignal.timeout(3000) })).rejects.toThrow(/private network/);
  });
});
