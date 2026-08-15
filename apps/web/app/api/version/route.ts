import { NextResponse } from "next/server";

/**
 * What build is this deployment actually running?
 *
 * The same three facts the badge shows bottom-right of the dashboard —
 * version, commit, build date — but readable without signing in. The badge
 * needs an authenticated page, so answering "did the deploy land?" meant
 * logging in and looking; twice this week that question was instead answered
 * from a stale note, and the second time the answer was wrong.
 *
 * Nothing here is a secret. These three values are `NEXT_PUBLIC_*`, which
 * means the bundler has already inlined them into the JavaScript every visitor
 * downloads. This adds no exposure, only a way to read what is already there
 * without a browser and a password.
 */
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({
    name: "opencall",
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0",
    commit: process.env.NEXT_PUBLIC_BUILD_SHA ?? "unknown",
    built: process.env.NEXT_PUBLIC_BUILD_DATE ?? null,
  });
}
