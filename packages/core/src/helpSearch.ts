import { GESTURES, SECTIONS, SHORTCUTS, type HelpItem, type HelpSection } from "./help.ts";

/**
 * The Help page, for an AI assistant (20 Oct: "allow AI MCP to access help").
 *
 * The same words the person reads on /help — one source, so an assistant never
 * describes a button that has gone. Plain text: the page's **bold** and
 * `code` marks are kept as they are, which read fine to a model.
 */

/** One topic as text: what it's for, then how, then the rest. */
export function helpTopicText(item: HelpItem, section?: HelpSection): string {
  const lines = [`${item.name}${section ? ` (${section.title})` : ""}`, item.forWhat];
  if (item.steps?.length) lines.push(...item.steps.map((s, i) => `${i + 1}. ${s}`));
  if (item.how) lines.push(item.how);
  if (item.mouse) lines.push(`With a mouse: ${item.mouse}`);
  if (item.keys) lines.push(`With the keyboard: ${item.keys}`);
  if (item.finger) lines.push(`With a finger: ${item.finger}`);
  if (item.who) lines.push(`Who: ${item.who}`);
  if (item.good) lines.push(`Good to know: ${item.good}`);
  return lines.join("\n");
}

const words = (q: string) =>
  q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

export interface HelpHit {
  id: string;
  section: string;
  name: string;
  text: string;
}

/**
 * Topics matching a question, best first. Every word must appear somewhere in
 * the topic; a word in its name counts for more than one in its body, so
 * "end walkthrough" finds the Walkthrough topic before one that merely
 * mentions both words.
 */
export function searchHelp(query: string, limit = 6): HelpHit[] {
  const want = words(query);
  if (want.length === 0) return [];
  const hits: { hit: HelpHit; score: number }[] = [];
  for (const section of SECTIONS)
    for (const item of section.items) {
      const text = helpTopicText(item, section);
      const body = text.toLowerCase();
      const name = item.name.toLowerCase();
      if (!want.every((w) => body.includes(w))) continue;
      const score = want.reduce((n, w) => n + (name.includes(w) ? 3 : 0) + (item.forWhat.toLowerCase().includes(w) ? 1 : 0), 0);
      hits.push({ hit: { id: item.id, section: section.title, name: item.name, text }, score });
    }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((h) => h.hit);
}

/** One topic by its id, or null. */
export function helpTopic(id: string): HelpHit | null {
  for (const section of SECTIONS)
    for (const item of section.items)
      if (item.id === id) return { id: item.id, section: section.title, name: item.name, text: helpTopicText(item, section) };
  return null;
}

/** The contents page: every section and its topics, by id and name. */
export function helpContents(): { section: string; topics: { id: string; name: string; forWhat: string }[] }[] {
  return SECTIONS.map((s) => ({ section: s.title, topics: s.items.map((i) => ({ id: i.id, name: i.name, forWhat: i.forWhat })) }));
}

/** The keyboard shortcuts and touch gestures, as text. */
export function helpShortcutsText(): string {
  return [
    "Keyboard shortcuts:",
    ...SHORTCUTS.map((s) => `${s.keys} — ${s.does} (${s.where})`),
    "",
    "Touch gestures:",
    ...GESTURES.map((g) => `${g.gesture} — ${g.does} (${g.where})`),
  ].join("\n");
}
