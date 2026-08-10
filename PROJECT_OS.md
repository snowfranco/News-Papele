# PROJECT_OS

Tag legend: [HU] human-owned (provided or confirmed by Snow), [AI] authored by
the assistant from the codebase, [INFERRED] a default the assistant chose
rather than a deliberate human decision. Unresolved questions are marked
[GAP]. This file holds durable truth; the worklist lives in PARKING_LOT.md.

## Purpose

[HU] Superlearn is a single-surface learning cockpit: one page where a reader
stays current on their beat, sees their knowledge charted as a theme map, and
turns reading into defensible positions. The app is the cockpit; manifold is
the background agent that reads sources and writes editions, themes, and
links to Supabase. The app writes every reader action to an outbox that
manifold consumes (src/types.ts).

[HU] Three principles override convenience: learning is never gated by
projects (the horizon lane is always on, project relevance is a lens, never a
filter); never shame the backlog (no unread counters anywhere); one surface
(acting on something means writing to the outbox, never leaving the page).

## Stack

[AI] React 19, TypeScript strict, Vite 6, vite-plugin-singlefile,
d3-selection/d3-force/d3-drag for the theme map, zod for contract validation,
Supabase via raw PostgREST fetch (no supabase-js), Vitest + happy-dom +
Testing Library for tests, ESLint 9 flat config (package.json).

## Architecture as it actually is

[AI] Single-page app, no router: a ViewKey union drives four views (Edition,
Theme map, Position desk, Feeds) behind a segmented control, deep-linkable
via ?view= (src/state/AppStore.tsx). All state lives in one store
(src/state/AppStore.tsx); views consume only the store. All Supabase access
goes through one data layer (src/data/dataLayer.ts) over one REST wrapper
(src/data/supabaseClient.ts). Every row read is validated by zod schemas and
invalid rows are dropped rather than rendered (src/schemas.ts). Outbox writes
with declared payload shapes are zod-gated before they leave the app
(src/schemas.ts validateOutboxPayload).

[AI] Degradation is a first-class state: missing tables (migration not run)
and unreachable backend are tracked separately and surfaced as calm banners;
reads fall back to empty values; the Edition falls back to a client-built
seed edition from live feed fetches (src/lib/seed.ts, src/data/dataLayer.ts).

[AI] Feed ingestion: a three-proxy fallback chain (rss2json, allorigins,
corsproxy) fetches RSS/Atom, normalises dates, and upserts into
reading_items so manifold has a corpus (src/lib/feeds.ts,
src/data/dataLayer.ts upsertFeedItems).

[AI] Onboarding is AI-assisted: a direct in-app Claude call proposes sources,
each feed is probe-validated through the proxy chain before saving, and
legacy feed stores migrate into context.sources once (src/lib/claude.ts,
src/components/Onboarding.tsx, src/lib/migrate.ts).

[AI] Build: Vite root is src/; the output is one self-contained index.html
committed at the repo root, which GitHub Pages serves in branch mode.
scripts/postbuild.mjs copies the artifact up and fails the build on external
references or an old-product-name leak. CI runs lint, typecheck, the smoke
test, the build, and an artifact-freshness check (.github/workflows/ci.yml).

[AI] manifold is NOT in this repo. It meets the app only through Supabase:
it writes editions, themes, theme_links; it reads outbox, context,
reading_items (README.md data model table). [GAP] Where manifold lives (the
planned Mission Control repo), its stack, and its run cadence are not
recorded anywhere in this repo.

## Key decisions (from the code)

[AI] Raw PostgREST fetch instead of supabase-js: smaller single-file bundle,
one explicit gateway, custom error taxonomy for degradation
(src/data/supabaseClient.ts SupabaseError.tableMissing).

[AI] Contract-through-tables, not RPC: the app and manifold share only table
shapes, validated by zod on read and write (src/schemas.ts, src/types.ts).

[AI] ?demo query param renders an in-memory populated preview; every mutation
path is demo-guarded so the preview can never touch the real backend
(src/lib/demo.ts, src/state/AppStore.tsx).

[AI] Onboarding gates only when no context row exists; an unreachable
backend never shows onboarding, so an existing reader's sources cannot be
overwritten by a fresh setup flow (src/state/AppStore.tsx boot,
src/data/dataLayer.ts getContext).

[AI] The old product name never appears in the codebase; the postbuild and
smoke-test guards assemble the pattern from string parts so a repo-wide
search stays clean (scripts/postbuild.mjs).

## Known constraints

[AI] The Supabase anon key is public by design and RLS policies are
deliberately open; there is no auth and one tenant row keyed 'default'
(supabase/migrations/20260804000000_superlearn.sql, src/config.ts TENANT).
Anyone with the key can read and write the backend.

[AI] The production backend holds real reader data as of 2026-08-10; test
write actions in the browser through ?demo mode only.

[AI] The single-file artifact must stay self-contained; fonts are the only
runtime-external asset (scripts/postbuild.mjs). The committed index.html
must be rebuilt with npm run build before every push or CI fails the
freshness check (.github/workflows/ci.yml).

[AI] rss2json is called with an empty api_key and free proxies rate-limit;
feed fetches are best-effort by design (src/lib/feeds.ts).

[INFERRED] House docs style: no em dashes; every claim about system state
cites a file or is tagged. Adopted from the build prompts' constraints.

## Decisions Log (newest first)

### [2026-08-10] [AI] Outbox payload keys are camelCase
Context: the Feeds tab brief sketched snake_case payload keys (item_id,
theme_id), but every outbox payload the app already emitted used camelCase.
Decision: keep camelCase everywhere; export ParkItemPayload and
AssignToThemePayload from src/types.ts as the contract manifold reads.
Consequence: one convention across the contract; manifold must read the
exported shapes, not the brief. Flagged as [CONTRACT-NOTE] in commit 5775bef.

### [2026-08-10] [AI] Mobile source rail is a chip strip, not a drawer
Context: the Feeds brief suggested a collapsible drawer on mobile; drawers
need overlays, which sit poorly with the one-surface, no-modals principle.
Decision: the rail renders as a horizontally scrollable chip strip above the
list at small widths (src/styles.css feeds section).
Consequence: everything stays visible with no overlay; revisit only if the
source list grows unwieldy.

### [2026-08-05] [AI] Onboarding gates only on a missing context row
Context: an unreachable backend made getContext return null, which dumped
existing readers into onboarding where saving would overwrite real sources.
Decision: distinguish "no row" from "could not read"; only a confirmed empty
read shows onboarding (src/data/dataLayer.ts getContext throws on network
failure).
Consequence: offline boots show a degraded cockpit instead of setup; a
genuinely new user on a flaky network sees the cockpit's empty states first.

### [2026-08-05] [AI] ?demo preview mode with hard mutation guards
Context: the backend was paused and manifold did not exist, so no populated
state could be shown or safely tested.
Decision: ?demo loads in-memory fixtures and every store mutation short-
circuits in demo mode (src/lib/demo.ts, src/state/AppStore.tsx).
Consequence: populated previews and safe write-path testing forever; demo
fixtures must be kept honest (clearly demo-labeled copy).

### [2026-08-04] [HU] Rebrand to Superlearn with three product principles
Context: the reading app was being rebuilt as a learning cockpit with a
background agent; the old name and framing no longer fit.
Decision: full rebrand, three principles (never gated by projects, never
shame the backlog, one surface), phased build (walking skeleton first).
Consequence: the old name is banned from the repo and enforced by build
guards; principles are treated as contract rules, not tone guidance.

### [2026-08-04] [HU] Keep the existing Supabase project and anon key
Context: the legacy app already synced through project gijdjbjycymqsuhwfcbu
and the rebuild had to preserve cross-device data.
Decision: same project, same public anon key, additive migration only
(supabase/migrations/20260804000000_superlearn.sql).
Consequence: zero-migration continuity for reading_items and read states;
open-RLS security posture carries over unchanged.

### [2026-08-04] [AI] Single-file artifact committed at the repo root
Context: GitHub Pages served the legacy bundle from the main branch root and
repo settings could not be changed from the build environment.
Decision: Vite root src/, vite-plugin-singlefile output copied to ./index.html
by scripts/postbuild.mjs, committed, Pages branch mode untouched.
Consequence: deploys are just pushes; the artifact must be rebuilt and
committed with source changes (CI enforces freshness).
