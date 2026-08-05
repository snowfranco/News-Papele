-- Superlearn schema migration (2026-08-04).
--
-- How to apply, either:
--   1. Paste this whole file into the Supabase SQL editor for project
--      gijdjbjycymqsuhwfcbu and run it, or
--   2. supabase db push (Supabase CLI linked to the same project).
--
-- Safe to re-run: every statement is guarded with IF NOT EXISTS,
-- DROP POLICY IF EXISTS, or an anonymous DO block.
--
-- Writer/reader split (mirrors src/types.ts):
--   the app  writes outbox, positions, context, reading_items (feed refresh);
--            it reads editions, themes, theme_links, positions, context,
--            reading_items.
--   manifold writes editions, themes, theme_links; it reads outbox, context,
--            reading_items.
--
-- RLS is enabled on every new table with deliberately open "allow all"
-- policies, matching the existing tables: the project uses the public anon
-- key end to end today, and context holds one row per tenant.

-- ---------------------------------------------------------------- context

create table if not exists public.context (
  id uuid primary key default gen_random_uuid(),
  tenant text not null default 'default' unique,
  sources jsonb not null default '{"feeds":[],"blogs":[],"resources":[]}'::jsonb,
  projects jsonb not null default '[]'::jsonb,
  org_context text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.context is
  'Tenant-keyed app context (sources, projects, org context). Written by the app (upsert on tenant), read by the app and manifold. One row per tenant.';

-- --------------------------------------------------------------- editions

create table if not exists public.editions (
  id uuid primary key default gen_random_uuid(),
  edition_no integer,
  edition_date date not null default current_date,
  beat text,
  welcome text not null default '',
  lede jsonb,
  emerging jsonb not null default '[]'::jsonb,
  start_here jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.editions is
  'Daily editions. Written by manifold, read by the app (latest first).';

-- ----------------------------------------------------------------- themes

create table if not exists public.themes (
  id text primary key,
  label text not null,
  discipline text not null default 'general',
  lane text not null default 'horizon' check (lane in ('applied', 'horizon')),
  heat numeric not null default 0.5 check (heat >= 0 and heat <= 1),
  mastery text not null default 'unread' check (mastery in ('unread', 'progress', 'position')),
  why text not null default '',
  reads integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.themes is
  'Learning themes. Written by manifold, read by the app. Lane is an enrichment tag, never a filter.';

-- ------------------------------------------------------------ theme links

-- No FK on source_id/target_id: for kind 'project' the target is a project
-- id inside context.projects (jsonb), and manifold may write links ahead of
-- themes; the app filters dangling links client side.
create table if not exists public.theme_links (
  id uuid primary key default gen_random_uuid(),
  source_id text not null,
  target_id text not null,
  kind text not null default 'relate' check (kind in ('relate', 'project')),
  created_at timestamptz not null default now(),
  unique (source_id, target_id, kind)
);

comment on table public.theme_links is
  'Theme-to-theme (relate) and theme-to-project (project) links. Written by manifold, read by the app.';

-- -------------------------------------------------------------- positions

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  theme_id text,
  kind text not null check (kind in ('column', 'contrarian', 'hot_take', 'explain_back')),
  title text not null default '',
  body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  published_at timestamptz
);

comment on table public.positions is
  'Reader positions (columns, contrarian takes, explain-backs). Written and read by the app.';

-- ----------------------------------------------------------------- outbox

create table if not exists public.outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  label text not null default '',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'seen', 'done')),
  created_at timestamptz not null default now()
);

comment on table public.outbox is
  'Action outbox. Written by the app, read and consumed by manifold (queued to seen to done).';

-- -------------------------------------------------------------- resources

-- Durable resources (books, courses, trainings) live here; articles stay in
-- reading_items. Shipping the table now means the later canon layer needs no
-- rewrite.
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('book', 'course', 'training', 'webinar', 'article', 'other')),
  title text not null,
  url text,
  author text,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.resources is
  'Durable learning resources. Articles stay in reading_items; this table carries the canon layer later without a rewrite.';

create table if not exists public.theme_resources (
  theme_id text not null,
  resource_id uuid not null references public.resources (id) on delete cascade,
  why text,
  created_at timestamptz not null default now(),
  primary key (theme_id, resource_id)
);

comment on table public.theme_resources is
  'Which resources ground a theme, and why.';

-- ------------------------------------------- legacy tables (guarded create)

-- The existing project already has these two tables; IF NOT EXISTS makes
-- this a no-op there. On a fresh project they are created here so the
-- alters below and the app's reads never hard-fail.
create table if not exists public.reading_items (
  id text primary key,
  type text,
  title text not null,
  url text,
  image_base64 text,
  image_mime text,
  image_preview text,
  snippet text,
  topics jsonb not null default '[]'::jsonb,
  read boolean not null default false,
  added_at timestamptz not null default now()
);

create table if not exists public.article_read_states (
  article_id text primary key,
  read boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.reading_items is
  'Articles from the reader''s sources; the corpus manifold reads. The app upserts on feed refresh.';

comment on table public.article_read_states is
  'Per-article read flags, written by the app.';

-- ---------------------------------------------------- reading_items alters

alter table public.reading_items add column if not exists source_feed text;
alter table public.reading_items add column if not exists published_at timestamptz;
alter table public.reading_items add column if not exists origin text not null default 'manual';

-- ADD CONSTRAINT has no IF NOT EXISTS in postgres, so guard via pg_constraint.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reading_items_origin_check'
      and conrelid = 'public.reading_items'::regclass
  ) then
    alter table public.reading_items
      add constraint reading_items_origin_check
      check (origin in ('feed', 'manual', 'manifold'));
  end if;
end
$$;

-- ---------------------------------------------------------------- indexes

create index if not exists outbox_status_created_at_idx
  on public.outbox (status, created_at desc);

create index if not exists editions_created_at_idx
  on public.editions (created_at desc);

create index if not exists positions_theme_id_idx
  on public.positions (theme_id);

create index if not exists theme_links_source_id_idx
  on public.theme_links (source_id);

create index if not exists theme_links_target_id_idx
  on public.theme_links (target_id);

-- -------------------------------------------------------------------- RLS

alter table public.context enable row level security;
alter table public.editions enable row level security;
alter table public.themes enable row level security;
alter table public.theme_links enable row level security;
alter table public.positions enable row level security;
alter table public.outbox enable row level security;
alter table public.resources enable row level security;
alter table public.theme_resources enable row level security;
alter table public.reading_items enable row level security;
alter table public.article_read_states enable row level security;

drop policy if exists "allow all" on public.context;
create policy "allow all" on public.context for all using (true) with check (true);

drop policy if exists "allow all" on public.editions;
create policy "allow all" on public.editions for all using (true) with check (true);

drop policy if exists "allow all" on public.themes;
create policy "allow all" on public.themes for all using (true) with check (true);

drop policy if exists "allow all" on public.theme_links;
create policy "allow all" on public.theme_links for all using (true) with check (true);

drop policy if exists "allow all" on public.positions;
create policy "allow all" on public.positions for all using (true) with check (true);

drop policy if exists "allow all" on public.outbox;
create policy "allow all" on public.outbox for all using (true) with check (true);

drop policy if exists "allow all" on public.resources;
create policy "allow all" on public.resources for all using (true) with check (true);

drop policy if exists "allow all" on public.theme_resources;
create policy "allow all" on public.theme_resources for all using (true) with check (true);

drop policy if exists "allow all" on public.reading_items;
create policy "allow all" on public.reading_items for all using (true) with check (true);

drop policy if exists "allow all" on public.article_read_states;
create policy "allow all" on public.article_read_states for all using (true) with check (true);
