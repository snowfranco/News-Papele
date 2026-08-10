# AGENTS

Rules for any agent working in this repo. Durable context: PROJECT_OS.md.
Status: ROADMAP.md. Worklist: PARKING_LOT.md. Read those at session start.

## Product principles (contract rules, not tone)

1. Learning is never gated by projects; project relevance is a lens, never a
   filter; the horizon lane always surfaces.
2. Never shame the backlog: no unread counters, no "N waiting" copy, no red
   badges. Inventory counts are fine; pressure is not.
3. One surface: acting on something writes to the outbox with a toast. Never
   send the user to another tool, file, or report to act.

## Architecture rules

- All Supabase access goes through src/data/dataLayer.ts. Never a second
  client, never a raw fetch to the backend from a view.
- Views consume only the store (src/state/AppStore.tsx useStore).
- Every row read and every declared outbox payload is zod-validated
  (src/schemas.ts); extend the contract in src/types.ts + src/schemas.ts
  together, and flag contract changes [CONTRACT-NOTE] in the commit body
  (manifold consumes these shapes).
- Degrade, never crash: missing tables and unreachable backend are existing
  first-class states; new reads and writes must handle both.
- No localStorage for state that must sync; Supabase for sync, React state
  for ephemeral UI. (Sanctioned exceptions live in src/config.ts.)

## Hard don'ts

- Never write the old product name (two syllables, starts with "Pa")
  anywhere, including comments and docs; build guards assembled from string
  parts enforce this (scripts/postbuild.mjs).
- Never test write actions in the browser against the real backend; use
  ?demo (all mutations are demo-guarded). Production holds real data.
- Never create themes from the app; manifold owns theme creation, the app
  queues assign-to-theme through the outbox.

## Workflow

- npm run dev (vite), npm run check (lint + typecheck + test + build).
- The committed index.html IS the deploy artifact (Pages branch mode): run
  npm run build and commit the regenerated index.html with every source
  change, or CI fails the freshness check.
- Commit style: present-tense summary line ending with a period, body
  explaining what and why; wrap near 72 columns.
- Docs house style: no em dashes; every claim about system state cites a
  file or is tagged [INFERRED] / [GAP].
