/**
 * Appearance: dark, light, or whatever the machine says.
 *
 * Dark is the default and stays the default. The show surface was designed
 * dark for a reason — a control room, a truck, a stadium at night — and a crew
 * member opening a sheet on show night must not find it has gone white because
 * their laptop is set to light. Light is a choice somebody makes, on their own
 * browser, and it is remembered there. "Match system" is the third choice for
 * the person whose whole machine changes at sunset.
 *
 * The stylesheet already carried a light palette scoped to `[data-theme="light"]`
 * and nothing ever set it. This is what sets it.
 */
export type Theme = "dark" | "light" | "system";

export const THEME_KEY = "oc:theme";

export const THEMES: ReadonlyArray<{ value: Theme; label: string; tip: string }> = [
  { value: "dark", label: "Dark", tip: "The show-night default: built for a control room, a truck, a stadium at night." },
  { value: "light", label: "Light", tip: "For an office in daylight. Remembered on this browser only." },
  { value: "system", label: "Match system", tip: "Follows the machine's own light or dark setting, and changes when it does." },
];

export function isTheme(v: unknown): v is Theme {
  return v === "dark" || v === "light" || v === "system";
}

/** The one rule, written once: what the stored choice means on a machine that prefers light or not. */
export function resolveTheme(stored: string | null | undefined, prefersLight: boolean): "dark" | "light" {
  if (stored === "light") return "light";
  if (stored === "system") return prefersLight ? "light" : "dark";
  return "dark";
}

const LIGHT_BAR = "#f4f5f8";
const DARK_BAR = "#0b0d10";

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isTheme(v) ? v : "dark";
  } catch {
    return "dark";
  }
}

/** Stamp the document. Removing the attribute, not setting "dark", keeps the bare `:root` palette the dark one. */
export function applyTheme(theme: Theme): void {
  const light = resolveTheme(theme, window.matchMedia("(prefers-color-scheme: light)").matches) === "light";
  const root = document.documentElement;
  if (light) root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? LIGHT_BAR : DARK_BAR);
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode, or storage blocked: the choice lasts as long as the page.
  }
  applyTheme(theme);
}

/**
 * Runs inline, before anything is painted, so a light-mode browser never sees
 * a dark flash — and before React hydrates, which is why the root element
 * carries `suppressHydrationWarning`: the server knows nothing about this
 * browser's choice. The same rule as `resolveTheme`, and the test holds the
 * two to each other.
 */
export const THEME_BOOT_SCRIPT =
  '(function(){try{var t=localStorage.getItem("' +
  THEME_KEY +
  '");if(t==="light"||(t==="system"&&window.matchMedia("(prefers-color-scheme: light)").matches)){document.documentElement.setAttribute("data-theme","light");var m=document.querySelector(\'meta[name="theme-color"]\');if(m)m.setAttribute("content","' +
  LIGHT_BAR +
  '")}}catch(e){}})();';
