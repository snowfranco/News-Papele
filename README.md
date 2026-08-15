# Superlearn

Superlearn is a single-surface learning cockpit. The app is the cockpit: one page where you read today's edition, walk the theme map, and take positions. Manifold is the background agent that reads your sources and writes editions, themes, and links to Supabase; the app writes every action you take to an outbox table that manifold consumes. The full contract between the two lives in src/types.ts.

## Principles

1. **Learning is never gated by projects.** Project relevance is an enrichment tag and a lens, never a filter. The horizon lane (current and emerging learning tied to no project) is always on and first-class (src/types.ts, the `Lane` contract).
2. **Never shame the backlog.** No unread counters, no "N items waiting", no guilt copy. This is enforced as a contract rule, not just tone: edition welcome copy that counts a backlog fails schema validation and is dropped before render (src/schemas.ts, `noBacklogShaming`).
3. **One surface.** Acting on something means writing to the outbox, with a toast. The app never links you out to a repo file, report, or external tool to get something done (src/state/AppStore.tsx, `sendToManifold`).

## The surface

- **Edition** (src/views/EditionView.tsx): today's front page, with a lede, emerging themes, and a start-here reading list.
- **Theme map** (src/views/ThemeMapView.tsx): a force-directed map of themes, sized by heat, with relate and project links as lenses.
- **Position desk** (src/views/PositionDeskView.tsx): where reading becomes a stance, from draft to published column.
- **Feeds** (src/views/FeedsView.tsx): the raw per-source reader, chronological and unedited, the workshop bench next to the Edition's front page.
- **Command bar** (src/components/CommandBar.tsx): keyboard-first actions available from every view.

## The Feeds tab

A per-source raw list built from reading_items, grouped by day, newest first: no lede, no framing, just what each source delivered. It is deep-linkable via ?view=feeds (src/state/AppStore.tsx), and reads round-trip through article_read_states, so an item marked read here shows as read on the Edition too (src/data/dataLayer.ts).

### Outbox kinds it emits

Two kinds, whose payload shapes are the contract manifold consumes (src/types.ts, src/schemas.ts):

- **park** with `{ itemId, source, title, url }` (`ParkItemPayload`).
- **assign-to-theme** with `{ itemId, themeId }` or `{ itemId, newThemeLabel }` (`AssignToThemePayload`). The app never creates themes directly: manifold owns theme creation and reconciles off the outbox.

Every outbox write with a declared payload shape is zod-gated before it leaves the app (src/schemas.ts, `validateOutboxPayload`).

## Architecture

```
src/
  main.tsx                entry point
  App.tsx                 shell: masthead, nav, views, command bar
  types.ts                the domain contract, including the app/manifold split
  config.ts               Supabase project, tenant, model, tuning constants
  schemas.ts              zod validation of everything manifold writes, before render
  styles.css              the whole visual system (sp-* classes, design tokens)
  state/AppStore.tsx      owns all state and the outbox; views consume only this
  data/dataLayer.ts       the single data access layer; nothing else touches Supabase
  data/supabaseClient.ts  thin REST fetch wrapper
  views/                  EditionView, ThemeMapView, Constellation (star chart), PositionDeskView
  components/             Masthead, SegmentedNav, CommandBar, OutboxPanel, Toast,
                          Onboarding, SourceManager
  lib/                    feeds, formatting, seed edition, legacy migration, claude, demo (?demo fixture preview)
scripts/postbuild.mjs     copies the single-file build to ./index.html and gates it
supabase/migrations/      the schema, idempotent, apply once
```

The build is a single self-contained HTML file via vite-plugin-singlefile (vite.config.ts), committed at index.html so GitHub Pages can serve it in branch mode.

## Data model

| Table | Writer | Reader |
| --- | --- | --- |
| context | app (sources, projects, org context; one row per tenant) | app, manifold |
| editions | manifold | app |
| themes | manifold | app |
| theme_links | manifold | app |
| positions | app | app |
| outbox | app | manifold (consumes: queued, seen, done) |
| reading_items | app (feed refresh) | app, manifold |
| article_read_states | app | app |
| manifold_state | manifold (agent memory: parks, notes, signals, assignments) | manifold |
| resources, theme_resources | reserved for the resources canon layer | app |

Durable resources (books, courses) get their own table now so the later canon layer needs no rewrite; articles stay in reading_items (supabase/migrations/20260804000000_superlearn.sql).

To apply the schema, paste the two migrations in supabase/migrations/ into the Supabase SQL editor and run them (idempotent, safe to re-run): 20260804000000_superlearn.sql (the app schema) and 20260815000000_manifold_state.sql (manifold's agent memory). Before the migrations run, the app degrades gracefully: missing tables are recorded and surfaced as one quiet setup hint instead of a crash (src/data/dataLayer.ts, `degradedTables`).

## Assisted onboarding

Sources live in `context.sources`. During onboarding they are proposed by a direct in-app Claude call (src/lib/claude.ts), validated through the feed proxy chain before saving (src/lib/feeds.ts), and legacy feeds are migrated in on first load (src/lib/migrate.ts). For environments that do not provide Claude, an optional Anthropic API key can be stored device-local only, never synced (src/config.ts, `LOCAL_API_KEY_STORAGE`).

## Design system

Broadsheet identity: Playfair Display for display headlines, IM Fell English for body, JetBrains Mono for lowercase labels and meta. Cobalt and red are the only UI chrome accents; hairline rules, near-zero radius, visible keyboard focus, reduced motion respected. Background tokens were confirmed from claude.ai light mode: bg #F9F9F7, card #F3F3F0 (src/styles.css).

## Local dev

```
npm install
npm run dev      # vite dev server
npm run check    # lint + typecheck + test + build
```

`npm run build` writes the self-contained index.html at the repo root (scripts/postbuild.mjs), and fails the build if the artifact is not self-contained or if the previous reading app's name leaks in.

## Deploy

GitHub Pages serves index.html from the main branch root (inferred from the previous deployment). CI (.github/workflows/ci.yml) runs lint, typecheck, the smoke test, and the build, then verifies the committed artifact is current, plus manifold's typecheck and deterministic eval subset.

## manifold: the editor agent

manifold lives in `manifold/` and is part of Superlearn: it deploys with the app and imports the app's contract directly (src/schemas.ts and src/types.ts, through manifold/src/app-contract.ts), so the two can never drift. It runs on GitHub Actions on Node via tsx: the editorial pass on Tuesday and Friday 07:00 America/Toronto, the outbox sweep hourly (docs/adr/0001-manifold-runtime.md).

A fresh clone plus a Supabase project plus one Anthropic key produces editions with no other repo involved: install (`npm ci`), copy `.env.example` to `.env` and fill in `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY`, apply the two migrations, and run `npm run manifold:edition`. Full setup, schedules, disable switches, and the evals harness: manifold/README.md.

## Phase plan

- **Phase 1, walking skeleton (this).** The cockpit reads editions, themes, and links; writes actions to the outbox; ships a seed edition built client-side from feeds before manifold's first write (src/lib/seed.ts).
- **Phase 2, hardening.** Full test pyramid. A manifold evals harness with a rubric: rationale groundedness, horizon coverage, emergence versus hype, clustering coherence, no-shame tone, and tags never filter. Schema validation gating on everything manifold writes.
- **Phase 3+, parked.** Resources canon layer, gamification, org dashboards. Manifold now lives in this repo (manifold/) and deploys with the app; it meets the cockpit only through Supabase, exactly as before, but is versioned and shipped as one product (docs/adr/0001-manifold-runtime.md).
