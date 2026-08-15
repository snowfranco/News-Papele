-- theme item_ids migration (2026-08-16).
--
-- Adds themes.item_ids so manifold can persist the reads that formed each
-- theme, which the theme map's detail panel and the Position desk's progress
-- line surface as live citations (src/components/Citations.tsx). Emerging-card
-- citations need no migration: they live inside the editions.emerging jsonb.
--
-- How to apply, either:
--   1. Paste this file into the Supabase SQL editor for project
--      gijdjbjycymqsuhwfcbu and run it, or
--   2. supabase db push (Supabase CLI linked to the same project).
--
-- Safe to re-run: guarded with IF NOT EXISTS.
--
-- Writer/reader: manifold writes item_ids on every theme upsert (gate:
-- citation-ids-present); the app reads it (src/schemas.ts themeRowSchema).
-- Before this runs, the app degrades to empty citations rather than crashing;
-- manifold's theme write fails (missing column) until it is applied, so apply
-- it alongside the deploy that persists item_ids.

alter table public.themes
  add column if not exists item_ids jsonb not null default '[]'::jsonb;

comment on column public.themes.item_ids is
  'reading_items ids that formed this theme. Written by manifold, read by the app for theme citations.';
