import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { parseChangelog } from "@opencall/core";

/**
 * What changed, for whoever is running the show rather than writing the app.
 *
 * Read from the repository's own CHANGELOG.md at request time rather than
 * copied into a second list somewhere. A summary kept beside the real thing
 * is a summary that stops matching it, usually about two releases in, and
 * then it is worse than nothing because people believe it.
 *
 * The working directory depends on how the app was started — from the repo
 * root by the deploy's start command, or from `apps/web` by a developer — so
 * both are tried rather than one being assumed correct and failing silently
 * in whichever case nobody tested.
 */
export const dynamic = "force-dynamic";

const CANDIDATES = ["CHANGELOG.md", join("..", "..", "CHANGELOG.md")];

export async function GET() {
  for (const path of CANDIDATES) {
    try {
      // Told not to trace: the path is decided at run time, so the bundler
      // would otherwise pull the whole repository into the server output.
      // The deploy runs `next start` from the full checkout, so the file is
      // there to read without being traced.
      const md = await readFile(join(/*turbopackIgnore: true*/ process.cwd(), path), "utf8");
      return NextResponse.json({ releases: parseChangelog(md) });
    } catch {
      // Try the next one. Only the last failure is worth reporting.
    }
  }
  // Not an error the reader can act on, and not worth an empty dialog either:
  // say plainly that this build cannot find its own changelog.
  return NextResponse.json({ releases: [], unavailable: true }, { status: 200 });
}
