import { describe, expect, it } from "vitest";
import { describeDevice } from "../src/device";

/** Real user agents, as the devices a crew uses actually send them. */
const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  iphoneInApp: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  ipadSafari: "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15",
  macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.6; rv:144.0) Gecko/20100101 Firefox/144.0",
  // Seen in the error log on 21 Oct 2026: the Claude desktop app's own browser.
  claudeApp: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/2.42304.2 Chrome/152.0.797",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  androidChrome: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  androidSamsung: "Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  chromebook: "Mozilla/5.0 (X11; CrOS x86_64 16181.61.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0",
};

describe("what a device is, in words", () => {
  it.each([
    ["iphoneSafari", "iPhone · Safari", "phone"],
    ["iphoneChrome", "iPhone · Chrome", "phone"],
    ["iphoneInApp", "iPhone · an app's own browser", "phone"],
    ["ipadSafari", "iPad · Safari", "tablet"],
    ["macChrome", "Mac · Chrome", "computer"],
    ["macSafari", "Mac · Safari", "computer"],
    ["macFirefox", "Mac · Firefox", "computer"],
    ["claudeApp", "Mac · Claude app", "computer"],
    ["windowsEdge", "Windows · Edge", "computer"],
    ["windowsChrome", "Windows · Chrome", "computer"],
    ["androidChrome", "Android phone · Chrome", "phone"],
    ["androidSamsung", "Android phone · Samsung Internet", "phone"],
    ["androidTablet", "Android tablet · Chrome", "tablet"],
    ["chromebook", "Chromebook · Chrome", "computer"],
    ["linuxFirefox", "Linux · Firefox", "computer"],
  ] as const)("%s → %s", (key, label, kind) => {
    const d = describeDevice(UA[key]);
    expect(d.label).toBe(label);
    expect(d.kind).toBe(kind);
  });

  it("names AI assistants and programs rather than a device", () => {
    expect(describeDevice("Claude-User").label).toBe("AI assistant (Claude)");
    expect(describeDevice("Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)").label).toBe("AI assistant (ChatGPT)");
    expect(describeDevice("curl/8.7.1")).toMatchObject({ kind: "program", label: "A program (curl)" });
    expect(describeDevice("node")).toMatchObject({ kind: "program", label: "A program (node)" });
  });

  it("says so when it cannot tell", () => {
    expect(describeDevice(null).label).toBe("Unknown device");
    expect(describeDevice("").label).toBe("Unknown device");
    expect(describeDevice("SomethingElse/1.0").label).toBe("Unknown device (SomethingElse/1.0)");
  });
});
