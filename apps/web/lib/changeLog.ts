import type { ChangeLogEntry, SheetChangeDetail } from "./api";

/** Shared words for the change log's two pages. */

const KIND_WORD: Record<string, string> = {
  edit: "Edited",
  assistant: "AI assistant",
  import: "Import",
  restore: "Restore",
  undo: "Undo",
  copy: "Copied in",
};
export const kindWord = (kind: string | undefined) => (kind ? (KIND_WORD[kind] ?? kind) : "");

/** Who did it, as a person reads it: "Sam", "Claude, for Sam", "Someone". */
export function whoDid(e: Pick<ChangeLogEntry, "kind" | "actorName" | "assistant">): string {
  if (e.kind === "assistant") return `${e.assistant ?? "An AI assistant"}${e.actorName ? `, for ${e.actorName}` : ""}`;
  return e.actorName ?? "Someone";
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** "3:14 pm", or "2:10 pm – 2:25 pm" for an editing session that ran a while. */
export function whenDone(e: { at: string; startedAt?: string }): string {
  if (!e.startedAt) return time(e.at);
  const from = time(e.startedAt);
  const to = time(e.at);
  return from === to ? to : `${from} – ${to}`;
}

export const dayOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** The heading of one change's page. */
export function titleOf(c: SheetChangeDetail): string {
  switch (c.kind) {
    case "edit":
      return `${c.actorName ?? "Someone"} edited the sheet`;
    case "assistant":
      return `${c.assistant ?? "An AI assistant"} changed the sheet${c.actorName ? `, for ${c.actorName}` : ""}`;
    case "import":
      return `${c.actorName ?? "Someone"} updated the sheet from a file`;
    case "restore":
      return `${c.actorName ?? "Someone"} restored an earlier version`;
    case "undo":
      return `${c.actorName ?? "Someone"} undid a change`;
    case "copy":
      return `${c.actorName ?? "Someone"} copied rows in from another sheet`;
    default:
      return "A change to the sheet";
  }
}
