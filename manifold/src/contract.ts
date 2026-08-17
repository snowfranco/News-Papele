// Writer-side output contract. The app's reader schemas (imported through
// app-contract.ts) are forgiving (defaults and .catch() salvage); a writer
// must be stricter, because a row that only renders thanks to salvage is a
// contract drift the reader never sees. So every row manifold writes must
// pass BOTH:
//   1. the strict writer schema here, and
//   2. a round-trip parse through the app's OWN reader schema (src/schemas.ts,
//      the real thing now, not a vendored copy), with spot checks that salvage
//      did not silently rewrite a value.
import { z } from 'zod';
import {
  editionRowSchema,
  manifoldReplyRowSchema,
  themeLinkRowSchema,
  themeRowSchema,
} from './app-contract.ts';

// ------------------------------------------------------------ shared bits

export const laneSchema = z.enum(['applied', 'horizon']);
export const masterySchema = z.enum(['unread', 'progress', 'position']);

const isoTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'ISO timestamp');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** The app's no-backlog-shaming contract rule, plus manifold's stricter
 * house rule: a welcome line never mentions the pile at all. */
export function shameFree(text: string): boolean {
  if (/\b\d+\s+(unread|items? (piled|waiting)|articles? (piled|waiting))\b/i.test(text)) return false;
  return !/\b(unread|backlog|piling up|pile of|behind on|catch(ing)? up on)\b/i.test(text);
}

// ------------------------------------------------------------- row shapes

export const ledeInsertSchema = z.object({
  kicker: z.string().min(1),
  title: z.string().min(1),
  deck: z.string().min(1),
  why: z.string().min(1),
  apply_project_id: z.string().nullable(),
  item_ids: z.array(z.string().min(1)).min(1),
  url: z.string().url().optional(),
});

export const emergingInsertSchema = z.object({
  theme_id: z.string().min(1),
  tag: z.string().min(1),
  title: z.string().min(1),
  note: z.string().min(1),
  meta: z.string().min(1),
  lane: laneSchema,
  // At least one backing item so the app can surface the card's sources
  // (gate: citation-ids-present).
  item_ids: z.array(z.string().min(1)).min(1),
});

export const startHereInsertSchema = z.object({
  item_id: z.string().min(1),
  title: z.string().min(1),
  minutes: z.number().int().min(1).max(180),
  note: z.string().min(1),
  url: z.string().url().optional(),
});

export const editionInsertSchema = z.object({
  id: z.string().uuid(),
  edition_no: z.number().int().min(1),
  edition_date: isoDate,
  beat: z.string().nullable(),
  welcome: z.string().min(1).refine(shameFree, 'welcome mentions the backlog'),
  lede: ledeInsertSchema,
  emerging: z.array(emergingInsertSchema).min(1).max(5),
  start_here: z.array(startHereInsertSchema).min(1).max(5),
  created_at: isoTimestamp,
});

export const themeUpsertSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, 'kebab-case theme id'),
  label: z.string().min(1),
  discipline: z.string().min(1),
  lane: laneSchema,
  heat: z.number().min(0).max(1),
  mastery: masterySchema,
  why: z.string().min(1),
  reads: z.number().int().min(0),
  // At least one backing item so the theme map's detail panel can surface
  // the reads that formed the theme (gate: citation-ids-present).
  item_ids: z.array(z.string().min(1)).min(1),
  created_at: isoTimestamp,
  updated_at: isoTimestamp,
});

export const themeLinkInsertSchema = z.object({
  source_id: z.string().min(1),
  target_id: z.string().min(1),
  kind: z.enum(['relate', 'project']),
});

export type EditionInsert = z.infer<typeof editionInsertSchema>;
export type ThemeUpsert = z.infer<typeof themeUpsertSchema>;
export type ThemeLinkInsert = z.infer<typeof themeLinkInsertSchema>;

// ---------------------------------------------------- manifold reply insert

/** The devils-advocate row manifold writes to public.manifold_replies. Every
 * claim in the body must trace to a cited reading_items id (gate:
 * reply-citation-ids-present). Kind is a union so a later manifold-authored
 * reply reuses the same table without another migration. */
export const manifoldReplyInsertSchema = z.object({
  position_id: z.string().uuid(),
  kind: z.enum(['devils_advocate']),
  title: z.string().min(1),
  body: z.string().min(1),
  item_ids: z.array(z.string().min(1)).min(1),
});

export type ManifoldReplyInsert = z.infer<typeof manifoldReplyInsertSchema>;

/** Round-trip a would-be reply through the app's reader schema to catch
 * salvage drift (a value the reader only accepts thanks to .catch()/.default()
 * is a contract slip the reader would never see). */
export function replyRoundTripErrors(reply: ManifoldReplyInsert): string[] {
  const errors: string[] = [];
  const parsed = manifoldReplyRowSchema.safeParse({
    // The DB generates the id at write time; the reader schema needs a
    // placeholder to run.
    id: 'pending',
    position_id: reply.position_id,
    kind: reply.kind,
    title: reply.title,
    body: reply.body,
    item_ids: reply.item_ids,
    created_at: new Date(0).toISOString(),
  });
  if (!parsed.success) {
    errors.push(`app reader rejects reply: ${parsed.error.issues[0]?.message}`);
    return errors;
  }
  if (parsed.data.kind !== reply.kind) errors.push('reader rewrote reply.kind');
  if (parsed.data.positionId !== reply.position_id) errors.push('reader rewrote reply.position_id');
  if (parsed.data.title !== reply.title) errors.push('reader rewrote reply.title');
  if (parsed.data.body !== reply.body) errors.push('reader rewrote reply.body');
  if (parsed.data.itemIds.join(',') !== reply.item_ids.join(','))
    errors.push('reader rewrote reply.item_ids');
  return errors;
}

// ----------------------------------------------------- model output shape

/** What the editorial pass asks the model to return. Citations are load
 * bearing: every section names the reading_items ids it stands on. */
export const modelOutputSchema = z.object({
  welcome: z.string().min(1),
  beat: z.string().min(1).nullable(),
  lede: z.object({
    kicker: z.string().min(1),
    title: z.string().min(1),
    deck: z.string().min(1),
    why: z.string().min(1),
    apply_project_id: z.string().nullable(),
    item_ids: z.array(z.string().min(1)).min(1),
  }),
  emerging: z
    .array(
      z.object({
        theme_id: z.string().min(1),
        tag: z.string().min(1),
        title: z.string().min(1),
        note: z.string().min(1),
        item_ids: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1)
    .max(5),
  start_here: z
    .array(
      z.object({
        item_id: z.string().min(1),
        minutes: z.number().int().min(1).max(180).optional(),
        note: z.string().min(1),
      }),
    )
    .min(1)
    .max(5),
  themes: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        discipline: z.string().min(1),
        lane: laneSchema,
        why: z.string().min(1),
        item_ids: z.array(z.string().min(1)).min(1),
        relate_theme_ids: z.array(z.string().min(1)).default([]),
        project_ids: z.array(z.string().min(1)).default([]),
      }),
    )
    .min(1)
    .max(12),
});

export type ModelOutput = z.infer<typeof modelOutputSchema>;

// -------------------------------------------------------------- round trip

/** Parse a would-be write through the app's own reader schema and confirm
 * the values survive untouched (reader .catch()/.default() salvage counts
 * as failure for a writer). Returns error strings; empty means clean. */
export function roundTripErrors(
  edition: EditionInsert,
  themes: ThemeUpsert[],
  links: ThemeLinkInsert[],
): string[] {
  const errors: string[] = [];

  const parsedEdition = editionRowSchema.safeParse(edition);
  if (!parsedEdition.success) {
    errors.push(`app reader rejects edition: ${parsedEdition.error.issues[0]?.message}`);
  } else {
    const e = parsedEdition.data;
    if (e.welcome !== edition.welcome) errors.push('reader rewrote edition.welcome');
    if (e.lede?.title !== edition.lede.title) errors.push('reader rewrote lede.title');
    if ((e.lede?.itemIds ?? []).join(',') !== edition.lede.item_ids.join(','))
      errors.push('reader rewrote lede.item_ids');
    if (e.emerging.length !== edition.emerging.length) errors.push('reader dropped emerging entries');
    e.emerging.forEach((em, i) => {
      if (em.lane !== edition.emerging[i]?.lane) errors.push(`reader rewrote emerging[${i}].lane`);
      if (em.themeId !== edition.emerging[i]?.theme_id) errors.push(`reader rewrote emerging[${i}].theme_id`);
      if ((em.itemIds ?? []).join(',') !== (edition.emerging[i]?.item_ids ?? []).join(','))
        errors.push(`reader rewrote emerging[${i}].item_ids`);
    });
    if (e.startHere.length !== edition.start_here.length) errors.push('reader dropped start_here entries');
    e.startHere.forEach((s, i) => {
      if (s.minutes !== edition.start_here[i]?.minutes) errors.push(`reader rewrote start_here[${i}].minutes`);
    });
  }

  for (const theme of themes) {
    const parsed = themeRowSchema.safeParse(theme);
    if (!parsed.success) {
      errors.push(`app reader rejects theme ${theme.id}: ${parsed.error.issues[0]?.message}`);
      continue;
    }
    if (parsed.data.lane !== theme.lane) errors.push(`reader rewrote theme ${theme.id} lane`);
    if (parsed.data.mastery !== theme.mastery) errors.push(`reader rewrote theme ${theme.id} mastery`);
    if (parsed.data.heat !== theme.heat) errors.push(`reader rewrote theme ${theme.id} heat`);
    if (parsed.data.itemIds.join(',') !== theme.item_ids.join(','))
      errors.push(`reader rewrote theme ${theme.id} item_ids`);
  }

  for (const link of links) {
    // The DB generates link ids; give the reader schema a placeholder.
    const parsed = themeLinkRowSchema.safeParse({ id: 'pending', ...link });
    if (!parsed.success) {
      errors.push(`app reader rejects link ${link.source_id}->${link.target_id}`);
      continue;
    }
    if (parsed.data.kind !== link.kind)
      errors.push(`reader rewrote link ${link.source_id}->${link.target_id} kind`);
  }

  return errors;
}
