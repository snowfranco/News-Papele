// Slice A: the editorial pass. One model call proposes the edition and the
// theme updates; everything numeric or structural (ids, heat, edition_no,
// mastery carry-forward, meta lines, urls, minutes fallback) is computed
// here deterministically. The model brings judgment; the code brings facts.
import { randomUUID } from 'node:crypto';
import type { ReadingItem, Theme } from './app-contract.ts';
import type {
  EditionInsert,
  ModelOutput,
  ThemeLinkInsert,
  ThemeUpsert,
} from './contract.ts';
import type { PassInputs } from './inputs.ts';
import { normalizeHeat, rawHeat, decayHeat } from './heat.ts';

/** Which input items back every generated section; the gate and the evals
 * both grade against this, and the run report records it. */
export interface CitationAudit {
  lede: string[];
  emerging: string[][];
  startHere: string[];
  themes: Record<string, string[]>;
}

export interface BuiltPass {
  edition: EditionInsert;
  themes: ThemeUpsert[];
  links: ThemeLinkInsert[];
  /** Carried themes untouched by the model this run: heat decays. */
  decayed: { id: string; heat: number; updated_at: string }[];
  audit: CitationAudit;
  warnings: string[];
}

export function slugify(id: string): string {
  return (
    id
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'theme'
  );
}

/** Mirrors the app's estimateMinutes (src/lib/format.ts) for parity. */
export function estimateMinutes(text: string | null): number {
  if (!text) return 8;
  const words = text.split(/\s+/).length;
  return Math.max(4, Math.min(20, Math.round((words * 6) / 220)));
}

function freshnessLabel(items: ReadingItem[], nowIso: string): string {
  const now = Date.parse(nowIso);
  const newest = Math.max(
    ...items.map((i) => Date.parse(i.publishedAt ?? i.addedAt) || 0),
  );
  if (newest <= 0) return 'recent';
  const days = Math.floor((now - newest) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

function metaLine(items: ReadingItem[], nowIso: string): string {
  const sources = new Set(items.map((i) => i.sourceFeed ?? 'unknown')).size;
  return `${sources} source${sources === 1 ? '' : 's'} · ${freshnessLabel(items, nowIso)}`;
}

export function buildFromModel(inputs: PassInputs, output: ModelOutput): BuiltPass {
  const warnings: string[] = [];
  const itemById = new Map(inputs.items.map((i) => [i.id, i]));
  const existingById = new Map(inputs.existingThemes.map((t) => [t.id, t]));
  const parked = new Set(inputs.state.parked.map((p) => p.themeId).filter(Boolean));

  // ---------------------------------------------------------------- themes
  // Model theme ids get slug-normalized; a map keeps every later reference
  // (emerging.theme_id, relate_theme_ids) pointing at the final ids. Two
  // model themes can collapse to one final id ("Vector DBs" and
  // "vector-dbs"); they merge here, because duplicate ids in one upsert
  // batch would abort the whole write with a Postgres cardinality error.
  const idMap = new Map<string, string>();
  for (const t of output.themes) {
    idMap.set(t.id, existingById.has(t.id) ? t.id : slugify(t.id));
  }
  const mergedThemes: ModelOutput['themes'] = [];
  const themeByFinalId = new Map<string, ModelOutput['themes'][number]>();
  for (const t of output.themes) {
    const finalId = idMap.get(t.id) as string;
    const kept = themeByFinalId.get(finalId);
    if (!kept) {
      themeByFinalId.set(finalId, t);
      mergedThemes.push(t);
      continue;
    }
    warnings.push(`model themes "${kept.id}" and "${t.id}" collapse to id ${finalId}; merged their citations`);
    kept.item_ids = [...new Set([...kept.item_ids, ...t.item_ids])];
    kept.relate_theme_ids = [...new Set([...kept.relate_theme_ids, ...t.relate_theme_ids])];
    kept.project_ids = [...new Set([...kept.project_ids, ...t.project_ids])];
  }
  output = { ...output, themes: mergedThemes };

  const themeItems: Record<string, string[]> = {};
  const rawById = new Map<string, number>();
  for (const t of output.themes) {
    const finalId = idMap.get(t.id) as string;
    const backing = t.item_ids.filter((id) => itemById.has(id)).map((id) => itemById.get(id) as ReadingItem);
    themeItems[finalId] = t.item_ids;
    rawById.set(finalId, rawHeat(backing, inputs.nowIso));
  }
  const maxRaw = Math.max(0, ...rawById.values());

  const themes: ThemeUpsert[] = output.themes.map((t) => {
    const finalId = idMap.get(t.id) as string;
    const existing = existingById.get(finalId);
    const backing = t.item_ids.filter((id) => itemById.has(id)).map((id) => itemById.get(id) as ReadingItem);
    const readCount = backing.filter((i) => i.read).length;
    return {
      id: finalId,
      label: t.label,
      discipline: t.discipline,
      lane: t.lane,
      why: t.why,
      heat: normalizeHeat(rawById.get(finalId) ?? 0, maxRaw),
      mastery: existing?.mastery ?? (readCount > 0 ? 'progress' : 'unread'),
      reads: Math.max(existing?.reads ?? 0, readCount),
      // The reads that formed this theme, so the map's detail panel can cite
      // them (gate: citation-ids-present). Merged model ids, matching the audit.
      item_ids: t.item_ids,
      created_at: existing?.createdAt || inputs.nowIso,
      updated_at: inputs.nowIso,
    };
  });
  const themeIds = new Set(themes.map((t) => t.id));

  const decayed = inputs.existingThemes
    .filter((t: Theme) => !themeIds.has(t.id))
    .map((t) => ({
      id: t.id,
      heat: decayHeat(t.heat, t.updatedAt || inputs.nowIso, inputs.nowIso),
      updated_at: inputs.nowIso,
    }))
    .filter((d) => {
      const old = existingById.get(d.id);
      return old !== undefined && Math.abs(old.heat - d.heat) >= 0.01;
    });

  // ----------------------------------------------------------------- links
  const projectIds = new Set((inputs.context?.projects ?? []).map((p) => p.id));
  const existingLinkKeys = new Set(
    inputs.existingLinks.map((l) => `${l.sourceId}|${l.targetId}|${l.kind}`),
  );
  const links: ThemeLinkInsert[] = [];
  const seen = new Set<string>();
  for (const t of output.themes) {
    const source = idMap.get(t.id) as string;
    for (const rid of t.relate_theme_ids) {
      const target = idMap.get(rid) ?? rid;
      if (target === source) continue;
      if (!themeIds.has(target) && !existingById.has(target)) {
        warnings.push(`dropped relate link ${source} -> ${target}: unknown theme`);
        continue;
      }
      const key = `${source}|${target}|relate`;
      if (seen.has(key) || existingLinkKeys.has(key)) continue;
      seen.add(key);
      links.push({ source_id: source, target_id: target, kind: 'relate' });
    }
    for (const pid of t.project_ids) {
      if (!projectIds.has(pid)) {
        warnings.push(`dropped project link ${source} -> ${pid}: not in context.projects`);
        continue;
      }
      const key = `${source}|${pid}|project`;
      if (seen.has(key) || existingLinkKeys.has(key)) continue;
      seen.add(key);
      links.push({ source_id: source, target_id: pid, kind: 'project' });
    }
  }

  // --------------------------------------------------------------- edition
  const ledeItems = output.lede.item_ids
    .filter((id) => itemById.has(id))
    .map((id) => itemById.get(id) as ReadingItem);
  const ledeUrl = ledeItems.find((i) => i.url)?.url ?? undefined;

  const emerging = output.emerging.map((e) => {
    const finalTheme = idMap.get(e.theme_id) ?? e.theme_id;
    const theme = themes.find((t) => t.id === finalTheme);
    const backing = e.item_ids.filter((id) => itemById.has(id)).map((id) => itemById.get(id) as ReadingItem);
    if (parked.has(finalTheme)) {
      warnings.push(`emerging entry cites parked theme ${finalTheme}; verify a real new development backs it`);
    }
    return {
      theme_id: finalTheme,
      tag: e.tag,
      title: e.title,
      note: e.note,
      meta: backing.length > 0 ? metaLine(backing, inputs.nowIso) : 'from your sources',
      lane: theme?.lane ?? 'horizon',
      // The items behind this card, so the app can surface its sources (gate:
      // citation-ids-present). Same ids the audit records.
      item_ids: e.item_ids,
    };
  });

  const startHere = output.start_here.map((s) => {
    const item = itemById.get(s.item_id);
    return {
      item_id: s.item_id,
      title: item?.title ?? s.item_id,
      minutes: Math.max(1, Math.min(180, s.minutes ?? estimateMinutes(item?.snippet ?? null))),
      note: s.note,
      url: item?.url ?? undefined,
    };
  });

  const editionDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(inputs.nowIso));

  const edition: EditionInsert = {
    id: randomUUID(),
    edition_no: inputs.maxEditionNo + 1,
    edition_date: editionDate,
    beat: output.beat,
    welcome: output.welcome,
    lede: {
      kicker: output.lede.kicker,
      title: output.lede.title,
      deck: output.lede.deck,
      why: output.lede.why,
      apply_project_id: output.lede.apply_project_id,
      item_ids: output.lede.item_ids,
      ...(ledeUrl ? { url: ledeUrl } : {}),
    },
    emerging,
    start_here: startHere,
    created_at: inputs.nowIso,
  };

  return {
    edition,
    themes,
    links,
    decayed,
    audit: {
      lede: output.lede.item_ids,
      emerging: output.emerging.map((e) => e.item_ids),
      startHere: output.start_here.map((s) => s.item_id),
      themes: themeItems,
    },
    warnings,
  };
}
