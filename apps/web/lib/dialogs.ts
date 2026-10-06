/**
 * The app's own notes, questions and type-in boxes — in place of the
 * browser's alert(), confirm() and prompt().
 *
 * Those froze the whole page, looked like the browser rather than the app,
 * could not be styled or read well on a phone, and a stray one mid-show
 * stopped every clock on the screen until somebody pressed OK. These are the
 * same three things, drawn by `DialogHost`:
 *
 *  - `say(message)`            a note that appears at the top and goes by itself
 *  - `ask({...})`              a question with two buttons → Promise<boolean>
 *  - `askText({...})`          a labelled box to type in   → Promise<string | null>
 *  - `showSecret({...})`       something to copy (an access token) with a Copy button
 *
 * Module-level and framework-free, so any handler can call them; the host
 * subscribes and renders. Replaced all 37 browser pop-ups on 6 Oct.
 */

export type Tone = "info" | "success" | "error";

export interface Note {
  id: number;
  text: string;
  tone: Tone;
}

export type Dialog =
  | { kind: "ask"; id: number; title: string; message?: string; confirmLabel: string; cancelLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | {
      kind: "text";
      id: number;
      title: string;
      label: string;
      value: string;
      placeholder?: string;
      hint?: string;
      confirmLabel: string;
      inputType: "text" | "password" | "date" | "url";
      validate?: (v: string) => string | null;
      resolve: (v: string | null) => void;
    }
  | { kind: "secret"; id: number; title: string; message: string; secret: string; resolve: () => void };

interface State {
  notes: Note[];
  dialog: Dialog | null;
  queue: Dialog[];
}

let state: State = { notes: [], dialog: null, queue: [] };
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const set = (next: State) => {
  state = next;
  emit();
};

export const dialogStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  get: () => state,
  /** Closes the current dialog and opens the next one waiting, if any. */
  close() {
    const [next, ...rest] = state.queue;
    set({ ...state, dialog: next ?? null, queue: rest });
  },
  dismissNote(id: number) {
    set({ ...state, notes: state.notes.filter((n) => n.id !== id) });
  },
};

const open = (d: Dialog) => {
  if (state.dialog) set({ ...state, queue: [...state.queue, d] });
  else set({ ...state, dialog: d });
};

/** A short note at the top of the screen. Errors stay longer and can be closed. */
export function say(text: string, tone: Tone = "info"): void {
  const note = { id: nextId++, text, tone };
  set({ ...state, notes: [...state.notes.slice(-2), note] });
  window.setTimeout(() => dialogStore.dismissNote(note.id), tone === "error" ? 9000 : 5000);
}

/** Says what went wrong, in the error's own words. */
export function sayError(err: unknown, lead = ""): void {
  const msg = err instanceof Error ? err.message : String(err);
  say(lead ? `${lead} ${msg}` : msg, "error");
}

export function ask(opts: { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) =>
    open({
      kind: "ask",
      id: nextId++,
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? "OK",
      cancelLabel: opts.cancelLabel ?? "Cancel",
      danger: opts.danger ?? false,
      resolve,
    }),
  );
}

export function askText(opts: {
  title: string;
  label: string;
  value?: string;
  placeholder?: string;
  hint?: string;
  confirmLabel?: string;
  inputType?: "text" | "password" | "date" | "url";
  /** Return a sentence saying what is wrong, or null when it is fine. */
  validate?: (v: string) => string | null;
}): Promise<string | null> {
  return new Promise((resolve) =>
    open({
      kind: "text",
      id: nextId++,
      title: opts.title,
      label: opts.label,
      value: opts.value ?? "",
      placeholder: opts.placeholder,
      hint: opts.hint,
      confirmLabel: opts.confirmLabel ?? "Save",
      inputType: opts.inputType ?? "text",
      validate: opts.validate,
      resolve,
    }),
  );
}

/** Something to hand on privately — shown once, with a Copy button. */
export function showSecret(opts: { title: string; message: string; secret: string }): Promise<void> {
  return new Promise((resolve) => open({ kind: "secret", id: nextId++, ...opts, resolve }));
}
