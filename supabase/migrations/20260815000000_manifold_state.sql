-- manifold_state migration (2026-08-15).
--
-- Adds manifold's own working state (parks, reader notes, reading signals,
-- theme assignments, routing records) to Superlearn's Supabase. Before the
-- manifold extraction this lived in a file in the Mission Control repo
-- (agents/manifold/state/state.json); the extracted agent runs on ephemeral
-- GitHub Actions runners with no persistent disk, so the state moves into the
-- database it already talks to (manifold/src/state.ts;
-- docs/adr/0001-manifold-runtime.md).
--
-- How to apply, either:
--   1. Paste this file into the Supabase SQL editor for project
--      gijdjbjycymqsuhwfcbu and run it, or
--   2. supabase db push (Supabase CLI linked to the same project).
--
-- Safe to re-run: guarded with IF NOT EXISTS and DROP POLICY IF EXISTS.
--
-- Writer/reader: manifold reads and writes this table (one row per tenant,
-- upsert on tenant). The app never touches it; it is agent-internal memory,
-- not part of the app-facing contract (src/types.ts). RLS is allow-all to
-- match every other table: the project uses the public anon key end to end
-- today, though manifold prefers the service role key
-- (supabase/migrations/20260804000000_superlearn.sql, PROJECT_OS.md).

create table if not exists public.manifold_state (
  tenant text primary key,
  state jsonb not null default '{"parked":[],"notes":[],"signals":[],"assignments":[],"handoffs":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.manifold_state is
  'manifold agent memory: parks, notes, reading signals, theme assignments, routing records. One row per tenant, written and read by manifold only (manifold/src/state.ts). Not part of the app contract.';

alter table public.manifold_state enable row level security;

drop policy if exists "allow all" on public.manifold_state;
create policy "allow all" on public.manifold_state for all using (true) with check (true);
