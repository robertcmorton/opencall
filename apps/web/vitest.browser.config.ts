import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

/**
 * Tests that need a REAL browser: pointer events, layout, CSS animations.
 * A simulated DOM has none of those, so anything about how the sheet is
 * drawn or touched was checked by hand until now.
 *
 * Runs the installed Google Chrome (channel "chrome") so nothing has to be
 * downloaded. `pnpm --filter @opencall/web test:browser`. Kept out of the
 * plain `test` run, which must work on a machine without Chrome.
 */
export default defineConfig({
  // The app's tsconfig leaves JSX to Next ("preserve"); these tests are built
  // by Vite, so it compiles JSX itself with the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  // Pre-bundled up front so Vite does not discover them mid-run and reload.
  optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-dev-runtime", "react/jsx-runtime"] },
  test: {
    include: ["test-browser/**/*.test.tsx"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: "chrome" } }),
      instances: [{ browser: "chromium" }],
    },
  },
});
