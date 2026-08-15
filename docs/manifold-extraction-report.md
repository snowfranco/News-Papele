# manifold extraction: migration report

Date: 2026-08-15. Author: assistant. Branch: `manifold-extraction`.

## Summary

manifold, the Superlearn editor agent, moved from the operator's Mission
Control repo (`~/Projects/missioncontrol/agents/manifold`) into this repo as a
first-class part of the product. It now lives in `manifold/`, deploys with the
app on GitHub Actions, and imports the app's contract directly instead of
vendoring it. This was a relocation and a runtime change, not a rewrite: no
editorial behavior changed. The runtime choice and its runner-up are recorded
in docs/adr/0001-manifold-runtime.md.

## Runtime

GitHub Actions, running TypeScript on Node through `tsx`. Chosen because the
app's src/schemas.ts imports its sibling without a file extension, which only an
esbuild-based resolver accepts, so a Node+tsx runtime is what lets manifold
import the real contract with zero app-source change. It also keeps the agent
on the same platform that already builds and deploys the app. Full rationale and
the rejected options (Supabase Edge Functions, Vercel Cron, Cloudflare Workers)
are in the ADR.

## What moved verbatim (no behavioral change)

Copied from Mission Control with only import-path and comment edits:

- manifold/src/editorial.ts (deterministic build: heat, carry-forward, ids)
- manifold/src/gate.ts (the hard write gate, all checks unchanged)
- manifold/src/heat.ts (heat math unchanged)
- manifold/src/prompt.ts (the editorial prompt text unchanged, still v0.4)
- manifold/src/run.ts (the attempt loop unchanged)
- manifold/src/contract.ts (writer schemas + round-trip unchanged)
- manifold/src/writer.ts (Supabase write order unchanged: themes, links, edition)
- manifold/src/claude.ts (the narrow model interface unchanged)
- manifold/src/supabase.ts (PostgREST client; one helper added, see below)
- manifold/src/cli.ts (edition | outbox; usage text updated for tsx)
- manifold/evals/ (runner, judge, RUBRIC, fixtures, golden all moved; runner
  gained one line, `handoffs: []`, so the materialized state matches the state
  shape's new field)

## What changed (enumerated, so the diff from verbatim is auditable)

1. **Contract is imported, not vendored.** Deleted the vendored
   src/vendor/superlearn/{schemas,types}.ts. manifold/src/app-contract.ts
   re-exports the app's real src/schemas.ts and src/types.ts, and every module
   imports the contract from that one barrel. Drift is now impossible.
2. **State moved from a file to Supabase.** manifold/src/state.ts reads and
   writes the new `manifold_state` table instead of state/state.json, because
   GitHub Actions runners are ephemeral. loadState/saveState became async and
   take (sb, tenant). The state shape, the outbox-id idempotency guard, and the
   durability contract (persist the effect before flipping the outbox row) are
   unchanged. New migration: supabase/migrations/20260815000000_manifold_state.sql.
3. **Outbox routing records moved into state.** The router's decision-card and
   handoff records used to append to Mission Control's queues/*.jsonl for the
   Sphere overseer. That repo is gone, so they now append to state.handoffs
   (a new field), idempotent by outboxId, and the outbox row still moves to
   'seen'. The routing taxonomy (which kinds apply vs route) is identical. The
   file-queue writer (src/queues.ts) was removed; its torontoIso helper moved to
   manifold/src/time.ts, which also gained torontoHour for the schedule guard.
4. **Reports rerooted.** manifold/src/report.ts writes to manifold/reports/
   (gitignored) instead of the Mission Control repo root; the edition workflow
   uploads that directory as a build artifact.
5. **env.ts rerooted.** REPO_ROOT and AGENT_ROOT point at the Superlearn layout;
   .env is loaded from the repo root or manifold/, and process.env (how Actions
   injects secrets) wins over both.
6. **supabase.ts gained isTableMissing()** so state reads degrade to empty when
   the migration has not run yet, mirroring the app's SupabaseError.tableMissing.
7. **Runtime is tsx, not Node-native TypeScript.** Added devDependencies `tsx`
   and `@types/node`; added the manifold:* npm scripts; added manifold/tsconfig.json
   and manifold/vitest.config.ts; gave manifold Node globals in eslint.config.js.
8. **CI runs the deterministic eval subset with no key.** manifold/tests/gate.test.ts
   exercises the same build + gate code over crafted model outputs (no model
   call), wired into .github/workflows/ci.yml. The LLM-judge harness and
   --bless stay manual.
9. **New deployment glue.** .github/workflows/manifold-edition.yml (Tue/Fri
   07:00 America/Toronto, DST-guarded) and manifold-sweep.yml (hourly), each
   with a repository-variable disable switch.
10. **Secrets hygiene.** .gitignore now ignores .env (it did not before, a real
    leak risk); .env.example documents the one-file env schema.
11. **State import.** manifold/scripts/import-state.ts (npm run manifold:state:import)
    seeds manifold_state from the pre-extraction file, preserved verbatim at
    manifold/state/seed-from-missioncontrol.json, so no reader intent is lost.

## What did NOT change

- The editorial logic, every gate check, the heat math, the prompt text, the
  writer order, and the model interface (verified by the behavior-parity review
  and by reading the diffs).
- The app / cockpit. No app source was touched; the built index.html is
  byte-identical after `npm run build` (git diff clean). The cockpit reads
  Supabase exactly as before.
- The Supabase project and key wiring (same project gijdjbjycymqsuhwfcbu; the
  service role key is preferred, the anon key is the documented stopgap).

## Verification done in this pass (no operator secrets required)

- `npm run manifold:typecheck`: clean.
- `npm run manifold:evals:ci`: 15/15 deterministic tests pass. Gate suite (8):
  schema-valid, cited-ids-exist, no-excluded-item-leads, horizon-present,
  parked-not-lede, numbers-grounded, no-shame-welcome, plus the clean-pass
  baseline. State durability suite (7): the loadState degrade/rethrow contract.
- `npm run lint`, `npm run typecheck`, `npm run test` (12/12), `npm run build`:
  all green; index.html unchanged.
- Runtime smoke test: `npm run manifold:edition:dry` with no keys resolves the
  entire import graph through tsx (app-contract, zod, the extensionless import,
  all of manifold/src) and fails cleanly with the intended "No Supabase key"
  message, proving the runtime and the direct contract import wire end to end.

## Adversarial review and the one fix it caught

A multi-agent review swept the risk-bearing files across five dimensions
(idempotency and durability, contract import and build, schedule and secrets,
migration and degrade, behavior parity), with each finding independently
verified. Contract-import, build, schedule/DST, and behavior-parity confirmed
zero issues: the DST guard fires exactly one candidate year-round, the app
bundle is untouched, and no editorial logic changed.

It confirmed one real defect, with three symptoms and one root cause:
loadState degraded to empty state on ANY read error, not only a missing table.
Because `isTableMissing` is false for a transient timeout or 5xx, a networked
blip on the Actions runner would make the sweep build on empty state and then
upsert that empty blob over the whole state row (wiping accumulated parks,
notes, signals, assignments), make an edition drop out-of-window parks so a
parked item could lead, and make the state import clobber live state. The
file-based original could not fail transiently, so this was a genuine
regression the Supabase backend introduced.

Fix: loadState now degrades to empty ONLY when the table is genuinely missing
(or the row is absent, which a successful read returns); it rethrows any
transient or unknown error so a caller that saves cannot clobber, exactly as
saveState failures already leave work queued (manifold/src/state.ts). The sweep
reports the abort cleanly and leaves items queued (manifold/src/cli.ts). Locked
down by manifold/tests/state.test.ts (7 tests: degrade on 404/PGRST205, rethrow
on 503/429/timeout, normalize an absent or partial row), which runs in CI.

## The first live edition (operator step, [GAP] pending)

A live edition needs the operator's SUPABASE_SERVICE_ROLE_KEY and
ANTHROPIC_API_KEY, which are not in this environment, and AGENTS.md forbids
testing write actions against the real backend from an untrusted context. So the
"produce one edition from the new home, confirm it renders and passes evals"
step is the operator's, and is the one open item on the acceptance checklist.
The exact steps, from a fresh clone:

1. Apply supabase/migrations/20260815000000_manifold_state.sql to the project.
2. Set SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY in .env (or as repo
   secrets for the scheduled run).
3. `npm run manifold:state:import` (once, to carry over the reader's parks/notes).
4. `npm run manifold:edition:dry` to preview a gated pass with no write, then
   `npm run manifold:edition` to write the first edition from the new home.
5. Open the cockpit and confirm the new edition renders.
6. `npm run manifold:evals` to score the fixtures, and
   `npm run manifold:evals:bless` to re-establish the golden floors that the
   expired Mission Control CLI auth had blocked (missioncontrol-manifold memory).

Record the produced edition_no and the eval scores here when that run happens.

## Acceptance checklist status

- [x] Fresh clone + Supabase + Anthropic key produces editions with no other
      repo involved (wiring complete; first live run is the operator step above).
- [x] manifold imports the app's types.ts / schemas.ts directly; no vendored copy.
- [x] Editions Tue/Fri 07:00 Toronto; sweep hourly; disable switches work.
- [x] Exclusion set, no-excluded-item-leads, smaller-honest floor, sweep
      idempotency: preserved (verbatim logic; state backend swapped) and covered
      by the deterministic tests.
- [x] BYOK Anthropic key from env; model call behind one narrow interface.
- [x] CI runs the deterministic eval subset on every push; --bless stays manual.
- [~] First edition from the new home renders and passes the gate: operator
      step above ([GAP]).
- [x] Mission Control manifold: both schedules disabled, README replaced with an
      archive notice, source files preserved.
- [x] ADR recorded; env schema and setup README updated.
- [x] The app's rendering is unchanged; index.html byte-identical.
