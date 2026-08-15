# manifold

The Superlearn editor. manifold reads `reading_items` and `context` from
Superlearn's Supabase, shapes them into one gated edition plus a theme map,
and routes the reader's outbox. It is part of Superlearn now, not a separate
project: it runs on GitHub Actions, deploys with the app, and imports the app's
contract directly instead of vendoring it (docs/adr/0001-manifold-runtime.md).

Behavior contract and values are unchanged from the Mission Control agent:
skeptical of hype, protective of the horizon lane, grounded or silent, never
shames the reader. The gate and rubric live in `evals/RUBRIC.md`.

## How it runs

manifold executes TypeScript on Node through `tsx` (no build step). It imports
the app's real `src/schemas.ts` and `src/types.ts` through one barrel
(`src/app-contract.ts`), so a schema change is one edit in one place. Requires
Node 20+ (the repo's CI and the workflows use Node 22).

## Setup for a fresh clone

1. Install dependencies at the repo root:

       npm ci

2. Provide secrets. Copy `.env.example` at the repo root to `.env` and fill in
   `SUPABASE_SERVICE_ROLE_KEY` (Supabase dashboard: Project Settings, API,
   service_role) and `ANTHROPIC_API_KEY` (your own Anthropic key, BYOK). The
   URL defaults to the live project if unset. `.env` is gitignored.

3. Apply the database migrations to your Supabase project (Superlearn's schema
   plus manifold's state table), either by pasting them into the Supabase SQL
   editor or with `supabase db push`:

       supabase/migrations/20260804000000_superlearn.sql
       supabase/migrations/20260815000000_manifold_state.sql

4. (Only when migrating the operator's existing agent) seed manifold state from
   the pre-extraction Mission Control state, once, so no reader intent is lost:

       npm run manifold:state:import

That is the whole install: a clone, a Supabase project, and one Anthropic key
produce editions with no other repo involved.

## Run it locally

    npm run manifold:edition        # editorial pass: writes to Supabase if the gate passes
    npm run manifold:edition:dry    # same pass, gate and report only, no writes
    npm run manifold:sweep          # route queued outbox items (parks, notes, requests)
    npm run manifold:sweep:dry      # preview routing decisions, nothing persisted

Every editorial run (including dry runs and empty-corpus aborts) writes a
decision-grade report to `manifold/reports/` (gitignored). A run that fails the
deterministic gate writes the report, writes nothing to Supabase, and exits 1.
The sweep's record is its stdout log plus the state it updates; it writes no
report file and never calls the model.

## Evals

    npm run manifold:evals               # full: real pass + LLM judge per fixture (needs ANTHROPIC_API_KEY)
    npm run manifold:evals:bless         # re-bless golden floors (deliberate act)
    tsx manifold/evals/runner.ts --skip-judge --fixture hype-but-stale
    npm run manifold:evals:ci            # deterministic subset: build + gate, no model, no key

The deterministic subset (`manifold:evals:ci`, a Vitest suite in `tests/`)
exercises the same build and gate code that gates real runs, with no model call
and no API key, so CI runs it on every push (.github/workflows/ci.yml). The
full harness and `--bless` stay manual until CI can safely carry a key. Rubric
and thresholds: `evals/RUBRIC.md`. Fixtures: `evals/fixtures/`. Golden floors:
`evals/golden/golden.json`.

## Schedules (GitHub Actions)

Two workflows carry the same cadence the Mission Control scheduler did:

| Workflow | Cadence | Timezone note |
|----------|---------|---------------|
| `.github/workflows/manifold-edition.yml` | Tuesday and Friday 07:00 | Cron is UTC, so both `0 11` and `0 12` fire and a guard proceeds only at 07:00 America/Toronto (DST-safe). |
| `.github/workflows/manifold-sweep.yml` | Hourly on the hour | Timezone-agnostic. |

Deploy secrets and variables (repository Settings, Secrets and variables,
Actions):

- Secret `SUPABASE_SERVICE_ROLE_KEY` (required for writes).
- Secret `ANTHROPIC_API_KEY` (required for the edition; the sweep does not use it).
- Optional variable `SUPABASE_URL` (defaults to the live project) and
  `MANIFOLD_MODEL` (defaults to `claude-sonnet-5`).

### Disable switch

Any one of these pauses a workflow, no code change required:

1. Set the repository variable `MANIFOLD_EDITION_ENABLED` or
   `MANIFOLD_SWEEP_ENABLED` to `false`. This is the trivial, no-commit pause.
2. Comment out the `schedule` lines in the workflow file.
3. Disable the workflow in the Actions tab.

Manual runs (the "Run workflow" button, `workflow_dispatch`) always proceed and
ignore the edition's hour guard, which is the way to test a run on demand.

### Honest caveats

- GitHub Actions cron is UTC and best-effort: a run can be delayed under load,
  and high-frequency schedules can be dropped. The sweep is idempotent so a
  missed hour is caught by the next one, and the twice-weekly edition tolerates
  a late start.
- Scheduled workflows auto-disable after 60 days of repository inactivity. Any
  push resets that clock, and unlike the local CLI-auth break that prompted
  this extraction, a stalled run is visible in the Actions tab.

## Layout

    src/cli.ts          entry: edition | outbox
    src/run.ts          attempt loop: prompt, model, build, gate
    src/prompt.ts       the editorial prompt (versioned here, nowhere else)
    src/editorial.ts    deterministic build: heat, carry-forward, meta, ids
    src/gate.ts         the hard write gate (also the evals deterministic layer)
    src/contract.ts     strict writer schemas + app-contract round-trip
    src/app-contract.ts the one import of the app's src/schemas.ts + src/types.ts
    src/claude.ts       the narrow model seam (BYOK Anthropic API; CLI fallback)
    src/supabase.ts     PostgREST access, mirrors the app's client
    src/state.ts        agent memory in Supabase (manifold_state)
    src/outbox.ts       the outbox router (apply simple, record the rest)
    src/report.ts       decision-grade run reports to manifold/reports/
    src/writer.ts       gated Supabase writes (themes, links, edition)
    evals/              rubric, fixtures, runner, judge, golden, results
    tests/              the deterministic gate suite CI runs on every push
    scripts/            one-time state import from Mission Control
