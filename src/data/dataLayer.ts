// The single data-access layer. Views and the store call these functions;
// nothing else touches Supabase. Reads validate rows through schemas.ts and
// degrade to empty values when a table is missing (migration not yet run),
// recording the table name so the UI can surface one quiet setup hint
// instead of crashing.
import {
  contextRowSchema,
  editionRowSchema,
  outboxRowSchema,
  parseRows,
  positionRowSchema,
  readingItemRowSchema,
  themeLinkRowSchema,
  themeRowSchema,
} from '../schemas';
import type {
  AppContext,
  Edition,
  FeedSource,
  OutboxItem,
  OutboxKind,
  Position,
  PositionKind,
  Project,
  ReadingItem,
  Sources,
  Theme,
  ThemeLink,
} from '../types';
import { TENANT } from '../config';
import { sbFetch, SupabaseError } from './supabaseClient';

const missingTables = new Set<string>();
const unreachableTables = new Set<string>();

/** Tables the last load found missing (migration not applied). */
export function degradedTables(): string[] {
  return [...missingTables].sort();
}

/** Tables whose last read failed for non-schema reasons (network dead,
 * backend paused, timeout). A healthy empty account and an unreachable one
 * are different states and the UI says so. */
export function unreachableReads(): string[] {
  return [...unreachableTables].sort();
}

async function readTable<T>(
  table: string,
  path: string,
  parse: (rows: unknown[]) => T,
  fallback: T,
): Promise<T> {
  try {
    const rows = await sbFetch<unknown[]>(path);
    missingTables.delete(table);
    unreachableTables.delete(table);
    return parse(rows);
  } catch (err) {
    if (err instanceof SupabaseError && err.tableMissing) {
      missingTables.add(table);
      unreachableTables.delete(table);
    } else {
      unreachableTables.add(table);
      console.warn(`superlearn: read of ${table} failed`, err);
    }
    return fallback;
  }
}

// ---------------------------------------------------------------- context

/** Returns the context row, or null when there genuinely is none (including
 * table-not-migrated, which is recorded as degraded). THROWS on network-level
 * failures: "could not read" must never be mistaken for "new user", or an
 * existing reader would be dumped into onboarding and could overwrite their
 * real sources. */
export async function getContext(): Promise<AppContext | null> {
  try {
    const rows = await sbFetch<unknown[]>(`/context?tenant=eq.${TENANT}&limit=1`);
    missingTables.delete('context');
    unreachableTables.delete('context');
    const parsed = parseRows(rows, contextRowSchema, 'context');
    return parsed[0] ?? null;
  } catch (err) {
    if (err instanceof SupabaseError && err.tableMissing) {
      missingTables.add('context');
      return null;
    }
    unreachableTables.add('context');
    throw err;
  }
}

export interface ContextPatch {
  sources?: Sources;
  projects?: Project[];
  orgContext?: string | null;
}

export async function saveContext(patch: ContextPatch): Promise<void> {
  const body: Record<string, unknown> = {
    tenant: TENANT,
    updated_at: new Date().toISOString(),
  };
  if (patch.sources !== undefined) body.sources = patch.sources;
  if (patch.projects !== undefined) body.projects = patch.projects;
  if (patch.orgContext !== undefined) body.org_context = patch.orgContext;

  await sbFetch('/context?on_conflict=tenant', {
    method: 'POST',
    body: [body],
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

// --------------------------------------------------------------- editions

export async function getLatestEdition(): Promise<Edition | null> {
  // A small window rather than limit=1: parseRows drops a malformed newest
  // row, and the next valid edition still renders.
  return readTable(
    'editions',
    '/editions?order=created_at.desc&limit=5',
    (rows) => {
      const parsed = parseRows(rows, editionRowSchema, 'editions');
      return parsed[0] ?? null;
    },
    null,
  );
}

// ----------------------------------------------------------------- themes

export async function getThemes(): Promise<Theme[]> {
  return readTable(
    'themes',
    '/themes?order=heat.desc&limit=60',
    (rows) => parseRows(rows, themeRowSchema, 'themes'),
    [],
  );
}

export async function getThemeLinks(): Promise<ThemeLink[]> {
  return readTable(
    'theme_links',
    '/theme_links?limit=200',
    (rows) => parseRows(rows, themeLinkRowSchema, 'theme_links'),
    [],
  );
}

// -------------------------------------------------------------- positions

export async function getPositions(): Promise<Position[]> {
  return readTable(
    'positions',
    '/positions?order=created_at.desc&limit=200',
    (rows) => parseRows(rows, positionRowSchema, 'positions'),
    [],
  );
}

export interface NewPosition {
  themeId: string | null;
  kind: PositionKind;
  title: string;
  body: string;
  status: 'draft' | 'published';
}

export async function insertPosition(p: NewPosition): Promise<Position | null> {
  const rows = await sbFetch<unknown[]>('/positions', {
    method: 'POST',
    body: [
      {
        theme_id: p.themeId,
        kind: p.kind,
        title: p.title,
        body: p.body,
        status: p.status,
        published_at: p.status === 'published' ? new Date().toISOString() : null,
      },
    ],
    prefer: 'return=representation',
  });
  return parseRows(rows, positionRowSchema, 'positions')[0] ?? null;
}

export async function publishPosition(id: string): Promise<void> {
  await sbFetch(`/positions?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { status: 'published', published_at: new Date().toISOString() },
    prefer: 'return=minimal',
  });
}

// ----------------------------------------------------------------- outbox

export async function getQueuedOutbox(): Promise<OutboxItem[]> {
  return readTable(
    'outbox',
    '/outbox?status=eq.queued&order=created_at.desc&limit=100',
    (rows) => parseRows(rows, outboxRowSchema, 'outbox'),
    [],
  );
}

export async function queueOutbox(
  kind: OutboxKind,
  label: string,
  payload: Record<string, unknown> = {},
): Promise<OutboxItem | null> {
  const rows = await sbFetch<unknown[]>('/outbox', {
    method: 'POST',
    body: [{ kind, label, payload, status: 'queued' }],
    prefer: 'return=representation',
  });
  return parseRows(rows, outboxRowSchema, 'outbox')[0] ?? null;
}

// ---------------------------------------------------------- reading items

export async function getReadingItems(limit = 120): Promise<ReadingItem[]> {
  return readTable(
    'reading_items',
    `/reading_items?order=added_at.desc&limit=${limit}`,
    (rows) => parseRows(rows, readingItemRowSchema, 'reading_items'),
    [],
  );
}

export interface FeedItemUpsert {
  id: string;
  title: string;
  url: string;
  snippet: string | null;
  sourceFeed: string;
  publishedAt: string | null;
}

/** Upsert freshly fetched feed articles so manifold has a corpus to read.
 * Uses the legacy reading_items shape; the migration adds source_feed,
 * published_at, and origin. Falls back to the legacy column set if the
 * migration has not run yet. */
export async function upsertFeedItems(items: FeedItemUpsert[]): Promise<void> {
  if (items.length === 0) return;
  const now = new Date().toISOString();
  const full = items.map((i) => ({
    id: i.id,
    type: 'article',
    title: i.title,
    url: i.url,
    snippet: i.snippet,
    topics: [],
    read: false,
    added_at: now,
    source_feed: i.sourceFeed,
    published_at: i.publishedAt,
    origin: 'feed',
  }));
  try {
    await sbFetch('/reading_items?on_conflict=id', {
      method: 'POST',
      body: full,
      prefer: 'resolution=ignore-duplicates,return=minimal',
    });
  } catch (err) {
    if (err instanceof SupabaseError && err.tableMissing) {
      // Migration not applied: retry with the legacy column set.
      const legacy = full.map(({ source_feed: _s, published_at: _p, origin: _o, ...rest }) => rest);
      await sbFetch('/reading_items?on_conflict=id', {
        method: 'POST',
        body: legacy,
        prefer: 'resolution=ignore-duplicates,return=minimal',
      });
      return;
    }
    throw err;
  }
}

// ------------------------------------------------------------ read states

export async function getReadStates(): Promise<Record<string, boolean>> {
  return readTable(
    'article_read_states',
    '/article_read_states?limit=1000',
    (rows) => {
      const out: Record<string, boolean> = {};
      for (const row of rows as { article_id?: string; read?: boolean }[]) {
        if (row.article_id) out[row.article_id] = row.read ?? false;
      }
      return out;
    },
    {},
  );
}

export async function setReadState(articleId: string, read: boolean): Promise<void> {
  await sbFetch('/article_read_states', {
    method: 'POST',
    body: [{ article_id: articleId, read, updated_at: new Date().toISOString() }],
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

// ------------------------------------------------------------ legacy feeds

/** Legacy user_feeds table (pre-Superlearn). Read once during migration into
 * context.sources; never written again. */
export async function getLegacyUserFeeds(): Promise<FeedSource[]> {
  try {
    const rows = await sbFetch<
      { id?: string; name?: string; url?: string; color?: string; enabled?: boolean }[]
    >('/user_feeds?order=position.asc');
    return rows
      .filter((r) => r.url && r.name)
      .map((r, i) => ({
        id: r.id ?? `legacy-${i}`,
        name: r.name as string,
        url: r.url as string,
        color: r.color,
        enabled: r.enabled ?? true,
      }));
  } catch {
    return [];
  }
}
