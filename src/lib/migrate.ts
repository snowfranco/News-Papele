// One-time migration of legacy feed configuration into context.sources.
// Two legacy stores exist: the user_feeds Supabase table and the la-feeds-v2
// localStorage cache. Both are read, merged (deduped by url), and returned
// as FeedSource[] for the store to persist into context.
import { LEGACY_FEEDS_STORAGE } from '../config';
import { getLegacyUserFeeds } from '../data/dataLayer';
import type { FeedSource } from '../types';

/** Device-local tombstone set once the migrated sources have actually been
 * persisted to context, so the migration can never re-run and overwrite a
 * deliberately emptied context row. */
const MIGRATED_FLAG = 'superlearn-legacy-migrated';

export function markLegacyMigrated(): void {
  try {
    localStorage.setItem(MIGRATED_FLAG, new Date().toISOString());
  } catch {
    // Storage unavailable: the worst case is a redundant re-merge next boot.
  }
}

function legacyAlreadyMigrated(): boolean {
  try {
    return localStorage.getItem(MIGRATED_FLAG) !== null;
  } catch {
    return false;
  }
}

function readLocalFeeds(): FeedSource[] {
  try {
    const raw = localStorage.getItem(LEGACY_FEEDS_STORAGE);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (f): f is { id?: string; name: string; url: string; color?: string; enabled?: boolean } =>
          typeof f === 'object' && f !== null && typeof (f as { url?: unknown }).url === 'string' &&
          typeof (f as { name?: unknown }).name === 'string',
      )
      .map((f, i) => ({
        id: f.id ?? `local-${i}`,
        name: f.name,
        url: f.url,
        color: f.color,
        enabled: f.enabled ?? true,
      }));
  } catch {
    return [];
  }
}

/** Merge legacy Supabase feeds and localStorage feeds, Supabase first,
 * deduped by normalised url. Returns nothing once the migration has been
 * marked complete on this device. */
export async function migrateLegacySources(): Promise<FeedSource[]> {
  if (legacyAlreadyMigrated()) return [];
  const [remote, local] = [await getLegacyUserFeeds(), readLocalFeeds()];
  const seen = new Set<string>();
  const merged: FeedSource[] = [];
  for (const feed of [...remote, ...local]) {
    const key = feed.url.trim().replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(feed);
  }
  return merged;
}
