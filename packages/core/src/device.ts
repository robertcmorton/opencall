/**
 * What a device is, in words, from the description its browser sends
 * (22 Oct 2026).
 *
 * Asked for after a sign-in turned up in Account activity that nobody could
 * place: the address column said where Railway's front door was, not who had
 * come through it, and nothing on screen said whether it was a phone, a laptop
 * or a program. Every request already carries the answer — the user agent —
 * and the app was throwing it away for everything but sign-in sessions.
 *
 * Deliberately small: the handful of systems and browsers a production crew
 * actually uses, plus the two non-browsers that reach this app (the Claude
 * desktop app's own browser and AI assistant connectors). Anything else is
 * named by what can be told — "Windows · a browser" — rather than guessed.
 * A user agent is a claim, not proof: it says what a device calls itself.
 */
export type DeviceKind = "phone" | "tablet" | "computer" | "assistant" | "program" | "unknown";

export interface DeviceInfo {
  kind: DeviceKind;
  /** "iPhone", "Mac", "Android phone", "Windows"… null when it does not say. */
  system: string | null;
  /** "Safari", "Chrome", "Claude app"… null when it does not say. */
  browser: string | null;
  /** The two together, for a list: "iPhone · Safari". */
  label: string;
}

const UNKNOWN: DeviceInfo = { kind: "unknown", system: null, browser: null, label: "Unknown device" };

function systemOf(ua: string): { system: string; kind: DeviceKind } | null {
  if (/\biPhone\b|\biPod\b/.test(ua)) return { system: "iPhone", kind: "phone" };
  if (/\biPad\b/.test(ua)) return { system: "iPad", kind: "tablet" };
  if (/\bAndroid\b/.test(ua)) return /\bMobile\b/.test(ua) ? { system: "Android phone", kind: "phone" } : { system: "Android tablet", kind: "tablet" };
  if (/\bCrOS\b/.test(ua)) return { system: "Chromebook", kind: "computer" };
  if (/\bWindows (NT|Phone)\b/.test(ua)) return { system: "Windows", kind: "computer" };
  if (/\bMacintosh\b|\bMac OS X\b/.test(ua)) return { system: "Mac", kind: "computer" };
  if (/\bLinux\b|\bX11\b/.test(ua)) return { system: "Linux", kind: "computer" };
  return null;
}

function browserOf(ua: string): string | null {
  // Order matters: every Chromium browser also says "Chrome", and Chrome and
  // most in-app browsers also say "Safari".
  if (/\bClaude\/\d/.test(ua)) return "Claude app";
  if (/\bEdg(e|A|iOS)?\/\d/.test(ua)) return "Edge";
  if (/\bOPR\/\d|\bOpera\b/.test(ua)) return "Opera";
  if (/\bSamsungBrowser\/\d/.test(ua)) return "Samsung Internet";
  if (/\bFirefox\/\d|\bFxiOS\/\d/.test(ua)) return "Firefox";
  if (/\bCriOS\/\d/.test(ua)) return "Chrome";
  if (/\bChrome\/\d|\bChromium\/\d/.test(ua)) return "Chrome";
  if (/\bVersion\/[\d.]+.*\bSafari\/\d/.test(ua)) return "Safari";
  // An iPhone app showing a web page in its own window (mail, messages,
  // social apps): WebKit with no browser named.
  if (/\bAppleWebKit\/\d/.test(ua) && /\b(iPhone|iPad)\b/.test(ua)) return "an app's own browser";
  return null;
}

/** AI assistants and programs, which do not describe a device at all. */
function programOf(ua: string): DeviceInfo | null {
  if (/\bClaude-User\b|\bClaudeBot\b|\banthropic\b/i.test(ua)) return { kind: "assistant", system: null, browser: null, label: "AI assistant (Claude)" };
  if (/\bChatGPT-User\b|\bOAI-SearchBot\b|\bGPTBot\b/i.test(ua)) return { kind: "assistant", system: null, browser: null, label: "AI assistant (ChatGPT)" };
  const tool = /^(curl|Wget|python-requests|python-httpx|axios|node-fetch|undici|node|Go-http-client|okhttp|PostmanRuntime|insomnia)\b/i.exec(ua.trim());
  if (tool) return { kind: "program", system: null, browser: null, label: `A program (${tool[1]})` };
  return null;
}

export function describeDevice(userAgent: string | null | undefined): DeviceInfo {
  const ua = (userAgent ?? "").trim();
  if (!ua) return UNKNOWN;
  const program = programOf(ua);
  if (program) return program;
  const sys = systemOf(ua);
  const browser = browserOf(ua);
  if (!sys && !browser) return { ...UNKNOWN, label: `Unknown device (${ua.slice(0, 40)})` };
  const system = sys?.system ?? null;
  return {
    kind: sys?.kind ?? "unknown",
    system,
    browser,
    label: [system ?? "Unknown system", browser ?? "a browser"].join(" · "),
  };
}
