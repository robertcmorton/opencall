# OpenCall — Project Rules

Read this before doing anything in this repo. These rules are permanent.

## Confidentiality of reference material — HARD RULE

This project is modeled on a commercial reference platform. **Nothing that identifies that platform may ever reach GitHub** — not in files, commit messages, branch names, code comments, issue/PR text, or the changelog. This includes the vendor's name, product names, demo URLs, and the reference screenshots.

All vendor-identifying material lives ONLY in local-only files, which are listed in `.gitignore` and must stay there:

- `Images/` — reference screenshots (never commit)
- `DEMO_NOTES.md` — detailed product research from the vendor's interactive demos (never commit)
- `CLAUDE.local.md` — vendor-specific pointers and URLs (never commit)

Before every commit and push, verify nothing staged references the vendor (`git diff --cached | grep -i` against the terms listed in `CLAUDE.local.md`). When in doubt, leave it out of the repo.

## Source of truth

- **[BUILD_PROMPT.md](BUILD_PROMPT.md)** — the product spec and kickoff prompt. Update it when the product direction changes.
- **`DEMO_NOTES.md`** (local-only) — ongoing feature research and UX details for the product we're building toward. Add to it whenever new product behavior is learned; it is the design reference during implementation.

## Documentation discipline — both files, every commit

Two documents are written as the work happens, not afterwards. **The commit is the trigger for both.** A change that is worth committing is worth both entries; if there is nothing to say in one of them, say why in the other.

**[CHANGELOG.md](CHANGELOG.md)** — what changed, for whoever uses the app. Updated in the **same commit** as any meaningful change (spec updates, new features, structural changes, tooling). Keep a Changelog format, newest first, under an `[Unreleased]` heading until a version is cut. Written generically — no vendor references, and no internal function names.

**`DEVLOG.md`** (local-only, gitignored) — how and why, for whoever picks this up next. Append an entry per unit of work, under a `## <date> — <what was asked>` heading, recording:

- what was built, and the commit hash it landed in;
- **what was measured**, with the numbers — thresholds chosen from data, before/after counts, corpus sweeps;
- decisions made and the alternatives rejected, with the reason;
- **hypotheses that turned out wrong**, and what disproved them;
- anything deliberately left undone, and what it is waiting on.

The wrong turns matter as much as the fixes: the reason a rule fires on 15 rows and not 39 is not visible in the diff, and a later session that cannot see it will widen the rule and break the sheets. Candid notes and vendor names are fine here; never commit it.

**Before every commit, check both.** The changelog is verifiable from the staged diff; the devlog is not, so it is the one that silently falls behind — it has, by twelve commits, on 15 August 2026. If a run of commits has gone in without devlog entries, catch it up before starting new work rather than after.

## Repo hygiene

- Remote: `https://github.com/robertcmorton/opencall.git` (HTTPS via `gh`; this machine has no SSH keys).
- Commit and push after each completed unit of work so GitHub stays the backup.
- The local working folder contains files that must never be committed (see above); never use `git add -A`/`git add .` without checking what it would stage.
