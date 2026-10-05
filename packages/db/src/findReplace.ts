import * as Y from "yjs";

/**
 * Find and replace across a sheet's text cells, in place, keeping formatting.
 *
 * Cell text lives in Y.XmlText nodes inside each cell's fragment (one per
 * paragraph). A match is found in a node's plain text and replaced with
 * delete-then-insert at the same offset, carrying the formatting that was on
 * the first matched character — so a bold word stays bold. Matches never span
 * two paragraphs (a run sheet cell's lines are separate thoughts).
 *
 * Browser-safe: used by the editor directly, inside one transaction, so one
 * undo takes the whole replace back.
 */

export interface FindHit {
  rowId: string;
  columnId: string;
  count: number;
}

export interface FindOptions {
  matchCase?: boolean;
  /** Only these column ids (default: every text cell). */
  columnIds?: Set<string>;
}

function textNodes(node: Y.XmlFragment | Y.XmlElement, out: Y.XmlText[] = []): Y.XmlText[] {
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) out.push(child);
    else if (child instanceof Y.XmlElement) textNodes(child, out);
  }
  return out;
}

const plainOf = (t: Y.XmlText) =>
  (t.toDelta() as { insert: unknown }[]).map((op) => (typeof op.insert === "string" ? op.insert : "")).join("");

function offsets(haystack: string, needle: string, matchCase: boolean): number[] {
  if (!needle) return [];
  const h = matchCase ? haystack : haystack.toLowerCase();
  const n = matchCase ? needle : needle.toLowerCase();
  const at: number[] = [];
  for (let i = h.indexOf(n); i >= 0; i = h.indexOf(n, i + n.length)) at.push(i);
  return at;
}

function cellsOf(doc: Y.Doc, opts: FindOptions) {
  const rows = doc.getMap<Y.Map<unknown>>("rows");
  const out: { rowId: string; columnId: string; row: Y.Map<unknown>; fragment: Y.XmlFragment }[] = [];
  for (const rowId of doc.getArray<string>("rowOrder").toArray()) {
    const row = rows.get(rowId);
    const cells = row?.get("cells") as Y.Map<Y.XmlFragment> | undefined;
    if (!row || !cells) continue;
    for (const [columnId, fragment] of cells) {
      if (opts.columnIds && !opts.columnIds.has(columnId)) continue;
      if (fragment instanceof Y.XmlFragment) out.push({ rowId, columnId, row, fragment });
    }
  }
  return out;
}

/** Every cell containing `query`, in sheet order, with how many times. */
export function findInSheet(doc: Y.Doc, query: string, opts: FindOptions = {}): FindHit[] {
  if (!query) return [];
  const hits: FindHit[] = [];
  for (const c of cellsOf(doc, opts)) {
    const count = textNodes(c.fragment).reduce((n, t) => n + offsets(plainOf(t), query, !!opts.matchCase).length, 0);
    if (count > 0) hits.push({ rowId: c.rowId, columnId: c.columnId, count });
  }
  return hits;
}

/**
 * Replaces every match. Locked rows are left alone and counted. Call inside
 * the caller's transaction (the editor wraps it in one, for one undo).
 */
export function replaceInSheet(
  doc: Y.Doc,
  query: string,
  replacement: string,
  opts: FindOptions = {},
): { replaced: number; cells: number; lockedSkipped: number } {
  const result = { replaced: 0, cells: 0, lockedSkipped: 0 };
  if (!query) return result;
  for (const c of cellsOf(doc, opts)) {
    const nodes = textNodes(c.fragment);
    const found = nodes.map((t) => offsets(plainOf(t), query, !!opts.matchCase));
    const total = found.reduce((n, a) => n + a.length, 0);
    if (total === 0) continue;
    if (c.row.get("locked")) {
      result.lockedSkipped += total;
      continue;
    }
    nodes.forEach((t, i) => {
      // Back to front, so earlier offsets stay true.
      for (const at of [...found[i]!].reverse()) {
        let pos = 0;
        let attrs: Record<string, unknown> | undefined;
        for (const op of t.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
          const len = typeof op.insert === "string" ? op.insert.length : 1;
          if (at < pos + len) {
            attrs = op.attributes;
            break;
          }
          pos += len;
        }
        t.delete(at, query.length);
        if (replacement) t.insert(at, replacement, attrs ?? {});
      }
    });
    result.replaced += total;
    result.cells++;
  }
  return result;
}
