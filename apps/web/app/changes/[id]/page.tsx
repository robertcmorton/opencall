"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type ChangeLogEntry } from "../../../lib/api";
import { BackLink } from "../../../components/BackLink";
import { dayOf, kindWord, whenDone, whoDid } from "../../../lib/changeLog";

/**
 * A sheet's change log: who changed what and when, newest first. Each change
 * opens a page of its own with the detail, and the ways to take it back.
 * Shows started and ended, and the sheet opened or closed to viewers, are
 * threaded through for context.
 */
export default function ChangesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.sheetChanges>> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void api
      .sheetChanges(id)
      .then(setData)
      .catch((err: unknown) => setProblem(err instanceof Error ? err.message : String(err)));
  }, [id]);

  const days: { day: string; entries: ChangeLogEntry[] }[] = [];
  for (const e of data?.entries ?? []) {
    const day = dayOf(e.at);
    if (days.at(-1)?.day !== day) days.push({ day, entries: [] });
    days.at(-1)!.entries.push(e);
  }

  return (
    <main style={{ maxWidth: 760, margin: "4vh auto", padding: "0 16px", display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <BackLink />
        <h1 style={{ fontSize: "1.3rem", margin: 0, flex: "1 1 auto" }}>
          Changes{data?.rundown ? <span style={{ color: "var(--text-2)", fontWeight: 400 }}> · {data.rundown.name}</span> : null}
        </h1>
      </div>
      <p style={{ margin: 0, color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
        Every change to this sheet, newest at the top. All the edits a person makes in one go share one line. An AI
        assistant gets one line for each change. Open a line to see exactly what changed. From there you can undo just
        that change, or put the whole sheet back the way it was before it.
      </p>

      {problem && <div className="panel" style={{ color: "var(--text-2)" }}>{problem}</div>}
      {!data && !problem && <div style={{ color: "var(--text-3)" }}>Loading…</div>}
      {data && data.entries.length === 0 && (
        <div className="panel" style={{ color: "var(--text-2)" }}>
          No changes recorded yet. From now on, every edit to this sheet is listed here.
        </div>
      )}

      {days.map(({ day, entries }) => (
        <section key={day} style={{ display: "grid", gap: 6 }}>
          <h2 className="field-label" style={{ margin: "8px 0 2px" }}>
            {day}
          </h2>
          {entries.map((e) =>
            e.type === "change" ? (
              <Link key={e.id} href={`/changes/${id}/${e.id}`} className="panel change-line" style={{ textDecoration: "none", color: "inherit" }}>
                <span className="change-when">{whenDone(e)}</span>
                <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                  <span>
                    <span className={`version-tag version-tag-${e.kind}`}>{kindWord(e.kind)}</span>
                    <strong style={{ fontWeight: 600 }}>{whoDid(e)}</strong>
                    {e.undoneBy && <span className="version-tag" style={{ marginLeft: 6 }}>Undone</span>}
                  </span>
                  <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)", overflowWrap: "anywhere" }}>{e.summary}</span>
                </span>
                <span aria-hidden style={{ color: "var(--text-3)" }}>
                  ›
                </span>
              </Link>
            ) : (
              <div key={e.id} className="change-line change-line-quiet">
                <span className="change-when">{whenDone(e)}</span>
                <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
                  {e.summary}
                  {e.actorName ? ` · ${e.actorName}` : ""}
                </span>
                <span />
              </div>
            ),
          )}
        </section>
      ))}
    </main>
  );
}
