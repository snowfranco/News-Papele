-- manifold_replies migration (2026-08-16).
--
-- Adds a home for manifold-written responses to reader positions. The first
-- writer is the devils-advocate pass (manifold/src/devils_advocate.ts): when
-- the reader publishes a column, manifold composes a cited counter-argument
-- and lands it here. The Position Desk (src/views/PositionDeskView.tsx)
-- renders each reply next to its column with the shared <Citations> atom
-- (src/components/Citations.tsx). kind is a check-in-list so a later manifold
-- writer (agreement, clarification, follow-up read) reuses the table.
--
-- How to apply, either:
--   1. Paste this file into the Supabase SQL editor for project
--      gijdjbjycymqsuhwfcbu and run it, or
--   2. supabase db push (Supabase CLI linked to the same project).
--
-- Safe to re-run: guarded with IF NOT EXISTS and DROP POLICY IF EXISTS.
--
-- Writer/reader: manifold writes this table (its devils-advocate pass);
-- the app reads it. Positions stay reader-authored; manifold never writes
-- to positions.

create table if not exists public.manifold_replies (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.positions (id) on delete cascade,
  kind text not null default 'devils_advocate'
    check (kind in ('devils_advocate')),
  title text not null default '',
  body text not null default '',
  item_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  -- One reply per (position, kind): the devils-advocate pass is idempotent,
  -- so a rerun over the same published column never doubles up.
  unique (position_id, kind)
);

comment on table public.manifold_replies is
  'manifold-authored responses to reader positions. Written by manifold, read by the app. item_ids are reading_items the reply stands on (gate: reply-citation-ids-present).';

comment on column public.manifold_replies.item_ids is
  'reading_items ids backing every claim in the reply, so the app can surface its sources through the shared citations atom.';

create index if not exists manifold_replies_position_id_idx
  on public.manifold_replies (position_id);

create index if not exists manifold_replies_created_at_idx
  on public.manifold_replies (created_at desc);

alter table public.manifold_replies enable row level security;

drop policy if exists "allow all" on public.manifold_replies;
create policy "allow all" on public.manifold_replies for all using (true) with check (true);
