import { describe, expect, it } from "vitest";
import { clientIp, ipBucket } from "../src/clientIp";

const req = (xff: string | undefined, remote = "10.0.0.9") =>
  ({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: remote } }) as never;

describe("client address", () => {
  it("trusts only the right-most forwarded address (the one the edge appended)", () => {
    expect(clientIp(req("1.2.3.4, 203.0.113.7"))).toBe("203.0.113.7");
  });
  it("ignores a client trying to claim another address in front", () => {
    expect(clientIp(req("127.0.0.1, 198.51.100.20"))).toBe("198.51.100.20");
  });
  it("falls back to the socket without the header, unwrapping IPv4-mapped addresses", () => {
    expect(clientIp(req(undefined, "::ffff:192.0.2.5"))).toBe("192.0.2.5");
  });
  it("reads a fetch Headers object too (the document socket's request)", () => {
    expect(clientIp({ headers: new Headers({ "x-forwarded-for": "9.9.9.9, 8.8.8.8" }) })).toBe("8.8.8.8");
  });
  it("groups IPv6 by /64 and leaves IPv4 alone", () => {
    expect(ipBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("203.0.113.7")).toBe("203.0.113.7");
  });
});
