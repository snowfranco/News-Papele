# ADR 0001: manifold runs on GitHub Actions, on Node via tsx

Status: accepted (2026-08-15). Supersedes the Mission Control scheduler as
manifold's home (schedule/scheduler.yaml in the archived repo).

## Context

manifold, the Superlearn editor agent, was extracted from the operator's
Mission Control repo into this one (the migration report, manifold/README.md).
It must run the editorial pass on a schedule (Tuesday and Friday 07:00
America/Toronto) and the outbox sweep hourly, read and write Superlearn's
Supabase with the service role key from the environment, and call the
Anthropic API with a bring-your-own key, all from a fresh clone with no other
repo involved. The single hard technical constraint that shaped the choice: the
app's contract file imports its sibling with no extension (`import ... from
'./types'`, src/schemas.ts line 17), and the whole point of the extraction is
that manifold imports that real file rather than a vendored copy (AGENTS.md
architecture rules). Node's native TypeScript loader and Deno both reject an
extensionless relative import; only an esbuild-based resolver accepts it.

## Decision

manifold runs on **GitHub Actions**, executing its TypeScript on Node through
**tsx** (package.json devDependencies; the manifold:* scripts). tsx resolves
the app's extensionless import and the hoisted `zod` with no change to the app
source, so manifold imports src/schemas.ts and src/types.ts directly through
one barrel (manifold/src/app-contract.ts) and the contract can never drift.
GitHub Actions is the same platform that already builds and deploys the app
(the Pages artifact and the CI checks, .github/workflows/ci.yml), so the agent,
its evals, and the app all live and run in one place with no new vendor and no
new account: a fork plus two repository secrets plus the migration produces
editions on the scheduled cadence. It is free at personal scale, and because it
runs plain Node it is the least adaptation of the Mission Control code, which
keeps this a relocation rather than a rewrite.

Two scheduled workflows carry the cadence. manifold-edition.yml fires at both
UTC hours that can be 07:00 in Toronto (11:00 and 12:00 UTC) and a shell guard
lets only the live daylight-saving candidate proceed, because Actions cron is
UTC only; manifold-sweep.yml runs hourly and is timezone-agnostic. Each has a
no-commit pause (a repository variable) plus the option to comment the schedule
or disable the workflow in the Actions tab. Three filesystem dependencies that
Mission Control satisfied with local files moved onto the database manifold
already talks to or onto Actions artifacts, because Actions runners are
ephemeral: agent state moved to a Supabase table (manifold_state,
manifold/src/state.ts), the outbox router's queue records moved into that same
state (state.handoffs, manifold/src/outbox.ts), and run reports write locally
and upload as a build artifact (manifold/src/report.ts). None of this changes
the editorial logic, the gate, or the app's rendering.

## Runner-up and rejected options

Supabase Edge Functions (Deno) was the close runner-up: it would live with the
database and schedule natively through pg_cron. It was rejected because Deno
cannot resolve the app's extensionless `./types` import without either patching
the app source (which reintroduces exactly the contract drift the extraction
removes) or maintaining a fragile import map, and because it adds a third
operational surface on top of GitHub (app and CI) and Supabase (data). Vercel
Cron was rejected because the free Hobby tier caps cron at once per day, so the
hourly sweep would force a paid plan. Cloudflare Workers was rejected because
Workers have no filesystem and no child process, forcing a larger rewrite of
the storage and model layers, and it adds a vendor. [INFERRED] the weighting of
"same platform as the app" over "same platform as the data" reflects that this
project's home is GitHub (the app deploys from it), not Supabase.

## Auth: BYOK now, extensible later

The Anthropic key comes from the environment and that is the whole story for
v1. The model call is wrapped in one narrow interface (ClaudeCaller in
manifold/src/claude.ts) so a future proxy, hosted key, or per-tenant key adds
one transport with no change to any caller. Nothing about a proxy or
multi-tenant plumbing is built now; the seam just exists.

## Consequences

- A fresh clone plus a Supabase project plus an Anthropic key produces editions
  with no other repo involved (the acceptance criterion).
- Honest costs, documented in manifold/README.md: Actions cron is UTC and
  best-effort (it can be delayed under load; the hourly sweep is idempotent and
  the twice-weekly edition tolerates a late start), and scheduled workflows
  auto-disable after 60 days of repository inactivity. The mitigation is that
  active development resets that clock and, unlike the Mission Control CLI-auth
  break that triggered this extraction, a stalled run is visible in the Actions
  tab.
- Any contract change is now one pull request touching src/ and manifold/
  together, which is the point.
