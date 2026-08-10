# ROADMAP

Last updated: 2026-08-10

Tag legend: [HU] human-owned, [AI] authored from the codebase, [INFERRED]
assistant default, [GAP] unresolved question for the human.

## Status Board

| Phase | What | Status | Shipped |
|-------|------|--------|---------|
| 1 | Walking skeleton: rebrand, three views, outbox, onboarding, CI, Pages | ✅ shipped | 2026-08-05 |
| 1.5 | Feeds tab: raw per-source reader with park and assign-to-theme | ✅ shipped | 2026-08-10 |
| 2 | Hardening: full test pyramid, manifold evals harness, schema gating | ⏳ next | — |
| 3 | Resources canon layer (books, courses per area) | 💡 planned | — |
| 4 | Gamification: streaks, highlighting, bookmarks, inline notes | 💡 planned | — |
| 5 | Org / B2B: multi-tenant onboarding, auth, lag dashboard | 💡 planned | — |
| — | manifold agent (separate repo) | 🅿️ parked | — |

## Phase detail

### Phase 1: walking skeleton (✅ shipped 2026-08-05, commit d5595e2)

[AI] Rebrand complete; TypeScript + Vite spine with one data layer
(src/data/dataLayer.ts), zod contract (src/schemas.ts), three views
(src/views/), sticky command bar writing to outbox, AI-assisted onboarding
persisting sources to context (src/components/Onboarding.tsx), legacy feed
migration (src/lib/migrate.ts), migration SQL for all manifold tables
(supabase/migrations/20260804000000_superlearn.sql), CI with a smoke test
(.github/workflows/ci.yml), single-file Pages deploy. 18 adversarial-review
findings fixed before push. Decisions: see PROJECT_OS.md Decisions Log.

### Phase 1.5: Feeds tab (✅ shipped 2026-08-10, commit 5775bef)

[AI] Fourth view: per-source raw list from reading_items, grouped by day,
newest first, deep-linkable (?view=feeds). Source rail with inventory
counts, client-side search, read filter, per-source refresh. Row actions:
open, read/unread round-tripping article_read_states, park, assign-to-theme
through the outbox (manifold owns theme creation). Keyboard Enter/R/P/T.
New contract shapes ParkItemPayload and AssignToThemePayload (src/types.ts)
with a writer-side zod gate (src/schemas.ts validateOutboxPayload).
Open items: see PARKING_LOT.md (disabled-source refresh UX, read-side kind
validation).

### Phase 2: hardening (⏳ next)

[HU] Full test automation: unit tests for logic and the data layer,
component tests for the views and the bar, Playwright E2E for the core
flows. manifold evals harness: rubric (rationale groundedness, horizon
coverage, emergence versus hype, clustering coherence, no-shame tone, tags
never filter), dataset format (input reading_items + context, output edition
and themes, scored assertions), a runner, a seed set, plus schema validation
gating manifold outputs before render. Source-suggestion eval (reputable,
on-topic, fetchable). Exit: full suite green in CI, evals run on the seed
set. [GAP] No target date set.

### Phases 3 to 5 (💡 planned, scoped in the Phase 1 brief)

[HU] Resources canon layer (the resources and theme_resources tables already
exist for it), gamification (streaks, highlighting, saved sections, inline
notes), org/B2B (multi-tenant onboarding UI, auth, a "where are we lagging"
dashboard over the theme map's mastery and heat data). Sequencing beyond
"after Phase 2" is not decided.

### manifold agent (🅿️ parked, external)

[HU] Lives outside this repo (planned home: a Mission Control repo); meets
the app only through Supabase tables. [AI] As of 2026-08-10 the backend
holds an edition row (edition 1, "Agents and the Bubble"), so either
manifold has started running or an edition was written by hand. [GAP] Which
of those is true, where the repo is, and its schedule are unrecorded here.
