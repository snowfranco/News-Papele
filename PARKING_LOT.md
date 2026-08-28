# PARKING_LOT

Last updated: 2026-08-27

Deferred features, known rough edges, and open questions. Durable decisions
live in PROJECT_OS.md; phase status lives in ROADMAP.md.

## Open questions for Snow

- [GAP] manifold: does the Mission Control repo exist yet, what stack, what
  cadence? An edition row exists in production (edition 1), so something
  wrote it. Record the answer in PROJECT_OS.md when known.
- [GAP] Phase 2 timing and whether the evals harness lives in this repo or
  next to manifold.
- [GAP] Demo fixtures use invented project names (atlas, field notes) that
  read plausibly real (src/lib/demo.ts); decided against renaming on
  2026-08-05, revisit if demo screenshots circulate.

## Deferred features (from the briefs, seams left clean)

- Feeds tab v2: full-text search across bodies, bulk actions
  (multi-select), per-source settings beyond the feed manager (Feeds brief,
  out of scope for v1).
- Resources canon layer: manifold recommends durable resources per area;
  tables already exist (supabase/migrations/20260804000000_superlearn.sql
  resources, theme_resources).
- Gamification: read streaks, highlighting, bookmark a section, inline
  notes (Phase 1 brief, Phase 3+).
- Org / B2B: multi-tenant onboarding, auth, lag dashboard (Phase 1 brief).

## Known rough edges (small, none blocking)

- outboxRowSchema trusts the kind string read back from the outbox without
  validating it against the OutboxKind union; read-side only
  (src/schemas.ts).
- lastRefresh is in-memory only, so a fresh load shows boot-time stamps and
  a feed disabled since boot reads "no items yet" even if never attempted
  (src/state/AppStore.tsx).
- Refreshing a disabled source toasts feedback now, but the rail could show
  the off state more loudly (src/views/FeedsView.tsx).
- rss2json runs with an empty api_key; the proxy chain is best-effort and
  some real feeds intermittently validate as unreachable during onboarding
  (src/lib/feeds.ts).
- Ingestion is demand-driven, not scheduled: reading_items refresh only on
  app boot and manual refresh (src/state/AppStore.tsx refreshFeeds,
  src/data/dataLayer.ts upsertFeedItems), so manifold's corpus is only as
  fresh as the last browser session. Editions do not starve (the window
  still held 120 items on 2026-08-27), but a long idle stretch reads a stale
  corpus. Follow-up: port the fetch+upsert to a Node step and schedule it
  server-side (fetchFeed in src/lib/feeds.ts is proxy-based and portable).
- Legacy stores linger by design until confidently retired: the user_feeds
  table and la-* localStorage keys feed the one-time migration
  (src/lib/migrate.ts).
- Google Fonts are the single runtime-external dependency of the artifact;
  offline-first would need font subsetting (src/styles.css).
