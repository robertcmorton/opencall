import { defineConfig } from "vitest/config";

/**
 * The other packages run `vitest run` with no config at all, and this one is
 * deliberately as close to that as it can be: same runner, same version, same
 * `test/**` layout, so `pnpm test` at the root picks it up through turbo
 * alongside the rest.
 *
 * The one thing it adds is a boundary. Vitest's default `include` is
 * `**\/*.{test,spec}.*` across the whole project, and its default `exclude`
 * covers `node_modules` and `dist` but not `.next` — which a pure package does
 * not have and this one regenerates on every build. Nothing in the current
 * build output matches (checked: 209 files, none named `*.test.*`), so today
 * this changes precisely nothing; it is here so that a fixture or a vendored
 * chunk landing in generated output later cannot quietly become a test suite.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
