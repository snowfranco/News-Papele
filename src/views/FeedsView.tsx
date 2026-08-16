// The Feeds tab: the workshop bench. Raw items from every source, strictly
// chronological (newest first), no editorial framing. A read/unread pill per
// row and per-source item counts are inventory, never pressure — no unread
// counters anywhere. One surface: menus and inline panels only, no modals.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { mastheadDate } from '../lib/format';
import { useStore } from '../state/AppStore';
import type { ReadingItem, Theme } from '../types';

type ReadFilter = 'all' | 'unread' | 'read';

/** Best timestamp for a row: publishedAt when parseable, else addedAt. */
function itemDate(item: ReadingItem): Date | null {
  for (const raw of [item.publishedAt, item.addedAt]) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Day-group label: "Today", "Yesterday", then "mon · aug 3". */
function dayLabel(d: Date | null, now: Date): string {
  if (!d) return 'undated';
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return mastheadDate(d);
}

export function FeedsView() {
  const {
    readingItems,
    readStates,
    themes,
    context,
    sendToManifold,
    setRead,
    refreshSources,
    refreshing,
    lastRefresh,
    focusItemId,
    setFocusItemId,
  } = useStore();

  // Local, unpersisted view state only.
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuMode, setMenuMode] = useState<'list' | 'new'>('list');
  const [newTheme, setNewTheme] = useState('');
  // Deep-link focus (?item= / "Open in Feeds"): scroll a row into view and
  // flash it briefly, once.
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const feeds = useMemo(() => context?.sources.feeds ?? [], [context]);

  const selectedFeed = useMemo(
    () => feeds.find((f) => f.id === selectedFeedId) ?? null,
    [feeds, selectedFeedId],
  );

  const countBySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of readingItems) {
      if (item.sourceFeed) counts.set(item.sourceFeed, (counts.get(item.sourceFeed) ?? 0) + 1);
    }
    return counts;
  }, [readingItems]);

  const sourceItems = useMemo(
    () =>
      selectedFeed ? readingItems.filter((i) => i.sourceFeed === selectedFeed.name) : readingItems,
    [readingItems, selectedFeed],
  );

  const isRead = (item: ReadingItem): boolean => readStates[item.id] ?? item.read;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sourceItems.filter((item) => {
      if (q) {
        const inTitle = item.title.toLowerCase().includes(q);
        const inSource = (item.sourceFeed ?? '').toLowerCase().includes(q);
        if (!inTitle && !inSource) return false;
      }
      if (readFilter === 'all') return true;
      const read = readStates[item.id] ?? item.read;
      return readFilter === 'read' ? read : !read;
    });
  }, [sourceItems, search, readFilter, readStates]);

  const groups = useMemo(() => {
    const rows = visible.map((item) => ({ item, date: itemDate(item) }));
    rows.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
    const now = new Date();
    const out: { label: string; rows: typeof rows }[] = [];
    for (const row of rows) {
      const label = dayLabel(row.date, now);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(row);
      else out.push({ label, rows: [row] });
    }
    return out;
  }, [visible]);

  // Honor a Feeds deep link (focusItemId, set by "Open in Feeds" or ?item=):
  // scroll the row into view and flash it. If the item is filtered out, relax
  // the view so it can render; this effect then re-runs when groups change.
  useEffect(() => {
    if (!focusItemId) return;
    const el = rowRefs.current.get(focusItemId);
    if (!el) {
      setSelectedFeedId(null);
      setReadFilter('all');
      setSearch('');
      return;
    }
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    el.focus();
    setHighlightId(focusItemId);
    setFocusItemId(null);
    const t = setTimeout(() => setHighlightId(null), 2200);
    return () => clearTimeout(t);
  }, [focusItemId, groups, setFocusItemId]);

  const closeMenu = () => {
    setMenuFor(null);
    setMenuMode('list');
    setNewTheme('');
  };

  const toggleMenu = (itemId: string) => {
    if (menuFor === itemId) {
      closeMenu();
      return;
    }
    // Only one menu open at a time; with no themes charted yet the menu
    // opens directly on the new-theme input.
    setMenuFor(itemId);
    setMenuMode(themes.length > 0 ? 'list' : 'new');
    setNewTheme('');
  };

  const park = (item: ReadingItem) => {
    void sendToManifold('park', item.title, {
      itemId: item.id,
      source: item.sourceFeed,
      title: item.title,
      url: item.url,
    });
  };

  const assignExisting = (item: ReadingItem, theme: Theme) => {
    void sendToManifold('assign-to-theme', `${item.title} → ${theme.label}`, {
      itemId: item.id,
      themeId: theme.id,
    });
    closeMenu();
  };

  // The app never creates themes: a new label goes through the outbox and
  // manifold reconciles it into a charted theme.
  const assignNew = (item: ReadingItem) => {
    const label = newTheme.trim();
    if (!label) return;
    void sendToManifold('assign-to-theme', `${item.title} → ${label}`, {
      itemId: item.id,
      newThemeLabel: label,
    });
    closeMenu();
  };

  const onRowKey = (e: KeyboardEvent<HTMLDivElement>, item: ReadingItem) => {
    const target = e.target as HTMLElement;
    // The search box and the new-theme input must type freely.
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if (e.key === 'Enter') {
      // Only when the row container itself is focused; inner anchors and
      // buttons keep their native Enter behavior.
      if (e.target === e.currentTarget && item.url) {
        window.open(item.url, '_blank', 'noopener');
      }
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      setRead(item.id, !isRead(item));
    } else if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      park(item);
    } else if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      toggleMenu(item.id);
    } else if (e.key === 'Escape' && menuFor === item.id) {
      closeMenu();
    }
  };

  const railStamp = (feedId: string): string => {
    const iso = lastRefresh[feedId];
    if (!iso) return 'no items yet';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? 'no items yet' : `refreshed ${hhmm(d)}`;
  };

  if (feeds.length === 0) {
    return (
      <div>
        <div className="sp-kicker">feeds · every source, newest first</div>
        <div className="sp-empty">
          <h3>No sources yet</h3>
          <p>
            The feeds bench shows raw items from the sources you choose, one row per article,
            newest first. Add your first feed from the sources chip in the nav above and its
            items will land here as they arrive.
          </p>
        </div>
      </div>
    );
  }

  if (readingItems.length === 0) {
    return (
      <div>
        <div className="sp-kicker">feeds · every source, newest first</div>
        <div className="sp-empty">
          <h3>Nothing on the bench yet</h3>
          <p>
            Items arrive when your feeds refresh. Refresh now, or let the next pass gather them —
            nothing piles up in the meantime.
          </p>
          <button className="sp-btn" onClick={() => void refreshSources()} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh feeds'}
          </button>
        </div>
      </div>
    );
  }

  const refreshIso = lastRefresh[selectedFeed?.id ?? 'all'];
  const refreshDate = refreshIso ? new Date(refreshIso) : null;
  const refreshLabel =
    refreshDate && !Number.isNaN(refreshDate.getTime())
      ? `refreshed ${hhmm(refreshDate)}`
      : 'not yet refreshed';

  return (
    <div>
      <div className="sp-kicker">feeds · every source, newest first</div>
      <div className="sp-fdgrid">
        <nav className="sp-fdrail" aria-label="sources">
          <button
            className={selectedFeed === null ? 'sp-fdrailitem on' : 'sp-fdrailitem'}
            onClick={() => setSelectedFeedId(null)}
          >
            <span className="sp-fdname">All sources</span>
            <span className="sp-fdcount">{readingItems.length}</span>
          </button>
          {feeds.map((feed) => {
            const count = countBySource.get(feed.name) ?? 0;
            const cls = [
              'sp-fdrailitem',
              selectedFeed?.id === feed.id ? 'on' : '',
              feed.enabled ? '' : 'off',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button key={feed.id} className={cls} onClick={() => setSelectedFeedId(feed.id)}>
                <span
                  className="sp-fdchip"
                  style={{ background: feed.color ?? 'var(--muted)' }}
                  aria-hidden="true"
                />
                <span className="sp-fdname">{feed.name}</span>
                {!feed.enabled && <span className="sp-fdoff">off</span>}
                <span className="sp-fdcount">{count}</span>
                {count === 0 && <span className="sp-fdsub">{railStamp(feed.id)}</span>}
              </button>
            );
          })}
        </nav>

        <div>
          <div className="sp-fdctl">
            <input
              className="sp-input"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search title or source"
              aria-label="search loaded items by title or source"
            />
            <div className="sp-seg sp-fdseg" role="group" aria-label="read filter">
              {(
                [
                  ['all', 'all'],
                  ['unread', 'unread only'],
                  ['read', 'read only'],
                ] as [ReadFilter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={readFilter === key ? 'on' : ''}
                  onClick={() => setReadFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className="sp-mini"
              onClick={() => void refreshSources(selectedFeed?.id)}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <span className="sp-fdstamp">{refreshLabel}</span>
          </div>

          {selectedFeed && sourceItems.length === 0 && (
            <div className="sp-fdnone">
              <span>nothing loaded from {selectedFeed.name} yet</span>
              <button
                className="sp-mini"
                onClick={() => void refreshSources(selectedFeed.id)}
                disabled={refreshing}
              >
                Refresh
              </button>
            </div>
          )}

          {sourceItems.length > 0 && visible.length === 0 && (
            <div className="sp-fdnone">nothing matches the current search and filter</div>
          )}

          {groups.map((group) => (
            <section key={group.label}>
              <div className="sp-fdday">{group.label}</div>
              {group.rows.map(({ item, date }) => {
                const read = isRead(item);
                const meta = [item.sourceFeed ?? item.origin, date ? hhmm(date) : '']
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <div
                    key={item.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(item.id, el);
                      else rowRefs.current.delete(item.id);
                    }}
                    className={`sp-fdrow${read ? ' read' : ''}${highlightId === item.id ? ' flash' : ''}`}
                    tabIndex={0}
                    role="article"
                    aria-label={item.title}
                    onKeyDown={(e) => onRowKey(e, item)}
                  >
                    <div className="sp-fdmain">
                      {item.url ? (
                        <a
                          className="sp-fdtitle"
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {item.title}
                        </a>
                      ) : (
                        <span className="sp-fdtitle">{item.title}</span>
                      )}
                      <div className="sp-fdmeta">{meta}</div>
                      {item.snippet && <p className="sp-fdsnip">{item.snippet}</p>}
                    </div>
                    <div className="sp-fdacts">
                      <button
                        className={read ? 'sp-fdpill read' : 'sp-fdpill'}
                        aria-pressed={read}
                        onClick={() => setRead(item.id, !read)}
                      >
                        {read ? 'read' : 'unread'}
                      </button>
                      <button className="sp-mini" onClick={() => park(item)}>
                        Park
                      </button>
                      <button
                        className="sp-mini"
                        aria-expanded={menuFor === item.id}
                        onClick={() => toggleMenu(item.id)}
                      >
                        Theme
                      </button>
                    </div>
                    {menuFor === item.id && (
                      <div
                        className="sp-fdmenu"
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.stopPropagation();
                            closeMenu();
                          }
                        }}
                        onBlur={(e) => {
                          // Close when focus leaves the menu entirely.
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                            closeMenu();
                          }
                        }}
                      >
                        {menuMode === 'list' ? (
                          <>
                            {themes.map((t) => (
                              <button
                                key={t.id}
                                className="sp-fdmenuitem"
                                onClick={() => assignExisting(item, t)}
                              >
                                {t.label}
                              </button>
                            ))}
                            <button
                              className="sp-fdmenuitem new"
                              onClick={() => setMenuMode('new')}
                            >
                              New theme…
                            </button>
                          </>
                        ) : (
                          <div className="sp-fdnew">
                            {themes.length === 0 && (
                              <p className="sp-fdquiet">
                                manifold has not charted themes yet · name one
                              </p>
                            )}
                            <input
                              className="sp-input"
                              type="text"
                              value={newTheme}
                              onChange={(e) => setNewTheme(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  assignNew(item);
                                }
                              }}
                              placeholder="name the theme"
                              aria-label={`new theme for ${item.title}`}
                              autoFocus
                            />
                            <button
                              className="sp-mini"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => assignNew(item)}
                            >
                              Send
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
