"use client";

import { Fragment, type ReactNode } from "react";

// The cell XML → React, allowlist only: a tag this app's own editor cannot
// produce never becomes an element, so nothing document-authored can inject
// structure into the grid. Text is handed to React as text and escaped by it.
const MARK_TAGS: Record<string, (children: ReactNode, key: number) => ReactNode> = {
  bold: (c, k) => <strong key={k}>{c}</strong>,
  strong: (c, k) => <strong key={k}>{c}</strong>,
  italic: (c, k) => <em key={k}>{c}</em>,
  em: (c, k) => <em key={k}>{c}</em>,
  underline: (c, k) => <u key={k}>{c}</u>,
  u: (c, k) => <u key={k}>{c}</u>,
  strike: (c, k) => <s key={k}>{c}</s>,
  s: (c, k) => <s key={k}>{c}</s>,
  highlight: (c, k) => (
    <mark key={k} style={{ background: "var(--warn-soft)", color: "var(--warn)", borderRadius: 2, padding: "0 2px" }}>
      {c}
    </mark>
  ),
  mark: (c, k) => <mark key={k}>{c}</mark>,
  link: (c, k) => (
    <span key={k} style={{ color: "var(--accent-text)", textDecoration: "underline" }}>
      {c}
    </span>
  ),
};

/**
 * The only tags that count as markup — matched where the scanner stands (sticky).
 *
 * Angle brackets a person typed — "<player name>", "<Captain to speak>" — are
 * content, not markup: they are prompts a caller reads aloud. Anything that is
 * not one of the editor's own marks therefore stays on screen as the character
 * it is. The same list, for the same reason, backs the plain-text projection in
 * packages/db (`cellPlainText`); the two are meant to agree, so change both.
 */
const EDITOR_TAG =
  /<(\/?)(paragraph|p|bold|italic|underline|strike|highlight|link|strong|em|u|s|mark)(?:\s[^<>]*)?\/?>/iy;

type Piece = string | { tag: string; children: Piece[] };

/**
 * Cell XML → a small tree, parsed by hand because there is no DOM on both sides
 * of the render.
 *
 * This used to be `new DOMParser()`, kept off the server by a
 * `typeof window === "undefined"` guard that returned null. The guard was
 * load-bearing — DOMParser is browser-only and server rendering dies without it
 * — but returning *different output* on the server than in the browser is a
 * hydration mismatch by construction. It stayed quiet only because the Y.Doc is
 * empty when the page is rendered on the server, so every cell was empty and
 * null happened to be the right answer; the first server render that carries
 * cell content is the one that breaks, and it breaks every row at once.
 *
 * The other way out — keep DOMParser and defer the rich render to a post-mount
 * effect so the browser's first pass also draws nothing — was rejected. It puts
 * every formatted cell on screen a frame late, and the server's HTML would
 * carry no cell text at all, which is what print and PDF export read. A
 * showcaller opening a sheet would watch it fill in.
 *
 * Parsing by hand is small because the input is small: Yjs serialises a cell as
 * balanced open/close tags with the text between them. It also drops two entity
 * bugs DOMParser brought with it, because Yjs does not escape what it
 * serialises (checked: a cell typed as `A & B` serialises with the bare "&"):
 *
 *   · a cell holding "&" was therefore invalid XML, and the parser-error path
 *     printed the markup at the reader — "A & B" reached the grid as
 *     `A & B</paragraph>`, and a bolded one lost its bold and showed its tags;
 *   · a person who typed the five characters "&amp;" had them decoded to "&".
 *
 * Here text is text, start to finish.
 */
function parseCell(xml: string): Piece[] {
  const root: Piece[] = [];
  const stack: { tag: string; children: Piece[] }[] = [];
  let text = "";

  const into = () => stack[stack.length - 1]?.children ?? root;
  const flush = () => {
    if (text) {
      into().push(text);
      text = "";
    }
  };

  let i = 0;
  while (i < xml.length) {
    const angle = xml.indexOf("<", i);
    if (angle < 0) {
      text += xml.slice(i);
      break;
    }
    text += xml.slice(i, angle);
    EDITOR_TAG.lastIndex = angle;
    const tag = EDITOR_TAG.exec(xml);
    if (!tag) {
      text += "<"; // punctuation the sheet typed, not a tag
      i = angle + 1;
      continue;
    }
    i = EDITOR_TAG.lastIndex;
    flush(); // text belongs to the element that was open when it was read
    const name = tag[2]!.toLowerCase();
    if (tag[1] === "/") {
      // A close tag that does not match what we are inside means the markup is
      // malformed. Drop the tag and keep going: the words are what the show
      // runs on, and losing them is worse than losing a bold.
      if (stack[stack.length - 1]?.tag === name) stack.pop();
      continue;
    }
    const element: { tag: string; children: Piece[] } = { tag: name, children: [] };
    into().push(element);
    if (!tag[0].endsWith("/>")) stack.push(element); // anything left open runs to the end of the cell
  }
  flush();
  return root;
}

function render(pieces: Piece[]): ReactNode[] {
  return pieces.map((piece, key) => {
    if (typeof piece === "string") return <Fragment key={key}>{piece}</Fragment>;
    const children = render(piece.children);
    const mark = MARK_TAGS[piece.tag];
    if (mark) return mark(children, key);
    // Grid cells are white-space: pre-wrap, so a newline is what puts the next
    // paragraph on its own line.
    if (piece.tag === "paragraph" || piece.tag === "p")
      return (
        <Fragment key={key}>
          {children}
          {"\n"}
        </Fragment>
      );
    // Only reachable if a name is added to EDITOR_TAG without a renderer here:
    // the text survives, the wrapper does not.
    return <Fragment key={key}>{children}</Fragment>;
  });
}

/** Renders a formatted cell's XML (bold/underline/highlight…) outside the editor. */
export function RichCellText({ xml }: { xml: string }) {
  return <>{render(parseCell(xml))}</>;
}
