/**
 * What each recorded thing means, in words (24 Oct 2026): one wording shared
 * by Account activity, the timeline and the assistant's read of it, so the
 * same event never reads two ways.
 */

/** Account activity: sign-ins, access, deletions. */
export const AUDIT_WORDS: Record<string, string> = {
  "login.ok": "Signed in",
  "login.failed": "Tried to sign in, but the email or password was wrong",
  "login.throttled": "Sign-in blocked for a minute (too many tries)",
  "password.changed": "Changed their password",
  "password.change_failed": "Tried to change password, but typed the old one wrong",
  "password.reset_by_admin": "Password reset by an administrator",
  "invite.sent": "Invitation sent",
  "invite.withdrawn": "Invitation cancelled",
  "invite.accepted": "Accepted an invitation",
  "user.created": "Account made",
  "user.updated": "Account details changed",
  "user.deleted": "Account deleted",
  "access.changed": "Changed what someone can open",
  "token.user_rotated": "Personal access token replaced",
  "token.company_rotated": "Company access token replaced",
  "company.created": "Company made",
  "company.deleted": "Company deleted",
  "event.deleted": "Event deleted",
  "event.archived": "Event archived",
  "sheet.deleted": "Show deleted",
  "sheet.archived": "Show archived",
  "sheet.reimported": "Show rebuilt from its file",
  "sheet.viewing_changed": "Show closed to viewers, or opened again",
  "code.created": "View-only link made",
  "code.revoked": "View-only link switched off",
  "kind_of_show.deleted": "Kind of show deleted",
  "error_log.cleared": "Error log cleared",
  "sheet.change_undone": "Undid one change to a show",
  "mcp.connected": "Connected an AI assistant",
  "mcp.disconnected": "Disconnected an AI assistant",
  "mcp.update_cells": "AI assistant edited text",
  "mcp.set_duration": "AI assistant changed a duration",
  "mcp.set_start_time": "AI assistant changed a start time",
  "mcp.add_rows": "AI assistant added rows",
  "mcp.move_row": "AI assistant moved a row",
  "mcp.strike_row": "AI assistant struck a row, or put one back",
  "mcp.delete_rows": "AI assistant deleted rows",
  "mcp.read_error_log": "AI assistant read the error log",
  "mcp.resolve_errors": "AI assistant marked errors as fixed",
  "sheet.signals_changed": "Changed a show's on-cue signals",
  "session.signed_out": "Signed out one of their devices",
  "session.others_signed_out": "Signed out everywhere else",
  "trap.touched": "Touched the trap page — nothing real links there",
  "lockdown.on": "Locked everything down",
  "lockdown.off": "Ended the lockdown",
};

/** A show action, by whoever pressed it — or by the clock, when nobody did. */
export function showWords(action: string, byPerson: boolean): string {
  if (!byPerson) {
    switch (action) {
      case "jump":
      case "next":
        return "The clock moved the cue on";
      case "stop":
        return "The server ended the show (no command for a day)";
      default:
        return `The show: ${action.replace(/_/g, " ")}`;
    }
  }
  const words: Record<string, string> = {
    start: "Pressed Start show",
    stop: "Pressed Stop — the show ended",
    pause: "Paused the show",
    resume: "Carried on after a pause",
    next: "Moved the cue on",
    prev: "Moved the cue back",
    jump: "Moved the cue to a row",
    fire: "Fired a cue",
    clock_on: "Gave the show to the clock",
    clock_off: "Took the show off the clock",
    clock_hold: "Held the clock",
    clock_release: "Let the clock go",
    unplay: "Marked a row as not played",
    mark_played: "Marked a row as played",
    walk: "Moved the walkthrough",
    message: "Put a message up",
    message_down: "Took the message down",
  };
  return words[action] ?? action.replace(/_/g, " ");
}

/** A page, as somebody opened it. */
export function pageWords(path: string): string {
  const first = path.split("/")[1] ?? "";
  const pages: Record<string, string> = {
    "": "Opened the start page",
    admin: path.startsWith("/admin/users")
      ? "Opened Users"
      : path.startsWith("/admin/activity")
        ? "Opened Account activity"
        : path.startsWith("/admin/errors")
          ? "Opened the error log"
          : path.startsWith("/admin/timeline")
            ? "Opened the timeline"
            : "Opened the dashboard",
    account: "Opened My account",
    help: "Opened Help",
    show: "Opened the show page",
    edit: "Opened the edit page",
    view: "Opened the crew view",
    timer: "Opened the timer",
    display: "Opened the backstage display",
    prompter: "Opened the prompter",
    changes: "Opened a sheet's changes",
    login: "Opened the sign-in page",
    guest: "Opened a guest pass",
    invite: "Opened an invitation",
  };
  return pages[first] ?? `Opened ${path}`;
}

const SCREEN: Record<string, string> = {
  show: "the show page",
  edit: "the edit page",
  view: "the crew view",
  timer: "the timer",
  display: "the backstage display",
  prompter: "the prompter",
};

const lasted = (sec: number): string =>
  sec < 60 ? `${sec} s` : sec < 3600 ? `${Math.round(sec / 60)} min` : `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`;

/** A show screen joining. */
export const connectWords = (page: string | null | undefined): string => `Connected ${SCREEN[page ?? ""] ?? "a sheet screen"} to the show`;

/**
 * A show screen leaving, and how — which is the useful part. 1000 and 1001
 * are a page closed or left; 1006 is the link LOST, with no goodbye — the
 * network dropped or the device slept; 1012 is the server restarting.
 */
export function disconnectWords(page: string | null | undefined, code: number | null | undefined, seconds: number | null | undefined): string {
  const screen = SCREEN[page ?? ""] ?? "a sheet screen";
  const after = seconds != null ? ` after ${lasted(seconds)}` : "";
  if (code === 1006) return `Lost the show link on ${screen}${after} — the network dropped or the device slept`;
  if (code === 1012 || code === 1013) return `Disconnected from ${screen}${after} — the server restarted`;
  if (code != null && code >= 4000) return `Put off ${screen} by the server${after} (code ${code})`;
  return `Closed ${screen}${after}`;
}
