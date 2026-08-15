// Deterministic heat. Heat is never model-chosen: it is recomputed each run
// from recency and cross-source corroboration of the items backing a theme,
// so the map cannot be talked into a hype spike by one loud source.
//
//   fresh(theme)  = sum over backing items of exp(-ageDays / 7)
//   corrob(theme) = 1 + 0.2 * min(distinctSources - 1, 4)
//   raw           = fresh * corrob
//   heat          = clamp(raw / max raw across themes this run, 0.05, 1)
//
// A carried theme with no new backing items this run decays instead:
//   heat = max(0.05, oldHeat * exp(-daysSinceUpdate / 14))
import type { ReadingItem } from './app-contract.ts';

const DAY_MS = 86_400_000;

function ageDays(item: ReadingItem, now: number): number {
  const ts = Date.parse(item.publishedAt ?? item.addedAt);
  if (Number.isNaN(ts)) return 30;
  return Math.max(0, (now - ts) / DAY_MS);
}

export function rawHeat(items: ReadingItem[], nowIso: string): number {
  const now = Date.parse(nowIso);
  const fresh = items.reduce((sum, item) => sum + Math.exp(-ageDays(item, now) / 7), 0);
  const sources = new Set(items.map((i) => i.sourceFeed ?? 'unknown')).size;
  const corrob = 1 + 0.2 * Math.min(Math.max(sources - 1, 0), 4);
  return fresh * corrob;
}

export function normalizeHeat(raw: number, maxRaw: number): number {
  if (maxRaw <= 0) return 0.05;
  return Math.round(Math.min(1, Math.max(0.05, raw / maxRaw)) * 100) / 100;
}

export function decayHeat(oldHeat: number, updatedAtIso: string, nowIso: string): number {
  const updated = Date.parse(updatedAtIso);
  const now = Date.parse(nowIso);
  const days = Number.isNaN(updated) ? 30 : Math.max(0, (now - updated) / DAY_MS);
  return Math.round(Math.max(0.05, oldHeat * Math.exp(-days / 14)) * 100) / 100;
}
