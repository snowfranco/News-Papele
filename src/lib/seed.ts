// Seed states: what the cockpit shows before manifold has written anything.
// A seed edition is built client-side from the freshest feed items so the
// end-to-end experience works from day one. Principles enforced here:
// welcome copy never counts a backlog, at least one emerging card is a
// horizon item tied to no project, and nothing here filters by project.
import type { Edition, ReadingItem } from '../types';
import { estimateMinutes } from './format';

function newestFirst(items: ReadingItem[]): ReadingItem[] {
  return [...items].sort((a, b) => {
    const ta = Date.parse(b.publishedAt ?? b.addedAt) || 0;
    const tb = Date.parse(a.publishedAt ?? a.addedAt) || 0;
    return ta - tb;
  });
}

/** Group recent items by source and pick the source with the freshest
 * cluster, so the seed lede reflects where signal is right now. */
function pickLede(items: ReadingItem[]): ReadingItem | null {
  return newestFirst(items)[0] ?? null;
}

export function buildSeedEdition(items: ReadingItem[], welcomeName?: string): Edition {
  const now = new Date();
  const fresh = newestFirst(items).slice(0, 24);
  const lede = pickLede(fresh);

  const bySource = new Map<string, ReadingItem[]>();
  for (const item of fresh) {
    const key = item.sourceFeed ?? 'your sources';
    const list = bySource.get(key) ?? [];
    list.push(item);
    bySource.set(key, list);
  }

  const emergingSources = [...bySource.entries()]
    .filter(([, list]) => list[0]?.id !== lede?.id)
    .slice(0, 2);

  const startHere = fresh
    .filter((i) => i.id !== lede?.id && i.url)
    .slice(0, 3)
    .map((i) => ({
      itemId: i.id,
      title: i.title,
      minutes: estimateMinutes(i.snippet),
      note: i.sourceFeed ? `fresh from ${i.sourceFeed}.` : 'fresh from your sources.',
      url: i.url ?? undefined,
    }));

  const hello = welcomeName ? `Welcome back, ${welcomeName}.` : 'Welcome back.';

  return {
    id: 'seed',
    editionNo: null,
    editionDate: now.toISOString().slice(0, 10),
    beat: null,
    welcome:
      items.length > 0
        ? `${hello} manifold has not written your first edition yet, so here is a plain look at what is fresh across your sources. No pile, no pressure.`
        : `${hello} Superlearn is ready. Add your sources and manifold will start preparing editions for you.`,
    lede: lede
      ? {
          kicker: `seed edition · ${lede.sourceFeed ?? 'your sources'}`,
          title: lede.title,
          deck: lede.snippet ?? '',
          why: 'This is simply the freshest piece across your sources. Once manifold runs, the lede will be chosen for signal and rationale, not recency.',
          applyProjectId: null,
          itemIds: [lede.id],
          url: lede.url ?? undefined,
        }
      : null,
    emerging: emergingSources.map(([source, list], i) => ({
      themeId: null,
      tag: i === 0 ? 'horizon' : 'from your sources',
      title: list[0]?.title ?? source,
      note: `What ${source} has been publishing lately.`,
      meta: source,
      lane: 'horizon',
      // The seed card cites the source's own fresh items, so its citation
      // marker is live even before manifold has written an edition.
      itemIds: list.slice(0, 3).map((it) => it.id),
    })),
    startHere,
    createdAt: now.toISOString(),
    seed: true,
  };
}
