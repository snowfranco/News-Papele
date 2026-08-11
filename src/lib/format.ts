// Small presentation helpers shared across views.

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "tue · aug 4" style masthead date. */
export function mastheadDate(d: Date = new Date()): string {
  return `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Full masthead meta line: "tue · aug 4 · edition 12 · pm beat". Parts that
 * are unknown are simply omitted; nothing is counted or apologised for. */
export function mastheadMeta(editionNo: number | null, beat: string | null, d?: Date): string {
  const parts = [mastheadDate(d)];
  if (editionNo != null) parts.push(`edition ${editionNo}`);
  if (beat) parts.push(beat);
  return parts.join(' · ');
}

/** Rough reading time from snippet length; used only for seed editions where
 * manifold has not estimated one. */
export function estimateMinutes(text: string | null): number {
  if (!text) return 8;
  const words = text.split(/\s+/).length;
  // Feed snippets are truncated; scale up as a proxy for full articles.
  return Math.max(4, Math.min(20, Math.round((words * 6) / 220)));
}

/** "jul 28" style short date for published columns. */
export function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Deterministic id for feed articles so upserts dedupe across refreshes. */
export function stableItemId(link: string): string {
  let hash = 5381;
  for (let i = 0; i < link.length; i++) {
    hash = (hash * 33) ^ link.charCodeAt(i);
  }
  return `feed-${(hash >>> 0).toString(36)}`;
}

/** Discipline colors for the theme map. Known disciplines keep the
 * broadsheet palette; unknown ones get a stable assignment from it. */
const DISCIPLINE_COLORS: Record<string, string> = {
  craft: '#0e9e90',
  'ai craft': '#0e9e90',
  strategy: '#2547f0',
  gtm: '#e39400',
  'go-to-market': '#e39400',
  general: '#33302a',
};

const PALETTE = ['#0e9e90', '#2547f0', '#e39400', '#7a3ff0', '#e0356b'];

export function disciplineColor(discipline: string): string {
  const key = discipline.toLowerCase();
  const known = DISCIPLINE_COLORS[key];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length] as string;
}

/** Strip HTML tags from feed descriptions. */
export function stripHtml(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}
