# Security

What OpenCall protects, how, and what to do when something goes wrong. Modelled
on the measures Kitshare built in September 2026, adapted to an app with no
public sign-up, no payments and no photo uploads. Two-factor sign-in is
deliberately not used.

Run the regression suite with:

```bash
pnpm test:security
```

It starts a locked sync server on a throwaway database and runs every check in
`apps/web/scripts/auth-matrix.mts`. **Every security fix adds a check there that
fails without it.** CI runs it on every push.

## What is being protected

- **The live show.** Only a Showcaller or System Administrator may drive the
  transport. A view-only link or account must never be able to change a sheet or
  move the cue.
- **Accounts and access.** Passwords, sessions, personal and company tokens, and
  who has access to which company, event and sheet.
- **Run sheets.** Client material: they must not leak to people without access.

The likely attackers are opportunistic: guessing join codes or passwords,
replaying a leaked link, a script on another website, a copy of the database
that ends up somewhere it should not.

## Measures

| Area | Measure | Where |
|---|---|---|
| Sign-in | 5 failures per email+address and 20 per address in 15 minutes, then 429; past 10 for one email, waits of 2, 4, 8… s (max 60) instead of a lockout; counted before the check, given back on success | `apps/sync/src/api.ts` (login), `throttle.ts` |
| Sign-in | Unknown email costs the same time as a wrong password (dummy hash); one error for both | `auth.ts` `verifyPassword` |
| Guessing | 30 wrong join codes or invitation links per address in 15 minutes, on the API, the document socket and the show socket | `auth.ts` `resolveJoinCodeGuarded`, `server.ts` |
| Client address | Only the right-most `X-Forwarded-For` entry (Railway's edge); IPv6 grouped by /64 | `clientIp.ts` |
| Credentials | Sessions, personal and company tokens are 32 random bytes and stored only as SHA-256 (`h:` prefix); shown once at issue; existing ones hashed in place at boot | `auth.ts` |
| Sessions | 30-day lifetime, ended after 14 idle days; all ended on password change or admin reset (except the one changing it) | `auth.ts`, `api.ts` |
| Passwords | At least 12 characters, at most 200, 5 different characters, not the email name; existing passwords work until changed; 10 wrong current-password tries a day | `packages/core/src/password.ts` |
| Invitations | Crypto-random, 7 days, claimed in one conditional UPDATE so a link makes exactly one account | `api.ts` |
| Requests | Bodies capped (1MB; imports 24MB) with 413/400; WebSocket messages capped (256KB show, 16MB document); internal error text logged, never returned | `api.ts`, `server.ts` |
| Browser | Per-request nonce Content Security Policy; no framing; nosniff; strict referrer; camera/mic/location/payments off; HSTS in production | `apps/web/proxy.ts`, `lib/csp.ts`, `next.config.mjs` |
| Cross-site | API and WebSocket upgrades accept browser requests only from `PUBLIC_WEB_URL` / `WEB_ORIGINS` (open when neither is set) | `origins.ts` |
| Redirects | The sign-in return address must be a path on this site: no `//`, backslashes or control characters | `apps/web/lib/session.ts` |
| Database | Optional restricted login for the app (rows only), schema changes as the owner through `MIGRATION_DATABASE_URL`; queries over 30 s are stopped | `packages/db/scripts/setup-app-role.ts`, `server.ts`, `client.ts` |
| Audit | Sign-ins and failures, password changes, invitations, access changes, tokens, deletions, archiving, codes, closing a sheet to viewers. Read it at Dashboard → Account activity | `audit.ts`, `api.ts` |
| Change log | Every change to a sheet is recorded: a person's editing session (first change to a two-minute pause or Done editing), each AI assistant change, each import, restore and undo — who, when, and every field before and after — with the version from just before it. "Undo just this change" puts back only what that change altered and never overwrites anything changed since. Readable by whoever may edit the sheet; crew and view links cannot | `sheetChanges.ts`, `packages/db/src/compare.ts` |
| Retention | Throttles 2 days idle; ended sessions 30 days; failed sign-ins 90 days; other audit 2 years; error log 1 year; sheet change logs 2 years; versions saved automatically before an AI change or an editing session 90 days (all others kept) | `retention.ts` |
| Health | `GET /health` on the sync server: database answers within 2 s → 200, else 503 | `server.ts` |
| Timeouts | Request headers 20 s, request 120 s, query 30 s, mail 10 s | `server.ts`, `client.ts`, `mail.ts` |
| Supply chain | pnpm 12 refuses packages under a day old; install scripts only for approved packages; `pnpm audit --prod` in CI; Dependabot weekly | `pnpm-workspace.yaml`, `.github/` |
| CI | Actions pinned to commit SHAs, read-only token, no persisted credentials, gitleaks on every push | `.github/workflows/ci.yml` |
| Monitoring | Hourly uptime check opens and closes a GitHub issue; a monthly security-review checklist issue | `.github/workflows/uptime.yml`, `security-reminder.yml` |
| AI assistants | Connected by OAuth 2.1 with PKCE (S256) to one ACCOUNT, never a company or server token; the assistant reaches exactly that account's sheets — read where it can see, change where it can edit. Codes 5 min, access tokens 1 h, refresh tokens 30 days and turned over on every use, a connection ends after 90 days; all stored hashed. A code or refresh token used twice ends the whole connection. Ended by a password change or admin reset, by Disconnect in My account, or by deleting the account | `apps/sync/src/oauth.ts` |
| AI assistants | No tool runs the show. While a show is live only text and strikes change. A sheet somebody else is editing is not changed. Before every change an assistant makes, the sheet as it was is saved as a version (kept 90 days); Version history shows each one marked AI, who it acted for, and exactly what restoring it would undo. Changes are recorded in the audit log as `mcp.*`. Every change answers the assistant with what it altered (before and after, knock-on times included) and the link to its change page; `preview_change` rehearses any change on a copy with every rule applied and changes nothing. 60 requests a minute and 2000 a day per account, 30 changes a minute; 64KB requests, 10 messages per batch | `apps/sync/src/mcp.ts` |
| Startup | Warns in the error log when a production server has no or a short admin token, no web origin, or the dev join code enabled | `server.ts` |

## Settings (sync service)

| Variable | What it does |
|---|---|
| `ADMIN_TOKEN` | Locks the server. At least 32 random characters. |
| `PUBLIC_WEB_URL` | The web app's address. Invitation links point here, browsers on any other site are refused, and AI assistants are sent here to be approved — they cannot connect without it. |
| `PUBLIC_SYNC_URL` | Optional. The sync server's own public address, as assistants should see it. Worked out from the request when unset. |
| `WEB_ORIGINS` | Extra allowed web origins, comma-separated (e.g. a staging site). |
| `ALLOW_DEV_JOIN` | Must be `0` in production. |
| `DATABASE_URL` | The app's database login. Ideally the restricted `opencall_app` role. |
| `MIGRATION_DATABASE_URL` | The owner login, used only to apply schema changes at boot. Set it together with a restricted `DATABASE_URL`. |

## Rotating secrets

| Secret | How | Side effects |
|---|---|---|
| `ADMIN_TOKEN` | New value in Railway, redeploy sync | Anybody signed in with the old admin token must sign in again. |
| A company token | Dashboard → company ⋯ → New token | The old token stops at once; give the new one to the company. |
| A personal token | Users & access → New token | The old token stops at once. |
| A password | The person changes it, or an admin resets it | Every other session of that account ends, and every assistant connected to it is disconnected. |
| An assistant's access | My account → AI assistants → Disconnect | Stops at once; the assistant has to be approved again. |
| `opencall_app` password | Re-run `setup-app-role.ts` with a new `APP_DB_PASSWORD`, update `DATABASE_URL`, redeploy | Brief reconnect of the sync server. |
| SMTP password | New value in Railway | Invitations fail until set. |

## If something goes wrong

1. **Stop it.** Rotate whatever leaked (table above). If an account is being
   used by somebody else, reset its password (that signs out every device) or
   delete it. A sheet can be closed to viewers from its menu (End event).
2. **Scope it.** Read Dashboard → Account activity and the Error log for the
   period. Note the addresses involved.
3. **Rotate the rest** that the same person could have seen.
4. **Tell people.** Anyone whose data was exposed. If personal information of
   Australians was involved and serious harm is likely, the Notifiable Data
   Breaches scheme applies (OAIC).
5. **Record it** here, with the date, what happened and the check added to the
   security suite so it cannot happen again unnoticed.

## AI assistants (MCP)

An assistant such as Claude connects at `<sync address>/mcp`. Discovery is at
`/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`;
it registers itself at `/oauth/register`, sends the person to the web app's
`/oauth/authorize` page to approve it, and exchanges the answer at `/oauth/token`.

| Who | What an assistant can do |
|---|---|
| System Administrator | Read and change every sheet |
| Showcaller (company or event access) | Read and change that company's or event's sheets |
| Producer (edit access) | Read and change that event's sheets |
| Crew (view access) | Read only; "Change your run sheets" is not offered |
| Anyone with only a view link, a company token or the server token | Cannot connect one |

The security suite walks the whole flow: crew are read-only and refused
`insufficient_scope`, another company's sheet is refused, the edit lock and a
live show are respected, a replayed refresh token ends the connection, and
Disconnect stops it at once.

## Open items

- **Backups.** Not kept off-site: the production deployment is a test server
  (decided 5 Oct 2026). Railway's own volume backups are all there is. Revisit
  before real shows depend on it.
- **Deploy only after CI passes.** Turn on Railway's "Wait for CI" for both
  services once the CI workflow has run green once.
- **Restricted database login.** Run `setup-app-role.ts` once and switch the
  sync service's `DATABASE_URL`, with `MIGRATION_DATABASE_URL` set to the owner.
- **Sessions in the browser.** Sign-in tokens are kept in the browser's local
  storage because the web app and the sync server are separate hosts; the
  Content Security Policy is what stops a script stealing them. Moving to an
  httpOnly cookie would need the two behind one domain.
