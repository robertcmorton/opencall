"use client";

import { useEffect, useState } from "react";
import type { ChangelogRelease } from "@opencall/core";

/**
 * What has changed, and whether this browser is looking at it.
 *
 * TWO DIFFERENT QUESTIONS, and only one of them was ever answerable here.
 * "What is new?" is answered by the changelog. "Am I running it?" is answered
 * by comparing the build this PAGE was served from against the build the
 * deployment is serving NOW — and they come apart every time somebody leaves
 * a sheet open through a release, which on a show day is most people. The tab
 * keeps running the JavaScript it downloaded this morning and nothing says so.
 *
 * So the badge notices, and the dialog offers the one action that fixes it.
 */
const LOADED_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? "unknown";

export function WhatsNew({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [releases, setReleases] = useState<ChangelogRelease[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [liveSha, setLiveSha] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch("/api/changelog")
      .then((r) => r.json())
      .then((d: { releases: ChangelogRelease[]; unavailable?: boolean }) => {
        if (cancelled) return;
        setReleases(d.releases ?? []);
        setUnavailable(!!d.unavailable);
      })
      .catch(() => !cancelled && setUnavailable(true));
    // Fetched fresh, and deliberately not cached: the whole point is to learn
    // that the deployment has moved on since this page was served.
    void fetch("/api/version", { cache: "no-store" })
      .then((r) => r.json())
      .then((v: { commit?: string }) => !cancelled && setLiveSha(v.commit ?? null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;
  const behind = liveSha != null && liveSha !== "unknown" && LOADED_SHA !== "unknown" && liveSha !== LOADED_SHA;

  return (
    <div className="whatsnew-scrim" role="dialog" aria-modal="true" aria-label="What's new" onClick={onClose}>
      <div className="whatsnew" onClick={(e) => e.stopPropagation()}>
        <header className="whatsnew-head">
          <strong>What&rsquo;s new</strong>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {behind && (
          <p className="whatsnew-behind">
            A newer version is running on the server. This tab is still showing the one it downloaded when you
            opened it.
          </p>
        )}

        <div className="whatsnew-body">
          {unavailable && <p className="whatsnew-empty">This build cannot find its changelog.</p>}
          {!unavailable && releases == null && <p className="whatsnew-empty">Reading the changelog…</p>}
          {releases?.map((release) => (
            <section key={release.version} className="whatsnew-release">
              <h3>
                {release.version === "Unreleased" ? "Latest changes" : `Version ${release.version}`}
                {release.date && <span className="whatsnew-date">{release.date}</span>}
              </h3>
              {release.entries.map((entry) => {
                const key = `${release.version}-${entry.headline}`;
                const isOpen = expanded === key;
                return (
                  <div key={key} className="whatsnew-entry">
                    <button
                      type="button"
                      className="whatsnew-entry-head"
                      onClick={() => setExpanded(isOpen ? null : key)}
                      aria-expanded={isOpen}
                    >
                      <span className={`whatsnew-kind kind-${entry.kind.toLowerCase()}`}>{entry.kind}</span>
                      <span className="whatsnew-headline">{entry.headline}</span>
                      {entry.detail && <span className="whatsnew-more">{isOpen ? "−" : "+"}</span>}
                    </button>
                    {isOpen && entry.detail && <p className="whatsnew-detail">{entry.detail}</p>}
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <footer className="whatsnew-foot">
          <span className="whatsnew-build">
            You are running <span className="mono">{LOADED_SHA}</span>
            {behind && (
              <>
                {" · "}server has <span className="mono">{liveSha}</span>
              </>
            )}
          </span>
          {/* One button, and it does the thing this dialog can actually do.
              Reloading is what puts THIS tab on the build the server is
              already serving; it is not a deploy, and calling it one would be
              a lie the first time somebody pressed it and nothing shipped. */}
          <button
            type="button"
            className={`btn ${behind ? "btn-primary" : ""}`}
            disabled={!behind || reloading}
            onClick={() => {
              setReloading(true);
              window.location.reload();
            }}
          >
            {reloading ? "Updating…" : behind ? "Update this tab" : "Up to date"}
          </button>
        </footer>
      </div>
    </div>
  );
}
