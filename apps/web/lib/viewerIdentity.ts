/**
 * Who is holding this view-only link, and on what.
 *
 * A link gets forwarded. Without a name a showcaller can see that six devices
 * are connected and nothing about whose they are, which is no use when the
 * question is "has camera 2 got the running order yet?".
 *
 * Nothing here identifies a person on its own: the name is what they typed,
 * and the device details are only enough to tell one iPad from another. No
 * fingerprinting — the device id is a random value this app generates and
 * keeps in the device's own storage, not anything read off the machine.
 */
const NAME_KEY = "oc:viewer:name";
const DEVICE_KEY = "oc:viewer:device";

export interface ViewerDetails {
  name: string;
  deviceId: string;
  browser: string;
  os: string;
  screen: string;
}

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // private browsing, storage disabled — ask again, no harm
  }
};

const write = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* nothing to do: the visit is still recorded, it just cannot be recognised again */
  }
};

export const viewerName = (): string | null => read(NAME_KEY);

/** A random id for THIS device, so a return visit updates a row rather than adding one. */
export function deviceId(): string {
  const existing = read(DEVICE_KEY);
  if (existing) return existing;
  const fresh =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `d${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  write(DEVICE_KEY, fresh);
  return fresh;
}

/**
 * Browser and OS from the user-agent string.
 *
 * Deliberately coarse — "Safari" and "iOS" is what tells a phone from the
 * control-room desktop, and the version numbers would only date the record.
 * Order matters: Edge and Chrome both claim to be Chrome, Chrome claims to be
 * Safari, so the most specific has to be tested first.
 */
function readAgent(ua: string): { browser: string; os: string } {
  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /opr\/|opera/i.test(ua)
      ? "Opera"
      : /firefox\//i.test(ua)
        ? "Firefox"
        : /chrome\/|crios\//i.test(ua)
          ? "Chrome"
          : /safari\//i.test(ua)
            ? "Safari"
            : "Browser";
  const os = /iphone|ipod/i.test(ua)
    ? "iPhone"
    : /ipad/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /android/i.test(ua)
        ? "Android"
        : /macintosh|mac os/i.test(ua)
          ? "macOS"
          : /windows/i.test(ua)
            ? "Windows"
            : /linux/i.test(ua)
              ? "Linux"
              : "";
  return { browser, os };
}

export function describeDevice(name: string): ViewerDetails {
  const { browser, os } = readAgent(navigator.userAgent);
  return {
    name,
    deviceId: deviceId(),
    browser,
    os,
    screen: `${window.screen.width}×${window.screen.height}`,
  };
}

export function rememberName(name: string): void {
  write(NAME_KEY, name);
}
