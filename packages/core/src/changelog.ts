/**
 * The changelog, read for somebody who did not write it.
 *
 * The file is Keep a Changelog markdown and is written for whoever maintains
 * the app. What a person running a show wants to know is shorter: what is
 * different, in a sentence, without the reasoning underneath it.
 *
 * That shape is already there and was not designed for this. Every entry in
 * this project's changelog opens with a bold sentence that says the whole
 * thing — "**A tooltip appears next to the thing it explains.**" — and then
 * explains itself underneath. So the headline is the summary, and the rest is
 * detail somebody can open if they want it. No second list to keep in step
 * with the first, and no summary that can quietly stop matching what shipped.
 */
export interface ChangelogEntry {
  /** "Added", "Fixed", "Changed" — whatever the file's own heading said. */
  kind: string;
  /** The bold opening sentence, stripped of its markers and full stop. */
  headline: string;
  /** Everything after it, as plain text. Empty when the entry is one line. */
  detail: string;
}

export interface ChangelogRelease {
  /** "Unreleased", or a version like "0.36.0". */
  version: string;
  /** The date beside the heading, when there is one. */
  date: string | null;
  entries: ChangelogEntry[];
}

/** `**Bold lead.** rest` → the two halves. Falls back to the first sentence. */
function splitEntry(body: string): { headline: string; detail: string } {
  const bold = /^\*\*(.+?)\*\*\s*(.*)$/s.exec(body.trim());
  if (bold) return { headline: bold[1]!.trim().replace(/[.\s]+$/, ""), detail: bold[2]!.trim() };
  const stop = body.indexOf(". ");
  if (stop > 0) return { headline: body.slice(0, stop).trim(), detail: body.slice(stop + 2).trim() };
  return { headline: body.trim().replace(/[.\s]+$/, ""), detail: "" };
}

/** Markdown emphasis and links, removed rather than rendered. */
const plain = (v: string): string =>
  v
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

export function parseChangelog(markdown: string, limit = 40): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | null = null;
  let kind = "Changed";
  // An entry runs from its bullet to the next bullet or heading, so its
  // indented continuation paragraphs come with it.
  let buffer: string[] | null = null;

  const flush = () => {
    if (!buffer || !release) return (buffer = null);
    const { headline, detail } = splitEntry(buffer.join("\n"));
    if (headline) release.entries.push({ kind, headline: plain(headline), detail: plain(detail) });
    buffer = null;
  };

  for (const raw of markdown.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const head = /^##\s+\[?([^\]\s]+)\]?\s*-?\s*(\d{4}-\d{2}-\d{2})?/.exec(line);
    if (line.startsWith("## ") && head) {
      flush();
      release = { version: head[1]!, date: head[2] ?? null, entries: [] };
      releases.push(release);
      kind = "Changed";
      continue;
    }
    if (line.startsWith("### ")) {
      flush();
      kind = line.slice(4).trim();
      continue;
    }
    if (!release) continue;
    if (/^[-*]\s+/.test(line)) {
      flush();
      buffer = [line.replace(/^[-*]\s+/, "")];
      continue;
    }
    // A blank line does not end an entry — the detail paragraphs under one are
    // separated by them. Only the next bullet or heading does.
    if (buffer) buffer.push(line.trim());
  }
  flush();

  // The whole file is long and nobody is going to read 0.1.0 from a dialog.
  let kept = 0;
  return releases.filter((r) => {
    if (kept >= limit) return false;
    kept += r.entries.length;
    return r.entries.length > 0;
  });
}
