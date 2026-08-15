// The deterministic gate. Nothing reaches Supabase without passing every
// check here; a failing run is rejected and logged, never written. The
// evals harness runs the exact same checks, so "the deterministic subset
// gates real runs" is one code path, not two.
import {
  editionInsertSchema,
  roundTripErrors,
  shameFree,
  themeLinkInsertSchema,
  themeUpsertSchema,
} from './contract.ts';
import type { BuiltPass } from './editorial.ts';
import type { PassInputs } from './inputs.ts';

export interface GateResult {
  pass: boolean;
  errors: string[];
  warnings: string[];
  /** Per-check outcome for reports and eval scoring. */
  checks: Record<string, boolean>;
}

/** Digit tokens in generated prose must appear in the cited items' own
 * text: the cheapest deterministic uncited-claim detector. Commas are
 * stripped on both sides so "5,000" grounds "5000". */
function ungroundedNumbers(prose: string, citedText: string): string[] {
  const numbers = prose.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) ?? [];
  const haystack = citedText.replace(/,/g, '');
  return [...new Set(numbers.filter((n) => !haystack.includes(n)))];
}

function citedText(inputs: PassInputs, ids: string[]): string {
  const byId = new Map(inputs.items.map((i) => [i.id, i]));
  return ids
    .map((id) => byId.get(id))
    .filter((i) => i !== undefined)
    .map((i) => `${i.title} ${i.snippet ?? ''} ${i.topics.join(' ')} ${i.sourceFeed ?? ''} ${i.url ?? ''}`)
    .join(' ');
}

export function runGate(inputs: PassInputs, built: BuiltPass): GateResult {
  const errors: string[] = [];
  const checks: Record<string, boolean> = {};
  const inputIds = new Set(inputs.items.map((i) => i.id));
  const { edition, themes, links, audit } = built;

  // ------------------------------------------------------- schema validity
  const schemaErrors: string[] = [];
  const editionParse = editionInsertSchema.safeParse(edition);
  if (!editionParse.success) {
    for (const issue of editionParse.error.issues.slice(0, 5)) {
      schemaErrors.push(`edition.${issue.path.join('.')}: ${issue.message}`);
    }
  }
  for (const theme of themes) {
    const parse = themeUpsertSchema.safeParse(theme);
    if (!parse.success) {
      schemaErrors.push(`theme ${theme.id}: ${parse.error.issues[0]?.path.join('.')} ${parse.error.issues[0]?.message}`);
    }
  }
  for (const link of links) {
    const parse = themeLinkInsertSchema.safeParse(link);
    if (!parse.success) schemaErrors.push(`link ${link.source_id}->${link.target_id}: invalid`);
  }
  checks['schema-valid'] = schemaErrors.length === 0;
  errors.push(...schemaErrors);

  // ------------------------------------------------ app-contract round trip
  const rtErrors = roundTripErrors(edition, themes, links);
  checks['app-contract-round-trip'] = rtErrors.length === 0;
  errors.push(...rtErrors);

  // -------------------------------------------------------- cited ids exist
  const citationErrors: string[] = [];
  if (audit.lede.length === 0) citationErrors.push('lede cites no items');
  for (const id of audit.lede) {
    if (!inputIds.has(id)) citationErrors.push(`lede cites unknown item ${id}`);
  }
  audit.emerging.forEach((ids, i) => {
    if (ids.length === 0) citationErrors.push(`emerging[${i}] cites no items`);
    for (const id of ids) if (!inputIds.has(id)) citationErrors.push(`emerging[${i}] cites unknown item ${id}`);
  });
  audit.startHere.forEach((id, i) => {
    if (!inputIds.has(id)) citationErrors.push(`start_here[${i}] cites unknown item ${id}`);
  });
  for (const [themeId, ids] of Object.entries(audit.themes)) {
    if (ids.length === 0) citationErrors.push(`theme ${themeId} cites no items`);
    for (const id of ids) if (!inputIds.has(id)) citationErrors.push(`theme ${themeId} cites unknown item ${id}`);
  }
  checks['cited-ids-exist'] = citationErrors.length === 0;
  errors.push(...citationErrors);

  // -------------------------------------------- emerging themes are written
  const themeIds = new Set(themes.map((t) => t.id));
  const themeRefErrors = edition.emerging
    .filter((e) => !themeIds.has(e.theme_id))
    .map((e) => `emerging entry "${e.title}" cites theme ${e.theme_id}, which this run does not write`);
  checks['emerging-theme-written'] = themeRefErrors.length === 0;
  errors.push(...themeRefErrors);

  // -------------------------------------------------------- horizon present
  const horizonOk = edition.emerging.some((e) => e.lane === 'horizon');
  checks['horizon-present'] = horizonOk;
  if (!horizonOk) errors.push('no emerging entry resolves to the horizon lane');

  // ------------------------------------------------------- uncited numbers
  const allCitedIds = [
    ...audit.lede,
    ...audit.emerging.flat(),
    ...audit.startHere,
    ...Object.values(audit.themes).flat(),
  ];
  const numberErrors: string[] = [];
  const sections: { name: string; prose: string; ids: string[] }[] = [
    {
      name: 'lede',
      prose: `${edition.lede.kicker} ${edition.lede.title} ${edition.lede.deck} ${edition.lede.why}`,
      ids: audit.lede,
    },
    { name: 'beat', prose: edition.beat ?? '', ids: allCitedIds },
    ...edition.emerging.map((e, i) => ({
      name: `emerging[${i}]`,
      prose: `${e.tag} ${e.title} ${e.note}`,
      ids: [...(audit.emerging[i] ?? []), ...(audit.themes[e.theme_id] ?? [])],
    })),
    ...edition.start_here.map((s, i) => ({
      name: `start_here[${i}]`,
      prose: s.note,
      ids: [audit.startHere[i] ?? ''],
    })),
    ...themes.map((t) => ({
      name: `theme ${t.id}`,
      prose: `${t.label} ${t.discipline} ${t.why}`,
      ids: audit.themes[t.id] ?? [],
    })),
  ];
  for (const section of sections) {
    const loose = ungroundedNumbers(section.prose, citedText(inputs, section.ids));
    if (loose.length > 0) {
      numberErrors.push(
        `${section.name} uses number(s) [${loose.join(', ')}] that appear in none of its cited items`,
      );
    }
  }
  checks['numbers-grounded'] = numberErrors.length === 0;
  errors.push(...numberErrors);

  // ---------------------------------------------------------------- tone
  // The welcome cites nothing, so it may claim nothing: no digits at all.
  const toneErrors: string[] = [];
  if (!shameFree(edition.welcome)) toneErrors.push('welcome line mentions the backlog or unread pile');
  if (/\d/.test(edition.welcome))
    toneErrors.push('welcome line contains a digit; the welcome must carry no digits at all (spell numbers out if truly needed)');
  checks['no-shame-welcome'] = toneErrors.length === 0;
  errors.push(...toneErrors);

  // ------------------------------------------------------ theme id unique
  // buildFromModel merges colliding ids, so this firing means a code bug,
  // but a duplicate id in one upsert batch would abort the whole write with
  // a Postgres cardinality error, so it stays gated.
  const idCounts = new Map<string, number>();
  for (const t of themes) idCounts.set(t.id, (idCounts.get(t.id) ?? 0) + 1);
  const dupes = [...idCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  checks['theme-ids-unique'] = dupes.length === 0;
  if (dupes.length > 0) errors.push(`duplicate theme id(s) in one batch: ${dupes.join(', ')}`);

  // -------------------------------------------------------- parked not lede
  // Parked never leads: neither items the reader parked directly, nor the
  // items this very run maps to a theme the reader parked. A resurfaced
  // parked theme may appear in emerging (with a warning), just not as the lede.
  const parkedErrors: string[] = [];
  const parkedItems = new Set(inputs.state.parked.flatMap((p) => p.itemIds));
  const parkedThemeIds = new Set(inputs.state.parked.map((p) => p.themeId).filter(Boolean));
  const parkedLede = edition.lede.item_ids.filter((id) => parkedItems.has(id));
  if (parkedLede.length > 0)
    parkedErrors.push(`lede cites item(s) the reader parked: ${parkedLede.join(', ')}; parked items do not lead`);
  for (const themeId of parkedThemeIds) {
    const themeItems = new Set(audit.themes[themeId as string] ?? []);
    const overlap = edition.lede.item_ids.filter((id) => themeItems.has(id));
    if (overlap.length > 0)
      parkedErrors.push(
        `lede cites item(s) [${overlap.join(', ')}] backing parked theme ${themeId}; a parked theme never leads`,
      );
  }
  checks['parked-not-lede'] = parkedErrors.length === 0;
  errors.push(...parkedErrors);

  // ------------------------------------------------ no excluded item leads
  // The exclusion set (read plus parked, inputs.excludedItemIds) never
  // leads and is never recommended in start_here. Excluded items may still
  // back themes and emerging entries: the reader engaged with them, and
  // that is clustering signal, not lede material.
  const excluded = new Set(inputs.excludedItemIds);
  const exclusionErrors: string[] = [];
  const excludedLede = edition.lede.item_ids.filter((id) => excluded.has(id));
  if (excludedLede.length > 0)
    exclusionErrors.push(
      `lede cites excluded item(s) [${excludedLede.join(', ')}]: the reader already read or parked them; they do not lead`,
    );
  const excludedStartHere = audit.startHere.filter((id) => excluded.has(id));
  if (excludedStartHere.length > 0)
    exclusionErrors.push(
      `start_here recommends excluded item(s) [${excludedStartHere.join(', ')}]: never re-recommend what the reader already read or parked`,
    );
  checks['no-excluded-item-leads'] = exclusionErrors.length === 0;
  errors.push(...exclusionErrors);

  // -------------------------------------------------- superlearn not a node
  const nodeErrors: string[] = [];
  for (const t of themes) {
    if (/superlearn/i.test(t.id) || /superlearn/i.test(t.label)) {
      nodeErrors.push(`theme "${t.label}" makes Superlearn a node; Superlearn is the surface`);
    }
  }
  for (const l of links) {
    if (/superlearn/i.test(l.source_id) || /superlearn/i.test(l.target_id)) {
      nodeErrors.push(`link ${l.source_id}->${l.target_id} makes Superlearn a node`);
    }
  }
  checks['superlearn-not-a-node'] = nodeErrors.length === 0;
  errors.push(...nodeErrors);

  // ------------------------------------------------------ project validity
  const projectIds = new Set((inputs.context?.projects ?? []).map((p) => p.id));
  const projectErrors: string[] = [];
  if (edition.lede.apply_project_id && !projectIds.has(edition.lede.apply_project_id)) {
    projectErrors.push(`lede apply_project_id ${edition.lede.apply_project_id} is not in context.projects`);
  }
  for (const l of links) {
    if (l.kind === 'project' && !projectIds.has(l.target_id)) {
      projectErrors.push(`project link target ${l.target_id} is not in context.projects`);
    }
  }
  checks['project-ids-valid'] = projectErrors.length === 0;
  errors.push(...projectErrors);

  return { pass: errors.length === 0, errors, warnings: [...built.warnings], checks };
}
