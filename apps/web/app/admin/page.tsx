"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandWordmark } from "../../components/ui";
import {
  api,
  ApiError,
  copyViewOnlyLink,
  getAdminToken,
  setAdminToken,
  type EventSummary,
  type TemplateSummary,
} from "../../lib/api";
import { BrandMark, Dropdown, Icon, MissingFields } from "../../components/ui";
import { ImportPanel } from "../../components/ImportPanel";
import { SideNavSection, WithSideNav } from "../../components/SideNav";
import { imageFileToDataUrl, pickImage } from "../../lib/pickImage";
import { AdminNavSection } from "../../components/AdminNav";
import { VersionBadge } from "../../components/VersionBadge";
import { LocationDialog, TimezoneField } from "../../components/TimezoneField";
import { isValidTimeZone, EVENT_TYPES, resolveEventType, type EventTypeSpec } from "@opencall/core";

/** Event artwork slot: click (or drop an image on it) to set, hover ✕ to clear. */
function ImageSlot({ value, hint, onChange }: { value: string | null; hint: string; onChange: (img: string | null) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      className="img-slot"
      data-tip={value ? `${hint} — click to replace` : `${hint} — click to add, or drop an image`}
      onClick={() => void pickImage().then((img) => img && onChange(img))}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith("image/")) void imageFileToDataUrl(file).then((img) => img && onChange(img));
      }}
      style={{
        position: "relative",
        height: 40,
        width: 40,
        borderRadius: 8,
        cursor: "pointer",
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        border: value && !drag ? "1px solid transparent" : `1.5px dashed ${drag ? "var(--accent)" : "var(--border)"}`,
        background: drag ? "var(--accent-soft)" : undefined,
      }}
    >
      {value ? (
        <img src={value} alt="" style={{ height: 34, width: 34, objectFit: "contain" }} />
      ) : (
        <span style={{ color: "var(--text-3)", fontSize: 18, lineHeight: 1 }}>+</span>
      )}
      {value && (
        <button
          type="button"
          className="img-slot-x"
          data-tip="Remove image"
          onClick={(e) => {
            e.stopPropagation();
            onChange(null);
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** Sports with a live outcome flow (full time win/lose/draw, golden point…). */
/**
 * What KIND of show this is. Drives the live result flow — and only that, so
 * getting it wrong costs a dropdown, not a re-import.
 *
 * Grouped, because a cricket match and a product launch are not neighbours in
 * anybody's head. The blurb is shown under the choice: nobody should have to
 * guess what picking "AFL" will do.
 */
/**
 * Which kind of show a sheet is.
 *
 * Lives on the SHEET rather than the event: one match day can run a netball
 * game off one sheet and a rugby league game off another, and they do not end
 * the same way. `custom` are the kinds a company added for itself.
 */
function EventTypeSelect({
  value,
  onChange,
  compact,
  invalid,
  custom = [],
  placeholder = "Choose an event type…",
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  compact?: boolean;
  invalid?: boolean;
  custom?: EventTypeSpec[];
  placeholder?: string;
}) {
  const groups = ["Sport", "Production"] as const;
  const chosen = resolveEventType(value, custom);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <select
        className={`input ${invalid ? "field-missing" : ""}`}
        data-tip="Decides what the live result chooser offers — a rugby league match ends differently from a product launch"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        style={compact ? { height: 30, fontSize: "var(--fs-sm)", padding: "0 8px" } : undefined}
      >
        <option value="">{placeholder}</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {EVENT_TYPES.filter((t) => t.group === g).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </optgroup>
        ))}
        {custom.length > 0 && (
          <optgroup label="Yours">
            {custom.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {chosen?.blurb && !compact && <span className="field-hint">{chosen.blurb}</span>}
    </span>
  );
}

/** Today in the USER'S timezone — toISOString() is UTC, which is yesterday
 *  every morning east of Greenwich. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Pops the native calendar as soon as a date field is focused or clicked. */
function openDatePicker(e: { currentTarget: HTMLInputElement }): void {
  try {
    e.currentTarget.showPicker?.();
  } catch {
    // showPicker demands a user gesture; the field still works without it.
  }
}

/**
 * A company, asked for properly.
 *
 * It was a `window.prompt`, which cannot say what it wants, cannot mark what
 * is missing, and cannot be styled — so an empty name failed by silently doing
 * nothing. The token it produces is shown once and never again, which is a
 * reason to be careful with the screen that produces it.
 */
function CreateCompanyForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [tried, setTried] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const missing = [!name.trim() && "Company name"].filter((v) => typeof v === "string") as string[];

  if (token)
    return (
      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>
        <strong>Company created</strong>
        <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
          Its showcaller token is below. It is shown once — copy it somewhere safe before closing this.
        </span>
        <code style={{ background: "var(--bg)", border: "1px solid var(--border)", padding: "6px 8px", borderRadius: 4, wordBreak: "break-all" }}>
          {token}
        </code>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm btn-primary" onClick={() => void navigator.clipboard.writeText(token)}>
            Copy token
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              setToken(null);
              setOpen(false);
              setName("");
              setTried(false);
            }}
          >
            Done
          </button>
        </div>
      </div>
    );

  if (!open)
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        {Icon.plus} Company
      </button>
    );

  return (
    <form
      className="panel field-row"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (missing.length > 0) return;
        void api.createCompany(name.trim()).then(({ companyToken }) => {
          setToken(companyToken);
          onCreated();
        });
      }}
    >
      <div>
        <label className="field-label">Company name</label>
        <input
          className={"input " + (tried && !name.trim() ? "field-missing" : "")}
          autoFocus
          placeholder="Harbour Park Productions"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ minWidth: 240 }}
        />
      </div>
      {tried && <MissingFields missing={missing} />}
      <div className="field-actions">
        <button className="btn btn-primary" type="submit">
          Create company
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function CreateEventForm({ onCreated, teamId }: { onCreated: () => void; teamId?: string }) {
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [sport, setSport] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const today = localToday();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  // Only after a first attempt: naming everything wrong before anyone has
  // typed is nagging, not help.
  const [tried, setTried] = useState(false);

  /**
   * Everything an event needs before it is worth creating.
   *
   * The kind of show is NOT on this list any more. It belongs to each run
   * sheet, and a day that runs two sports has no single answer to give here —
   * so it is offered as a default for the sheets made under it, not demanded.
   */
  const missing = [
    !name.trim() && "Event name",
    !location.trim() && "Event location",
    !startDate && "Start date",
    !endDate && "End date",
    !isValidTimeZone(timezone) && "A valid time zone",
  ].filter((v): v is string => typeof v === "string");

  if (!open)
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        {Icon.plus} New event
      </button>
    );

  return (
    <form
      className="panel field-row"
      style={{ margin: "0 0 4px" }}
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (missing.length > 0) return;
        void api.createEvent({ name: name.trim(), location: location.trim() || undefined, startDate, endDate, timezone, sport, teamId }).then(() => {
          setName("");
          setLocation("");
          setOpen(false);
          onCreated();
        });
      }}
    >
      <div>
        <label className="field-label">Event name</label>
        <input
          className={`input ${tried && !name.trim() ? "field-missing" : ""}`}
          autoFocus
          placeholder="Launch Night"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label className="field-label">Event location</label>
        <input
          className={`input ${tried && !location.trim() ? "field-missing" : ""}`}
          placeholder="Main arena"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>
      <div>
        <label className="field-label">Starts</label>
        <input
          className="input"
          type="date"
          value={startDate}
          onFocus={openDatePicker}
          onClick={openDatePicker}
          onChange={(e) => {
            const v = e.target.value;
            setStartDate(v);
            if (endDate < v) setEndDate(v); // end date may never precede the start
          }}
        />
      </div>
      <div>
        <label className="field-label">Ends</label>
        <input
          className="input"
          type="date"
          min={startDate}
          value={endDate}
          onFocus={openDatePicker}
          onClick={openDatePicker}
          onChange={(e) => setEndDate(e.target.value < startDate ? startDate : e.target.value)}
        />
      </div>
      <TimezoneField value={timezone} onChange={setTimezone} atDate={startDate} />
      <div>
        <label className="field-label">Usual kind of show</label>
        <EventTypeSelect value={sport} onChange={setSport} placeholder="Leave to each run sheet…" />
      </div>
      {tried && <MissingFields missing={missing} />}
      <div className="field-actions">
        <button className="btn btn-primary" type="submit">
          Create event
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function CreateRundownForm({
  eventId,
  templates,
  onCreated,
  leading,
}: {
  eventId: string;
  templates: TemplateSummary[];
  onCreated: () => void;
  /** Rendered at the start of the row (the Import run sheet button). */
  leading?: React.ReactNode;
}) {
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");

  return (
    <form
      className="rundown-create"
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "10px 16px 14px" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const body: Parameters<typeof api.createRundown>[0] = { eventId, name: name.trim() };
        if (templateId) body.templateId = templateId;
        void api.createRundown(body).then(() => {
          setName("");
          onCreated();
        });
      }}
    >
      {leading && <div style={{ flexBasis: "100%", marginBottom: 2 }}>{leading}</div>}
      <input className="input" placeholder="New rundown name" value={name} onChange={(e) => setName(e.target.value)} />
      {templates.length > 0 && (
        <select
          className="input"
          data-tip="Start the new rundown empty, or copy a saved template"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          <option value="">Start blank</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              From template: {t.name}
            </option>
          ))}
        </select>
      )}
      <button className="btn" type="submit">
        {Icon.plus} Rundown
      </button>
    </form>
  );
}

function TokenGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    void api
      .login(email.trim(), password)
      .then(({ token: session }) => {
        setAdminToken(session);
        onUnlocked();
      })
      .catch(() => {
        setError("Invalid email or password.");
        setBusy(false);
      });
  };

  return (
    <div style={{ maxWidth: 420, margin: "10vh auto", display: "grid", gap: 14 }}>
      <form
        className="panel"
        style={{ display: "grid", gap: 12 }}
        onSubmit={login}
      >
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: "1.05rem" }}>Sign in</h2>
          <p style={{ margin: 0, color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
            This server is locked. Sign in with your account, or use a token below.
          </p>
        </div>
        <input className="input" type="email" autoFocus autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div style={{ color: "var(--over)", fontSize: "var(--fs-sm)" }}>{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy || !email.trim() || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <form
        className="panel"
        style={{ display: "grid", gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!token.trim()) return;
          setAdminToken(token.trim());
          onUnlocked();
        }}
      >
        <label className="field-label" style={{ margin: 0 }}>
          Or use a token (admin, company, or personal)
        </label>
        <input
          className="input"
          type="password"
          placeholder="Token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button className="btn" type="submit" disabled={!token.trim()}>
          Unlock with token
        </button>
      </form>
    </div>
  );
}

/** Inline start/end editor for an event card. End can never precede start. */
function DatesEditor({
  event,
  onSaved,
}: {
  event: { id: string; startDate: string; endDate: string };
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(event.startDate);
  const [end, setEnd] = useState(event.endDate);
  const [error, setError] = useState<string | null>(null);

  if (!open)
    return (
      <button className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        Dates…
      </button>
    );

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input
        className="input"
        type="date"
        value={start}
        onFocus={openDatePicker}
        onClick={openDatePicker}
        onChange={(e) => {
          const v = e.target.value;
          setStart(v);
          if (end < v) setEnd(v);
        }}
        style={{ padding: "3px 6px" }}
      />
      <span style={{ color: "var(--text-3)" }}>→</span>
      <input
        className="input"
        type="date"
        min={start}
        value={end}
        onFocus={openDatePicker}
        onClick={openDatePicker}
        onChange={(e) => setEnd(e.target.value < start ? start : e.target.value)}
        style={{ padding: "3px 6px" }}
      />
      <button
        className="btn btn-sm btn-primary"
        onClick={() => {
          if (end < start) {
            setError("End date cannot be before the start date.");
            return;
          }
          void api
            .patchEvent(event.id, { startDate: start, endDate: end })
            .then(() => {
              setOpen(false);
              setError(null);
              onSaved();
            })
            .catch((err) => setError(String(err)));
        }}
      >
        Save
      </button>
      <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
        ✕
      </button>
      {error && <span style={{ color: "var(--over)", fontSize: "var(--fs-xs)" }}>{error}</span>}
    </span>
  );
}

/**
 * Phone-sized screens collapse each entity's action buttons into one ⋯ menu
 * (the buttons themselves get .hide-mobile). Desktop is unchanged.
 */
function MobileActions({ children }: { children: React.ReactNode }) {
  return (
    <Dropdown label="⋯" align="right" className="btn btn-sm mobile-only">
      {children}
    </Dropdown>
  );
}

/** Prompt-based date editing for the mobile menu (desktop has the inline editor). */
function promptDates(event: { id: string; startDate: string; endDate: string }, onSaved: () => void): void {
  const start = window.prompt("Start date (YYYY-MM-DD)", event.startDate);
  if (start === null) return;
  const end = window.prompt("End date (YYYY-MM-DD)", event.endDate < start ? start : event.endDate);
  if (end === null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    window.alert("Dates must be YYYY-MM-DD.");
    return;
  }
  if (end < start) {
    window.alert("End date cannot be before the start date.");
    return;
  }
  void api
    .patchEvent(event.id, { startDate: start, endDate: end })
    .then(onSaved)
    .catch((err) => window.alert(String(err)));
}

/**
 * Armed two-click destructive button (no browser dialogs).
 *
 * On confirm it goes at once, rather than sitting there until the server has
 * answered and the list has reloaded. Pressing a delete button and watching it
 * hold reads as "that did not work" — and the second press it invites is the
 * one you cannot take back.
 *
 * It comes back if the delete actually fails, which is the only honest reason
 * for it to reappear.
 */
function DangerButton({
  label,
  confirmLabel,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<unknown>;
}) {
  const [armed, setArmed] = useState(false);
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <button
      className={`btn btn-sm btn-danger ${armed ? "is-on" : ""}`}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          window.setTimeout(() => setArmed(false), 3000);
          return;
        }
        setArmed(false);
        setGone(true);
        // Awaited only to put the button back when the delete did not happen.
        void Promise.resolve(onConfirm()).catch(() => setGone(false));
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

/** One un-stopped session, exactly as `/live` reports it. Derived rather than
 *  restated so it cannot drift from the endpoint's own answer. */
type LiveSession = Awaited<ReturnType<typeof api.live>>[number];

/**
 * How a run sheet's session looks from the dashboard — and whether to believe it.
 *
 * Pressing Stop is the only thing that ends a session, and nothing times one
 * out, so a show closed by shutting a laptop keeps announcing itself as LIVE
 * indefinitely: four of them piled up on one machine inside a day. A list where
 * half the red badges are ghosts teaches people to ignore all of them, which
 * costs the one that is real.
 *
 * So a session the server has marked `stale` (nothing moved for hours) drops
 * out of the red badge and into the same quiet grey chip that carries
 * "archived" a few pixels to its left, saying what was actually observed —
 * left running — instead of pronouncing it dead. That wording is deliberate:
 * `stale` is a doubt, not a verdict, and a genuine show that sat still through
 * a long interval earns exactly the same flag. Nothing here ends the session;
 * the reader is handed the evidence and the judgement.
 *
 * The tooltip gives the timestamp rather than naming the threshold — how many
 * hours count as too long is the server's choice (and its comment), and a
 * number repeated here would be the one that goes stale.
 */
function LiveChip({ session }: { session: LiveSession | undefined }) {
  if (!session) return null;

  if (session.stale)
    return (
      <span
        className="chip"
        style={{ marginLeft: 10 }}
        // Touch devices never see a data-tip, so the chip's own words have to
        // carry the meaning on their own — this only adds the evidence.
        data-tip={`Still marked as ${session.state}, but nothing has moved since ${new Date(
          session.lastMoveAt,
        ).toLocaleString()}. A session ends only when someone presses Stop — if this show is over, open it and stop it.`}
      >
        {session.state === "paused" ? "left paused" : "left running"}
      </span>
    );

  return (
    <span className="live-badge" style={{ marginLeft: 10 }}>
      {session.state === "paused" ? "PAUSED" : "LIVE"}
    </span>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [locEvent, setLocEvent] = useState<EventSummary | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  /** Whole session rows, not just the state string: the dashboard has to tell a
   *  show that is running from one that was merely never stopped. */
  const [live, setLive] = useState<Map<string, LiveSession>>(new Map());
  const [error, setError] = useState(false);
  const [locked, setLocked] = useState(false);
  // Import panel target: an event (new rundown), optionally replacing an existing rundown's content.
  const [importFor, setImportFor] = useState<{ eventId: string; replace?: { id: string; name: string } } | null>(null);
  const [me, setMe] = useState<{
    role: "admin" | "company" | "user" | null;
    devOpen?: boolean;
    teamId?: string;
    teamName?: string;
    name?: string;
    canManage?: boolean;
    grants?: { kind: string; targetId: string }[];
  } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [companies, setCompanies] = useState<{ id: string; name: string; companyToken: string | null; logo: string | null; eventCount: number }[]>([]);
  /** Kinds of show this company added for itself, offered beside the built-ins. */
  const [customTypes, setCustomTypes] = useState<EventTypeSpec[]>([]);
  /**
   * Whether this browser is holding an access token — answered AFTER hydration.
   *
   * It used to be read straight out of localStorage while rendering, and the
   * server has no localStorage to read: it always answered "no". So a signed-in
   * admin got server HTML saying no sign-in was needed and no Sign out button,
   * then their own browser rendered the opposite, and React threw a hydration
   * mismatch on every single load of this page. Starting from the server's
   * answer and correcting it once the browser is running is the same shape the
   * side panel already uses for its own stored state.
   *
   * Kept in step by `reload`, which runs on mount and again after anything that
   * can change the token — signing in through the gate, or signing out.
   */
  const [hasToken, setHasToken] = useState(false);

  const reload = useCallback(() => {
    setHasToken(getAdminToken() != null);
    api
      .events(showArchived)
      .then((data) => {
        setEvents(data);
        setLocked(false);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setLocked(true);
        else setError(true);
      });
    api.templates().then(setTemplates).catch(() => undefined);
    api.me().then(setMe).catch(() => undefined);
    api.companies().then(setCompanies).catch(() => setCompanies([]));
    api.eventTypes().then(setCustomTypes).catch(() => setCustomTypes([]));
  }, [showArchived]);
  useEffect(reload, [reload]);

  // Live-now poller: which rundowns have a running/paused session — and, since
  // nothing but Stop ever ends one, how long each has gone untouched.
  useEffect(() => {
    let stop = false;
    const poll = () =>
      api
        .live()
        .then((rows) => {
          if (!stop) setLive(new Map(rows.map((r) => [r.rundownId, r])));
        })
        .catch(() => undefined);
    poll();
    const id = setInterval(poll, 10_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const rename = (kind: "event" | "rundown", id: string, current: string) => {
    const name = window.prompt(`Rename ${kind}`, current);
    if (!name || name === current) return;
    void (kind === "event" ? api.patchEvent(id, { name }) : api.patchRundown(id, { name })).then(reload);
  };

  // What this sign-in may do, mirroring the server's rules so the dashboard
  // only offers what will actually be allowed. Admins and company tokens
  // manage everything they can see; account holders manage an event when a
  // grant covers the event itself or the company that owns it — a view grant
  // never does.
  const grants = me?.grants ?? [];
  const canManageRow = (event: EventSummary): boolean => {
    if (me?.role === "admin" || me?.role === "company" || me?.devOpen) return true;
    if (me?.role !== "user") return false;
    return grants.some(
      (g) => (g.kind === "event" && g.targetId === event.id) || (g.kind === "company" && g.targetId === event.teamId),
    );
  };
  /** Creating events needs company-level reach over the group being added to. */
  const canCreateEventsIn = (teamId: string | null): boolean => {
    if (me?.role === "admin" || me?.role === "company" || me?.devOpen) return true;
    if (me?.role !== "user") return false;
    return grants.some((g) => g.kind === "company" && (teamId == null || g.targetId === teamId));
  };

  // Events appear underneath their company. Admin sees every company;
  // a company credential sees exactly one group — its own.
  const eventsByTeam = new Map<string, EventSummary[]>();
  for (const event of events ?? []) {
    const list = eventsByTeam.get(event.teamId) ?? [];
    list.push(event);
    eventsByTeam.set(event.teamId, list);
  }
  const groups =
    me?.role === "admin" && companies.length > 0
      ? companies.map((c) => ({
          id: c.id,
          name: c.name,
          companyToken: c.companyToken,
          logo: c.logo,
          real: true,
          events: eventsByTeam.get(c.id) ?? [],
        }))
      : [{ id: "own", name: me?.teamName ?? "Events", companyToken: null, logo: null, real: false, events: events ?? [] }];

  if (locked)
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
        <TokenGate onUnlocked={reload} />
      </div>
    );

  const settings = (
    <>
      <SideNavSection heading="Dashboard">
        <button type="button" className="menu-item" onClick={() => setShowArchived((a) => !a)}>
          <span className="check">{showArchived && "✓"}</span>
          Show archived
        </button>
      </SideNavSection>
      {(me?.role === "admin" || me?.role === "company" || me?.canManage) && <AdminNavSection role={me?.role} />}
      <SideNavSection heading="Credentials">
        {/* Who you are, then what you can do about it.
            It used to be a line of prose, then a menu item, then ANOTHER line
            of prose — three things at two different indents, the identity
            wrapping mid-phrase. Now it is one identity block sitting on the
            same left edge as the items below it, and the "no sign-in needed"
            note is part of that block rather than an orphan under the
            actions, because it describes the session and not an action. */}
        <div className="sidenav-identity">
          <strong>
            {me?.role === "admin"
              ? "Administrator"
              : me?.role === "company"
                ? me.teamName
                : me?.role === "user"
                  ? me.name
                  : "Not signed in"}
          </strong>
          <span>
            {me?.role === "admin"
              ? "Full access"
              : me?.role === "company"
                ? "Company access"
                : me?.role === "user"
                  ? me.canManage
                    ? "Manager"
                    : "View access"
                  : hasToken
                    ? "Session not recognised"
                    : "Dev-open server — no sign-in needed"}
          </span>
        </div>
        <Link className="menu-item" href="/account">
          <span className="check" />
          My account
        </Link>
        {hasToken && (
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              // Sessions are revoked server-side; plain tokens are just forgotten.
              const bearer = getAdminToken();
              const done = () => {
                setAdminToken(null);
                reload();
              };
              if (bearer?.startsWith("ses_")) void api.logout().catch(() => undefined).then(done);
              else done();
            }}
          >
            <span className="check" />
            Sign out
          </button>
        )}
      </SideNavSection>
    </>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <WithSideNav title={me?.role === "company" ? me.teamName : "Admin"} settings={settings}>
      <main className="admin-main">
        <header style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: "1.5rem" }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
              <BrandWordmark size={22} />{" "}
              <span style={{ color: "var(--text-3)", fontWeight: 500 }}>
                {me?.role === "company" ? me.teamName : me?.role === "user" ? me.name : "admin"}
              </span>
            </h1>
            <p style={{ color: "var(--text-2)", margin: "2px 0 0", fontSize: "var(--fs-sm)" }}>
              {me?.role === "company"
                ? "Your company's events and shows. Only your own data is visible here."
                : "Every event company, event, and show. Admin sees everything."}
            </p>
          </div>
          {me?.role === "admin" && <CreateCompanyForm onCreated={reload} />}
        </header>

        {error && (
          <div className="panel" style={{ borderColor: "var(--over)", color: "var(--over)", marginBottom: 16 }}>
            Sync server not reachable — run <code>pnpm dev</code> (and <code>pnpm seed</code> first).
          </div>
        )}

        {events == null && !error && (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="skeleton" style={{ height: 110 }} />
            <div className="skeleton" style={{ height: 110 }} />
          </div>
        )}


        <div style={{ display: "grid", gap: 20 }}>
          {groups.map((group) => (
            <section key={group.id}>
              {/* Lands the company's own actions on the same right edge as
                  every event's and every sheet's, which they hung 17px outside
                  of. 19px = the cards' 16px padding, their 1px border, and the
                  2px by which their flex gap (12) exceeds this row's (10) —
                  both rows end in a mobile-only menu that is hidden here, so
                  the last visible button sits one gap in from the edge. */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 19px 8px 2px" }}>
                {"logo" in group && (group as { logo?: string | null }).logo && (
                  <img
                    src={(group as { logo?: string | null }).logo!}
                    alt=""
                    style={{ height: 30, width: 30, objectFit: "contain", borderRadius: 6 }}
                  />
                )}
                <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>{group.name}</h2>
                <span className="chip">{group.events.length} event{group.events.length === 1 ? "" : "s"}</span>
                <span style={{ flex: 1 }} />
                {me?.role === "admin" && group.real && (() => {
                  const renameCompany = () => {
                    const name = window.prompt("Rename company", group.name);
                    if (name?.trim() && name.trim() !== group.name)
                      void api.patchCompany(group.id, { name: name.trim() }).then(reload);
                  };
                  const pickLogo = () =>
                    void pickImage().then((logo) => {
                      if (logo) void api.patchCompany(group.id, { logo }).then(reload);
                    });
                  const rotate = () =>
                    void api.rotateCompanyToken(group.id).then(({ companyToken }) => {
                      window.alert(`New token (the old one stops working):\n\n${companyToken}`);
                      reload();
                    });
                  return (
                    <>
                      <span className="hide-mobile" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <button className="btn btn-sm btn-ghost" onClick={renameCompany}>
                          Rename
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          data-tip="Company logo — shown beside the company and on its events"
                          onClick={pickLogo}
                        >
                          Logo
                        </button>
                        {group.companyToken && (
                          <button
                            className="btn btn-sm"
                            data-tip="Copy this company's showcaller credential"
                            onClick={() => void navigator.clipboard.writeText(group.companyToken!)}
                          >
                            Copy token
                          </button>
                        )}
                        <button className="btn btn-sm btn-ghost" onClick={rotate}>
                          Rotate
                        </button>
                        <DangerButton
                          label="Delete company"
                          confirmLabel={`Delete company + ${group.events.length} event${group.events.length === 1 ? "" : "s"}?`}
                          onConfirm={() => api.deleteCompany(group.id).then(reload)}
                        />
                      </span>
                      <MobileActions>
                        <button type="button" className="menu-item" onClick={renameCompany}>
                          <span className="check" />
                          Rename
                        </button>
                        <button type="button" className="menu-item" onClick={pickLogo}>
                          <span className="check" />
                          Logo…
                        </button>
                        {group.companyToken && (
                          <button
                            type="button"
                            className="menu-item"
                            onClick={() => void navigator.clipboard.writeText(group.companyToken!)}
                          >
                            <span className="check" />
                            Copy token
                          </button>
                        )}
                        <button type="button" className="menu-item" onClick={rotate}>
                          <span className="check" />
                          Rotate token
                        </button>
                        <div className="menu-sep" />
                        <div data-keep-open style={{ padding: "4px 9px" }}>
                          <DangerButton
                            label="Delete company"
                            confirmLabel={`Delete + ${group.events.length} event${group.events.length === 1 ? "" : "s"}?`}
                            onConfirm={() => api.deleteCompany(group.id).then(reload)}
                          />
                        </div>
                      </MobileActions>
                    </>
                  );
                })()}
              </div>
              <div style={{ display: "grid", gap: 12, paddingLeft: 12, borderLeft: "2px solid var(--border-subtle)" }}>
                {group.events.map((event) => (
            <section key={event.id} className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 4px", opacity: event.archivedAt ? 0.55 : 1 }}>
                <ImageSlot
                  value={event.image1}
                  hint="Event image / home team"
                  onChange={(img) => void api.patchEvent(event.id, { image1: img }).then(reload)}
                />
                <ImageSlot
                  value={event.image2}
                  hint="Away team (sport)"
                  onChange={(img) => void api.patchEvent(event.id, { image2: img }).then(reload)}
                />
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ fontSize: "1.02rem", fontWeight: 650, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                    {event.name}
                    {event.archivedAt && <span className="chip">archived</span>}
                  </h2>
                  <div style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", marginTop: 2 }}>
                    {event.location ? `${event.location} · ` : ""}
                    {event.startDate} → {event.endDate}
                  </div>
                </div>
                <span style={{ flex: 1 }} />
                <span className="hide-mobile" style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn btn-sm btn-ghost" onClick={() => rename("event", event.id, event.name)}>
                  Rename
                </button>
                <DatesEditor key={`${event.startDate}${event.endDate}`} event={event} onSaved={reload} />
                {/* The kind of show is set per run sheet, on the sheet's own
                    row — an event can host two sports at once and one setting
                    up here could only ever describe one of them. */}
                <button
                  className="btn btn-sm btn-ghost"
                  data-tip="The event's location decides its timezone — clocks follow the daylight-saving rules in force there on the show date"
                  onClick={() => setLocEvent(event)}
                >
                  Event location…
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => void api.archiveEvent(event.id, !event.archivedAt).then(reload)}
                >
                  {event.archivedAt ? "Unarchive" : "Archive"}
                </button>
                <DangerButton
                  label="Delete"
                  confirmLabel="Delete event + rundowns?"
                  onConfirm={() => api.deleteEvent(event.id).then(reload)}
                />
                </span>
                <MobileActions>
                  <button type="button" className="menu-item" onClick={() => rename("event", event.id, event.name)}>
                    <span className="check" />
                    Rename
                  </button>
                  <button type="button" className="menu-item" onClick={() => promptDates(event, reload)}>
                    <span className="check" />
                    Dates…
                  </button>
                  <button type="button" className="menu-item" onClick={() => setLocEvent(event)}>
                    <span className="check" />
                    Event location…
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => void api.archiveEvent(event.id, !event.archivedAt).then(reload)}
                  >
                    <span className="check" />
                    {event.archivedAt ? "Unarchive" : "Archive"}
                  </button>
                  <div className="menu-sep" />
                  <div data-keep-open style={{ padding: "4px 9px" }}>
                    <DangerButton
                      label="Delete event"
                      confirmLabel="Delete event + rundowns?"
                      onConfirm={() => api.deleteEvent(event.id).then(reload)}
                    />
                  </div>
                </MobileActions>
              </div>
              <ul style={{ listStyle: "none", padding: "0 6px", margin: "6px 0 0" }}>
                {event.rundowns.map((r) => (
                  <li
                    key={r.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      // 14px on the right, not 10: the sheet's last control
                      // then finishes on the same line as the event's and the
                      // company's above it, instead of 4px outside them.
                      padding: "9px 14px 9px 10px",
                      borderTop: "1px solid var(--border-subtle)",
                      flexWrap: "wrap",
                      opacity: r.archivedAt ? 0.55 : 1,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 180 }}>
                      <strong style={{ fontWeight: 600 }}>{r.name}</strong>
                      {r.archivedAt && <span className="chip" style={{ marginLeft: 8 }}>archived</span>}
                      <LiveChip session={live.get(r.id)} />
                      <span style={{ color: "var(--text-3)", marginLeft: 10, fontSize: "var(--fs-sm)" }}>
                        {r.description ?? ""} {r.showDate ? `· ${r.showDate}` : ""}
                      </span>
                    </span>
                    {/* The kind of show belongs to the SHEET: a match day can
                        run netball off one and rugby league off the next, and
                        they do not end the same way. */}
                    {canManageRow(event) && (
                      <span className="hide-mobile">
                        <EventTypeSelect
                          compact
                          custom={customTypes}
                          value={r.sport ?? event.sport}
                          placeholder="Kind of show…"
                          onChange={(v) => void api.patchRundown(r.id, { sport: v }).then(reload)}
                        />
                      </span>
                    )}
                    {/* One button, decided by YOUR access: managers open the
                        console; view-only access opens the read-only view.
                        The other surfaces live in the ⋯ menu. */}
                    {canManageRow(event) ? (
                      <Link
                        href={`/show/${r.id}`}
                        className="btn btn-sm btn-primary"
                        style={{ textDecoration: "none" }}
                        data-tip="The showcaller console: run the show (start, pause, next) and edit live — everything in one screen"
                      >
                        Open show
                      </Link>
                    ) : (
                      <Link
                        href={`/view/${r.id}`}
                        className="btn btn-sm btn-primary"
                        style={{ textDecoration: "none" }}
                        data-tip="Read-only: follows the live show — your access level for this event"
                      >
                        View
                      </Link>
                    )}
                    {(
                      [
                        ["timer", "Full-screen timer for phones and confidence monitors — the item on air, what came before it and what is next"],
                        ["prompter", "Script prompter — large scrolling script that follows the caller"],
                      ] as const
                    ).map(([view, hint]) => (
                      <Link key={view} href={`/${view}/${r.id}`} className="chip" style={{ textDecoration: "none" }} data-tip={hint}>
                        {view}
                      </Link>
                    ))}
                    {canManageRow(event) && (
                    <span className="hide-mobile">
                      <Dropdown label="⋯" className="btn btn-sm btn-ghost">
                        <Link href={`/edit/${r.id}`} className="menu-item" style={{ textDecoration: "none" }} data-tip="Edit the sheet with no transport controls — safe while preparing content">
                          <span className="check" />
                          Edit content
                        </Link>
                        <Link href={`/view/${r.id}`} className="menu-item" style={{ textDecoration: "none" }} data-tip="Read-only: follows the live show, nothing can be changed">
                          <span className="check" />
                          Read-only view
                        </Link>
                        <div className="menu-sep" />
                        <button
                          type="button"
                          className="menu-item"
                          data-tip="Copy a URL that opens this rundown read-only — for camera operators and crew"
                          onClick={() =>
                            void copyViewOnlyLink(r.id).then((url) =>
                              window.alert(`View-only link copied:\n\n${url}\n\nAnyone with it can watch this rundown live.`),
                            )
                          }
                        >
                          <span className="check" />
                          Copy view link
                        </button>
                        <button
                          type="button"
                          className="menu-item"
                          data-tip="Re-import from the stored run sheet with the latest import quality — links and codes keep working"
                          onClick={() => setImportFor({ eventId: event.id, replace: { id: r.id, name: r.name } })}
                        >
                          <span className="check" />
                          Update import…
                        </button>
                        <button type="button" className="menu-item" onClick={() => rename("rundown", r.id, r.name)}>
                          <span className="check" />
                          Rename
                        </button>
                        <button type="button" className="menu-item" onClick={() => void api.duplicateRundown(r.id).then(reload)}>
                          <span className="check" />
                          Duplicate
                        </button>
                        <button
                          type="button"
                          className="menu-item"
                          onClick={() => void api.archiveRundown(r.id, !r.archivedAt).then(reload)}
                        >
                          <span className="check" />
                          {r.archivedAt ? "Unarchive" : "Archive"}
                        </button>
                        <div className="menu-sep" />
                        <div data-keep-open style={{ padding: "4px 9px" }}>
                          <DangerButton
                            label="Delete"
                            confirmLabel="Really delete?"
                            onConfirm={() => api.deleteRundown(r.id).then(reload)}
                          />
                        </div>
                      </Dropdown>
                    </span>
                    )}
                    {canManageRow(event) && (
                    <MobileActions>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() =>
                          void copyViewOnlyLink(r.id).then((url) =>
                            window.alert(`View-only link copied:\n\n${url}`),
                          )
                        }
                      >
                        <span className="check" />
                        Copy view link
                      </button>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => setImportFor({ eventId: event.id, replace: { id: r.id, name: r.name } })}
                      >
                        <span className="check" />
                        Update import…
                      </button>
                      <button type="button" className="menu-item" onClick={() => rename("rundown", r.id, r.name)}>
                        <span className="check" />
                        Rename
                      </button>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => void api.archiveRundown(r.id, !r.archivedAt).then(reload)}
                      >
                        <span className="check" />
                        {r.archivedAt ? "Unarchive" : "Archive"}
                      </button>
                      <button type="button" className="menu-item" onClick={() => void api.duplicateRundown(r.id).then(reload)}>
                        <span className="check" />
                        Duplicate
                      </button>
                      <div className="menu-sep" />
                      <div data-keep-open style={{ padding: "4px 9px" }}>
                        <DangerButton
                          label="Delete"
                          confirmLabel="Really delete?"
                          onConfirm={() => api.deleteRundown(r.id).then(reload)}
                        />
                      </div>
                    </MobileActions>
                    )}
                  </li>
                ))}
                {event.rundowns.length === 0 && (
                  <li style={{ padding: "8px 10px", color: "var(--text-3)", fontSize: "var(--fs-sm)", borderTop: "1px solid var(--border-subtle)" }}>
                    No rundowns yet.
                  </li>
                )}
              </ul>
              {importFor?.eventId === event.id ? (
                <ImportPanel
                  eventId={event.id}
                  // Updating a sheet starts from what THAT sheet is; a new one
                  // starts from the event's default. Seeding an update with the
                  // event's would quietly retype a netball sheet as whatever
                  // the day mostly is.
                  eventType={
                    importFor.replace
                      ? (event.rundowns.find((r) => r.id === importFor.replace!.id)?.sport ?? event.sport)
                      : event.sport
                  }
                  replaceRundown={importFor.replace}
                  onClose={() => setImportFor(null)}
                  onDone={(rundownId) => {
                    // Same window. A new tab for every import leaves a row of
                    // near-identical tabs and no way back to the dashboard
                    // except closing one — and on a tablet it is worse.
                    setImportFor(null);
                    reload();
                    router.push(`/show/${rundownId}`);
                  }}
                />
              ) : null}
              <CreateRundownForm
                eventId={event.id}
                templates={templates}
                onCreated={reload}
                leading={
                  !importFor || importFor.eventId !== event.id ? (
                    <button
                      type="button"
                      className="btn btn-import"
                      data-tip="Create a rundown from an XLSX, CSV, or PDF run sheet"
                      onClick={() => setImportFor({ eventId: event.id })}
                    >
                      ⤒ Import run sheet…
                    </button>
                  ) : undefined
                }
              />
            </section>
                ))}
                {group.events.length === 0 && (
                  <div style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", padding: "2px 0" }}>
                    No events yet for this company.
                  </div>
                )}
                {canCreateEventsIn(group.real ? group.id : null) && (
                  <div>
                    <CreateEventForm teamId={group.real ? group.id : undefined} onCreated={reload} />
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>

        {events?.length === 0 && (
          <div className="empty card">
            <div className="glyph">◴</div>
            <div>No events yet — create your first event to get started.</div>
          </div>
        )}
      </main>
      </WithSideNav>
      <VersionBadge />
      {locEvent && (
        <LocationDialog
          event={locEvent}
          onClose={() => setLocEvent(null)}
          onSaved={() => {
            setLocEvent(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
