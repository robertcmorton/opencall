"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Highlight from "@tiptap/extension-highlight";
import { CharacterCount } from "@tiptap/extensions";
import { splitBlock } from "@tiptap/pm/commands";
import type * as Y from "yjs";
import { Icon } from "./ui";
import { askText } from "../lib/dialogs";

function FormatButton({
  editor,
  label,
  title,
  active,
  onRun,
}: {
  editor: Editor;
  label: React.ReactNode;
  title: string;
  active: boolean;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      data-tip={title}
      className={active ? "is-on" : ""}
      // mousedown so the cell editor never loses focus/selection
      onMouseDown={(e) => {
        e.preventDefault();
        onRun();
        editor.chain().focus().run();
      }}
    >
      {label}
    </button>
  );
}

function FormatBar({ editor, suppressBlur }: { editor: Editor; suppressBlur: MutableRefObject<boolean> }) {
  // Re-render on selection/transaction so active states stay current.
  const [, bump] = useState(0);
  useEffect(() => {
    const update = () => bump((n) => n + 1);
    editor.on("transaction", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("transaction", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  const setLink = async () => {
    // The dialog takes the keyboard from the editor; keep the cell open through it.
    suppressBlur.current = true;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = await askText({
      title: prev ? "Change the link" : "Add a link",
      label: "Web address",
      value: prev ?? "https://",
      hint: "Leave it empty to take the link off",
      inputType: "url",
      confirmLabel: "Save link",
    });
    if (url !== null) {
      if (url === "" || url === "https://") editor.chain().focus().unsetLink().run();
      else editor.chain().focus().setLink({ href: url }).run();
    }
    setTimeout(() => {
      suppressBlur.current = false;
      editor.chain().focus().run();
    }, 0);
  };

  return (
    <div className="format-bar" style={{ bottom: "calc(100% + 4px)", left: 0 }}>
      <FormatButton editor={editor} title="Bold" label={<strong>B</strong>} active={editor.isActive("bold")} onRun={() => editor.chain().toggleBold().run()} />
      <FormatButton editor={editor} title="Italic" label={<em>I</em>} active={editor.isActive("italic")} onRun={() => editor.chain().toggleItalic().run()} />
      <FormatButton editor={editor} title="Underline" label={<span style={{ textDecoration: "underline" }}>U</span>} active={editor.isActive("underline")} onRun={() => editor.chain().toggleUnderline().run()} />
      <FormatButton editor={editor} title="Strikethrough" label={<s>S</s>} active={editor.isActive("strike")} onRun={() => editor.chain().toggleStrike().run()} />
      <FormatButton editor={editor} title="Highlight" label={<span style={{ background: "var(--warn-soft)", color: "var(--warn)", borderRadius: "var(--r-xs)", padding: "0 3px" }}>H</span>} active={editor.isActive("highlight")} onRun={() => editor.chain().toggleHighlight().run()} />
      <FormatButton editor={editor} title="Link" label={Icon.link} active={editor.isActive("link")} onRun={setLink} />
      <FormatButton editor={editor} title="Clear formatting" label={Icon.clearFormat} active={false} onRun={() => editor.chain().unsetAllMarks().run()} />
    </div>
  );
}

/**
 * Read-aloud speeds, in words a minute. Presenters reading to a crowd or a
 * camera land around 150; the outer two cover a slow, deliberate read and a
 * quick one. Shown as times, not speeds — the duration is what gets typed.
 */
const READ_SPEEDS = [
  { label: "Slow", wpm: 130 },
  { label: "Normal", wpm: 150 },
  { label: "Fast", wpm: 170 },
] as const;
/** Below this a cell is a note, not a script, and a read time is noise. */
const READ_TIME_MIN_WORDS = 8;

const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/**
 * Word count and read time for a cell long enough to be read aloud, with each
 * time offered as the row's duration where the row has one to set.
 */
function ReadTime({ editor, onUseReadTime }: { editor: Editor; onUseReadTime?: (sec: number) => void }) {
  const [, bump] = useState(0);
  useEffect(() => {
    const update = () => bump((n) => n + 1);
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);
  const words = (editor.storage.characterCount as { words: () => number }).words();
  if (words < READ_TIME_MIN_WORDS) return null;
  return (
    <div className="read-time" aria-live="polite">
      <span className="read-time-words">{words} words</span>
      {READ_SPEEDS.map(({ label, wpm }) => {
        const sec = Math.max(1, Math.ceil((words / wpm) * 60));
        return onUseReadTime ? (
          <button
            key={label}
            type="button"
            data-tip={`Set this item's duration to ${clock(sec)} (${label.toLowerCase()} read, ${wpm} words a minute)`}
            // mousedown so the cell keeps its focus, like the format buttons
            onMouseDown={(e) => {
              e.preventDefault();
              onUseReadTime(sec);
            }}
          >
            {label} {clock(sec)}
          </button>
        ) : (
          <span key={label}>
            {label} {clock(sec)}
          </span>
        );
      })}
    </div>
  );
}

/** TipTap editor bound to one cell's Y.XmlFragment. Mounted only for the active cell. */
export function CellEditor({
  fragment,
  onDone,
  chips,
  onUseReadTime,
  onEnter,
  onTab,
}: {
  fragment: Y.XmlFragment;
  onDone: () => void;
  /**
   * Spreadsheet keys, where the sheet offers them: Enter saves and moves down
   * (Shift+Enter starts a new line instead), Tab saves and moves along. Absent,
   * Enter starts a new line as it always has.
   */
  onEnter?: () => void;
  onTab?: (back: boolean) => void;
  /** Quick-insert vocabulary (cue-type columns) — free text stays possible. */
  chips?: string[];
  /** Set the row's duration from the read time; absent where there is none to set. */
  onUseReadTime?: (sec: number) => void;
}) {
  const suppressBlur = useRef(false);
  // Read at key time: the editor's key handler is fixed when it is created.
  const keys = useRef({ onEnter, onTab });
  keys.current = { onEnter, onTab };
  const editor = useEditor({
    immediatelyRender: false,
    autofocus: "end",
    extensions: [
      // Underline and Link come inside StarterKit from Tiptap 3. Undo/redo
      // stays off: the collaboration extension keeps the history, so an
      // undo takes back this person's edits and not somebody else's.
      StarterKit.configure({ undoRedo: false, link: { openOnClick: false } }),
      Highlight,
      CharacterCount,
      Collaboration.configure({ fragment }),
    ],
    onBlur: () => {
      if (!suppressBlur.current) onDone();
    },
    editorProps: {
      attributes: { class: "cell-editor" },
      handleKeyDown: (_view, event) => {
        if (event.key === "Escape") {
          onDone();
          return true;
        }
        const { onEnter: enter, onTab: tab } = keys.current;
        if (event.key === "Enter" && enter && !event.metaKey && !event.ctrlKey && !event.altKey) {
          // A new paragraph, the same thing Enter made before — not a line
          // break, which the rest of the app does not read.
          if (event.shiftKey) return splitBlock(_view.state, _view.dispatch);
          enter();
          return true;
        }
        if (event.key === "Tab" && tab && !event.metaKey && !event.ctrlKey && !event.altKey) {
          tab(event.shiftKey);
          return true;
        }
        return false;
      },
    },
  });

  return (
    <div style={{ position: "relative" }}>
      {editor && <FormatBar editor={editor} suppressBlur={suppressBlur} />}
      {editor && chips && chips.length > 0 && (
        <div className="chip-row">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().insertContent(`${chip} `).run();
              }}
            >
              {chip}
            </button>
          ))}
        </div>
      )}
      <EditorContent editor={editor} />
      {editor && <ReadTime editor={editor} onUseReadTime={onUseReadTime} />}
    </div>
  );
}
