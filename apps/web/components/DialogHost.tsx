"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { dialogStore, type Dialog } from "../lib/dialogs";
import { Icon } from "./ui";

/**
 * Draws the app's notes and dialogs (see lib/dialogs). Mounted once, in the
 * root layout.
 *
 * Dialogs use the browser's own <dialog> in modal mode: it keeps keyboard
 * focus inside, closes on Escape, sits above everything, and hides the page
 * behind it from screen readers — the things a hand-made overlay gets wrong.
 */
export function DialogHost() {
  const s = useSyncExternalStore(dialogStore.subscribe, dialogStore.get, dialogStore.get);
  return (
    <>
      <div className="app-notes no-print" aria-live="polite">
        {s.notes.map((n) => (
          <div key={n.id} className={`app-note is-${n.tone}`} role={n.tone === "error" ? "alert" : "status"}>
            <span>{n.text}</span>
            <button type="button" className="app-note-close" aria-label="Close" onClick={() => dialogStore.dismissNote(n.id)}>
              {Icon.close}
            </button>
          </div>
        ))}
      </div>
      {s.dialog && <DialogBox key={s.dialog.id} dialog={s.dialog} />}
    </>
  );
}

function DialogBox({ dialog }: { dialog: Dialog }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(dialog.kind === "text" ? dialog.value : "");
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const done = useRef(false);

  const finish = (ok: boolean) => {
    if (done.current) return;
    done.current = true;
    if (dialog.kind === "ask") dialog.resolve(ok);
    else if (dialog.kind === "text") dialog.resolve(ok ? value : null);
    else dialog.resolve();
    ref.current?.close();
    dialogStore.close();
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
    // Escape, or the browser closing it any other way, is a "no".
    const onCancel = (e: Event) => {
      e.preventDefault();
      finish(false);
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A click on the dim area outside the box closes it, as "no".
  const onBackdrop = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === ref.current && dialog.kind !== "secret") finish(false);
  };

  return (
    <dialog ref={ref} className="app-dialog" aria-labelledby={`dlg-${dialog.id}`} onClick={onBackdrop}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (dialog.kind === "text") {
            const why = dialog.validate?.(value) ?? null;
            if (why) return setProblem(why);
          }
          finish(true);
        }}
      >
        <h2 id={`dlg-${dialog.id}`} className="app-dialog-title">
          {dialog.title}
        </h2>
        {dialog.kind === "ask" && dialog.message && <p className="app-dialog-text">{dialog.message}</p>}
        {dialog.kind === "secret" && (
          <>
            <p className="app-dialog-text">{dialog.message}</p>
            <div className="app-dialog-secret">
              <code>{dialog.secret}</code>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  void navigator.clipboard.writeText(dialog.secret).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  )
                }
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </>
        )}
        {dialog.kind === "text" && (
          <label className="app-dialog-field">
            <span>{dialog.label}</span>
            <input
              className="input"
              type={dialog.inputType}
              autoFocus
              value={value}
              placeholder={dialog.placeholder}
              aria-invalid={!!problem}
              aria-describedby={problem ? `dlg-${dialog.id}-why` : dialog.hint ? `dlg-${dialog.id}-hint` : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                setProblem(null);
              }}
            />
            {dialog.hint && !problem && (
              <span id={`dlg-${dialog.id}-hint`} className="app-dialog-hint">
                {dialog.hint}
              </span>
            )}
            {problem && (
              <span id={`dlg-${dialog.id}-why`} className="app-dialog-problem" role="alert">
                {problem}
              </span>
            )}
          </label>
        )}
        <div className="app-dialog-buttons">
          {dialog.kind === "secret" ? (
            <button type="submit" className="btn btn-primary" autoFocus>
              Done
            </button>
          ) : (
            <>
              {/* A dangerous question starts on Cancel, so a stray Enter
                  cannot end an event or delete anything. */}
              <button type="button" className="btn" autoFocus={dialog.kind === "ask" && dialog.danger} onClick={() => finish(false)}>
                {dialog.kind === "ask" ? dialog.cancelLabel : "Cancel"}
              </button>
              <button
                type="submit"
                className={`btn ${dialog.kind === "ask" && dialog.danger ? "btn-danger" : "btn-primary"}`}
                autoFocus={dialog.kind === "ask" && !dialog.danger}
              >
                {dialog.confirmLabel}
              </button>
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}
