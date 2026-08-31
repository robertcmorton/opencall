"use client";

import { useEffect, useState } from "react";
import { WhatsNew } from "./WhatsNew";

/**
 * Quiet build identity, bottom-right of the dashboard: version · commit ·
 * build date. Answers "which build is this deployment actually running?"
 * at a glance.
 *
 * Clicking it now opens what changed, rather than copying the string. Copying
 * a build number is a thing one person does twice a year when filing a bug;
 * "what is different since yesterday" is a thing everybody wants and nothing
 * answered. The string is still on the tooltip for the bug report.
 *
 * It also learns whether the DEPLOYMENT has moved on since this page was
 * served, and says so with a dot — a tab left open through a release keeps
 * running the JavaScript it downloaded, and until now nothing said so.
 */
export function VersionBadge() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const sha = process.env.NEXT_PUBLIC_BUILD_SHA ?? "unknown";
  const date = process.env.NEXT_PUBLIC_BUILD_DATE ?? "";
  const full = `OpenCall v${version} · ${sha}${date ? ` · built ${date}` : ""}`;
  const [open, setOpen] = useState(false);
  const [behind, setBehind] = useState(false);

  /**
   * Asked once on load, and again when the tab comes back.
   *
   * Not polled: a release is not a thing that happens every thirty seconds,
   * and a request per interval per open sheet is a poor trade for learning
   * about it sooner. Coming back to the tab is when somebody is about to use
   * it, which is the moment the answer matters.
   */
  useEffect(() => {
    if (sha === "unknown") return;
    const check = () =>
      void fetch("/api/version", { cache: "no-store" })
        .then((r) => r.json())
        .then((v: { commit?: string }) => setBehind(!!v.commit && v.commit !== "unknown" && v.commit !== sha))
        .catch(() => undefined);
    check();
    const onShow = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [sha]);

  return (
    <>
      <WhatsNew open={open} onClose={() => setOpen(false)} />
    <button
      type="button"
      className="no-print"
      title={`${full} — click to see what's new`}
      onClick={() => setOpen(true)}
      style={{
        position: "fixed",
        right: 12,
        bottom: 8,
        zIndex: 30,
        background: "none",
        border: "none",
        padding: "2px 4px",
        cursor: "pointer",
        font: "inherit",
        fontSize: 11,
        letterSpacing: "0.02em",
        color: "var(--text-3)",
        opacity: 0.75,
      }}
    >
      {behind && <span className="version-behind" aria-label="A newer version is available" />}
      v{version} · {sha}
    </button>
    </>
  );
}
