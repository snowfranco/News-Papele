// Zod schemas for every row the app reads from Supabase, most importantly
// the shapes manifold writes (editions, themes, theme_links). Rows that fail
// validation are dropped (with a console warning) rather than rendered, so a
// bad agent write degrades to an empty state instead of a broken page.
import { z } from 'zod';
import type {
  AppContext,
  Edition,
  OutboxItem,
  Position,
  ReadingItem,
  SourceSuggestion,
  Theme,
  ThemeLink,
} from './types';
import { EMPTY_SOURCES } from './types';

const iso = z.string().min(1);

// ---------------------------------------------------------------- context

const feedSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  color: z.string().optional(),
  enabled: z.boolean().default(true),
});

const linkSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  enabled: z.boolean().default(true),
});

/** Element-level salvage: one malformed entry is dropped with a warning
 * instead of failing the array (and with it the whole context row, which
 * would throw an existing reader back into onboarding). */
function salvageArray<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>) {
  return z
    .array(z.unknown())
    .default([])
    .transform((arr) =>
      arr.flatMap((el) => {
        const parsed = schema.safeParse(el);
        if (parsed.success) return [parsed.data];
        console.warn('superlearn: dropped invalid source entry', parsed.error.issues[0]);
        return [];
      }),
    );
}

const sourcesSchema = z.object({
  feeds: salvageArray(feedSourceSchema),
  blogs: salvageArray(linkSourceSchema),
  resources: salvageArray(linkSourceSchema),
});

const projectSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

export const contextRowSchema = z
  .object({
    id: z.string(),
    tenant: z.string(),
    sources: sourcesSchema.nullish(),
    projects: z.array(projectSchema).nullish(),
    org_context: z.string().nullish(),
    updated_at: iso.nullish(),
  })
  .transform(
    (r): AppContext => ({
      id: r.id,
      tenant: r.tenant,
      sources: r.sources ?? EMPTY_SOURCES,
      projects: r.projects ?? [],
      orgContext: r.org_context ?? null,
      updatedAt: r.updated_at ?? new Date(0).toISOString(),
    }),
  );

// ----------------------------------------------------------------- themes

const laneSchema = z.enum(['applied', 'horizon']).catch('horizon');
const masterySchema = z.enum(['unread', 'progress', 'position']).catch('unread');

export const themeRowSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    discipline: z.string().nullish(),
    lane: laneSchema.nullish(),
    heat: z.coerce.number().min(0).max(1).nullish(),
    mastery: masterySchema.nullish(),
    why: z.string().nullish(),
    reads: z.coerce.number().int().min(0).nullish(),
    created_at: iso.nullish(),
    updated_at: iso.nullish(),
  })
  .transform(
    (r): Theme => ({
      id: r.id,
      label: r.label,
      discipline: r.discipline ?? 'general',
      lane: r.lane ?? 'horizon',
      heat: r.heat ?? 0.5,
      mastery: r.mastery ?? 'unread',
      why: r.why ?? '',
      reads: r.reads ?? 0,
      createdAt: r.created_at ?? '',
      updatedAt: r.updated_at ?? '',
    }),
  );

export const themeLinkRowSchema = z
  .object({
    id: z.string(),
    source_id: z.string().min(1),
    target_id: z.string().min(1),
    kind: z.enum(['relate', 'project']).catch('relate'),
  })
  .transform(
    (r): ThemeLink => ({
      id: r.id,
      sourceId: r.source_id,
      targetId: r.target_id,
      kind: r.kind,
    }),
  );

// --------------------------------------------------------------- editions

/** Contract rule, not just tone: a welcome line never counts a backlog. */
const noBacklogShaming = (s: string) =>
  !/\b\d+\s+(unread|items? (piled|waiting)|articles? (piled|waiting))\b/i.test(s);

const ledeSchema = z.object({
  kicker: z.string().default(''),
  title: z.string().min(1),
  deck: z.string().default(''),
  why: z.string().default(''),
  apply_project_id: z.string().nullish(),
  item_ids: z.array(z.string()).default([]),
  url: z.string().url().optional(),
});

const emergingSchema = z.object({
  theme_id: z.string().nullish(),
  tag: z.string().default(''),
  title: z.string().min(1),
  note: z.string().default(''),
  meta: z.string().default(''),
  lane: laneSchema.default('horizon'),
});

const startHereSchema = z.object({
  item_id: z.string().nullish(),
  title: z.string().min(1),
  minutes: z.coerce.number().int().min(1).max(180).default(10),
  note: z.string().default(''),
  url: z.string().url().optional(),
});

export const editionRowSchema = z
  .object({
    id: z.string(),
    edition_no: z.coerce.number().int().nullish(),
    edition_date: z.string().nullish(),
    beat: z.string().nullish(),
    welcome: z.string().refine(noBacklogShaming, 'welcome line counts the backlog').default(''),
    lede: ledeSchema.nullish(),
    emerging: z.array(emergingSchema).default([]),
    start_here: z.array(startHereSchema).default([]),
    created_at: iso.nullish(),
  })
  .transform(
    (r): Edition => ({
      id: r.id,
      editionNo: r.edition_no ?? null,
      editionDate: r.edition_date ?? '',
      beat: r.beat ?? null,
      welcome: r.welcome,
      lede: r.lede
        ? {
            kicker: r.lede.kicker,
            title: r.lede.title,
            deck: r.lede.deck,
            why: r.lede.why,
            applyProjectId: r.lede.apply_project_id ?? null,
            itemIds: r.lede.item_ids,
            url: r.lede.url,
          }
        : null,
      emerging: r.emerging.map((e) => ({
        themeId: e.theme_id ?? null,
        tag: e.tag,
        title: e.title,
        note: e.note,
        meta: e.meta,
        lane: e.lane,
      })),
      startHere: r.start_here.map((s) => ({
        itemId: s.item_id ?? null,
        title: s.title,
        minutes: s.minutes,
        note: s.note,
        url: s.url,
      })),
      createdAt: r.created_at ?? '',
    }),
  );

// -------------------------------------------------------------- positions

export const positionRowSchema = z
  .object({
    id: z.string(),
    theme_id: z.string().nullish(),
    kind: z.enum(['column', 'contrarian', 'hot_take', 'explain_back']),
    title: z.string().default(''),
    body: z.string().default(''),
    status: z.enum(['draft', 'published']).catch('draft'),
    created_at: iso.nullish(),
    published_at: iso.nullish(),
  })
  .transform(
    (r): Position => ({
      id: r.id,
      themeId: r.theme_id ?? null,
      kind: r.kind,
      title: r.title,
      body: r.body,
      status: r.status,
      createdAt: r.created_at ?? '',
      publishedAt: r.published_at ?? null,
    }),
  );

// ----------------------------------------------------------------- outbox

export const outboxRowSchema = z
  .object({
    id: z.string(),
    kind: z.string().min(1),
    label: z.string().default(''),
    payload: z.record(z.unknown()).nullish(),
    status: z.enum(['queued', 'seen', 'done']).catch('queued'),
    created_at: iso.nullish(),
  })
  .transform(
    (r): OutboxItem => ({
      id: r.id,
      kind: r.kind as OutboxItem['kind'],
      label: r.label,
      payload: r.payload ?? {},
      status: r.status,
      createdAt: r.created_at ?? '',
    }),
  );

// ---------------------------------------------------------- reading items

export const readingItemRowSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().nullish(),
    title: z.string().min(1),
    url: z.string().nullish(),
    snippet: z.string().nullish(),
    topics: z.array(z.string()).nullish(),
    read: z.boolean().nullish(),
    added_at: z.string().nullish(),
    source_feed: z.string().nullish(),
    published_at: z.string().nullish(),
    origin: z.string().nullish(),
    image_preview: z.string().nullish(),
  })
  .transform(
    (r): ReadingItem => ({
      id: r.id,
      type: (['article', 'book', 'course', 'training', 'webinar', 'note'].includes(r.type ?? '')
        ? r.type
        : 'article') as ReadingItem['type'],
      title: r.title,
      url: r.url ?? null,
      snippet: r.snippet ?? null,
      topics: r.topics ?? [],
      read: r.read ?? false,
      addedAt: r.added_at ?? '',
      sourceFeed: r.source_feed ?? null,
      publishedAt: r.published_at ?? null,
      origin: (['feed', 'manual', 'manifold'].includes(r.origin ?? '')
        ? r.origin
        : 'manual') as ReadingItem['origin'],
      imagePreview: r.image_preview ?? null,
    }),
  );

// ------------------------------------------------------ source suggestions

export const sourceSuggestionSchema: z.ZodType<SourceSuggestion, z.ZodTypeDef, unknown> = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  kind: z.enum(['feed', 'blog', 'resource']),
  reason: z.string().default(''),
});

export const sourceSuggestionsResponseSchema = z.object({
  suggestions: z.array(sourceSuggestionSchema).min(1),
});

// ----------------------------------------------------------------- helpers

/** Parse an array of raw rows, dropping invalid rows with a warning. */
export function parseRows<T>(
  rows: unknown[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  table: string,
): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.warn(`superlearn: dropped invalid ${table} row`, parsed.error.issues[0]);
    }
  }
  return out;
}
