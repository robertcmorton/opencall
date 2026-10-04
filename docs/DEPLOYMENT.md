# Deployment

Everything runs on **Railway** in one project named `opencall` (consolidated 2026-08-04; an initial Vercel deployment of the web app was retired the same day to keep a single platform; renamed from the OpenCall rename on 2026-08-05).

| Service | What it runs | URL / notes |
|---|---|---|
| `opencall` | Web app (Next.js) | https://opencall-web-production.up.railway.app — domain targets port **3000** (`PORT=3000` set explicitly; the bare `opencall-production` subdomain was already taken on Railway) |
| `opencall-sync` | Sync server: HTTP API + show channel (ws `/`) + doc sync (ws `/doc`) | https://opencall-sync-production.up.railway.app — domain targets port **8080** (Railway-injected `PORT`) |
| `Postgres` | Managed PostgreSQL with volume | referenced by sync as `DATABASE_URL=${{Postgres.DATABASE_URL}}` |

Both app services build from the same GitHub repo (`main`, auto-deploy) with the Railpack builder at the repo root:

- web: build `pnpm --filter @opencall/web build`, start `pnpm --filter @opencall/web start`, watch `/apps/web/**`
- sync: build `pnpm --filter @opencall/sync build`, start `pnpm --filter @opencall/sync start`, watch `/apps/sync/**`

## Web service variables (build-time — changing them requires a rebuild)

```
NEXT_PUBLIC_SYNC_HTTP_URL=https://opencall-sync-production.up.railway.app
NEXT_PUBLIC_SYNC_WS_URL=wss://opencall-sync-production.up.railway.app
NEXT_PUBLIC_DOC_WS_URL=wss://opencall-sync-production.up.railway.app/doc
PORT=3000
```

Sync service variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}` (PORT is Railway-injected).

Security settings for the sync service (see docs/security.md for what each does): `ADMIN_TOKEN` (32+ random characters), `PUBLIC_WEB_URL=https://opencall-web-production.up.railway.app` (invitation links, and the only site whose browsers may call the API), `ALLOW_DEV_JOIN=0`, and optionally a restricted `DATABASE_URL` with the owner login in `MIGRATION_DATABASE_URL`. The health check for Railway is `GET /health` on the sync service. The sync server runs idempotent DDL on boot, so a fresh database initializes itself.

## Operational notes

- **Watch paths** mean changes outside `/apps/<service>/**` (e.g. `packages/*`, the root lockfile) do **not** trigger that service's rebuild — push a touch inside the service dir or redeploy manually. Railway's "Redeploy" reuses the *same commit*; it does not pick up new pushes.
- Deploys use Railway's Railpack builder, not the repo Dockerfiles. The sync server runs its TypeScript directly on Node 26 (no tsx), which is why the Node pin below matters: an older Node cannot start it. the Dockerfiles remain for self-hosting via `docker-compose.yml`.
- Railpack takes the Node version from `.node-version` (and `engines.node`, pinned to `26.x`, in the root `package.json`) and pnpm from the `packageManager` field. Change all three together with the Dockerfiles' `FROM` and `pnpm@` lines.
- pnpm 12 refuses packages published less than a day ago and runs install scripts only for packages listed under `allowBuilds` in `pnpm-workspace.yaml`. A brand-new release therefore cannot be installed the day it comes out; wait a day rather than adding an exception.
- Costs: Railway trial credit first, then roughly $5–10/mo for the three services at hobby usage.

## Security status

The deployment is **locked**: `ADMIN_TOKEN` is set on the sync service (with `ALLOW_DEV_JOIN=0`), which gates the management API, the show channel, and the `/doc` channel. Credentials form a hierarchy — admin token → per-company showcaller tokens → per-user accounts with grants (admin / company / event / view-only; view grants get read-only docs) → per-rundown join codes. A 50-check access-control matrix (`apps/web/scripts/auth-matrix.mts`) verifies the enforcement against a locked instance; run it before releases that touch auth. Users sign in with **email + password** (scrypt-hashed); logins issue revocable 30-day sessions, and password changes/resets sign out every other device. Personal `usr_…` tokens remain as a backup credential.

Self-hosting instructions for any platform (Docker Compose, PaaS, bare Node) — written to be executable by AI assistants — live in the README's **Self-hosting** section.
