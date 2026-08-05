// Central store. Loads everything the cockpit reads, owns the outbox and
// toast plumbing, and runs the one-time legacy-feed migration into context.
// Views never touch the data layer directly; they act through this store.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as db from '../data/dataLayer';
import { SupabaseError } from '../data/supabaseClient';
import { buildDemoData, isDemoMode } from '../lib/demo';
import { fetchFeed } from '../lib/feeds';
import { markLegacyMigrated, migrateLegacySources } from '../lib/migrate';
import { buildSeedEdition } from '../lib/seed';
import type {
  AppContext,
  Edition,
  OutboxItem,
  OutboxKind,
  Position,
  PositionKind,
  Project,
  ReadingItem,
  Sources,
  Theme,
  ThemeLink,
  ViewKey,
} from '../types';
import { EMPTY_SOURCES } from '../types';

export interface AppStore {
  loading: boolean;
  context: AppContext | null;
  edition: Edition | null;
  themes: Theme[];
  themeLinks: ThemeLink[];
  positions: Position[];
  outbox: OutboxItem[];
  readingItems: ReadingItem[];
  readStates: Record<string, boolean>;
  degraded: string[];
  /** Tables whose last read failed at the network level (backend paused or
   * offline), as opposed to degraded (migration not run). */
  unreachable: string[];
  needsOnboarding: boolean;
  view: ViewKey;
  setView: (v: ViewKey) => void;
  /** Theme preselected when jumping from the map to the desk. */
  focusThemeId: string | null;
  setFocusThemeId: (id: string | null) => void;
  toast: string | null;
  say: (msg: string) => void;
  sendToManifold: (
    kind: OutboxKind,
    label: string,
    payload?: Record<string, unknown>,
  ) => Promise<boolean>;
  recordPosition: (p: {
    themeId: string | null;
    kind: PositionKind;
    title: string;
    body: string;
    status: 'draft' | 'published';
  }) => Promise<Position | null>;
  publishPosition: (id: string) => Promise<boolean>;
  saveSources: (sources: Sources, projects?: Project[], orgContext?: string | null) => Promise<boolean>;
  markRead: (itemId: string) => void;
  projectById: (id: string | null | undefined) => Project | undefined;
}

const StoreContext = createContext<AppStore | null>(null);

export function useStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore outside <StoreProvider>');
  return store;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState<AppContext | null>(null);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themeLinks, setThemeLinks] = useState<ThemeLink[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [readingItems, setReadingItems] = useState<ReadingItem[]>([]);
  const [readStates, setReadStates] = useState<Record<string, boolean>>({});
  const [degraded, setDegraded] = useState<string[]>([]);
  const [unreachable, setUnreachable] = useState<string[]>([]);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [view, setView] = useState<ViewKey>('edition');
  const [focusThemeId, setFocusThemeId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootRan = useRef(false);

  const say = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  /** Fetch every enabled feed, upsert into reading_items (best effort), and
   * rebuild the seed edition when manifold has not written one. Fetched
   * articles are kept in memory even when the upsert fails (backend paused
   * or migration missing) so the cockpit still has fresh material. */
  const refreshFeeds = useCallback(async (ctx: AppContext | null) => {
    const feeds = (ctx?.sources.feeds ?? []).filter((f) => f.enabled);
    if (feeds.length === 0) return;
    const fetched: ReadingItem[] = [];
    let anyUpserted = false;
    await Promise.allSettled(
      feeds.map(async (feed) => {
        const articles = await fetchFeed(feed.url);
        const now = new Date().toISOString();
        fetched.push(
          ...articles.map(
            (a): ReadingItem => ({
              id: a.id,
              type: 'article',
              title: a.title,
              url: a.link,
              snippet: a.snippet,
              topics: [],
              read: false,
              addedAt: now,
              sourceFeed: feed.name,
              publishedAt: a.pubDate,
              origin: 'feed',
              imagePreview: null,
            }),
          ),
        );
        try {
          await db.upsertFeedItems(
            articles.map((a) => ({
              id: a.id,
              title: a.title,
              url: a.link,
              snippet: a.snippet,
              sourceFeed: feed.name,
              publishedAt: a.pubDate,
            })),
          );
          anyUpserted = true;
        } catch (err) {
          console.warn('superlearn: feed upsert deferred', err);
        }
      }),
    );
    if (fetched.length > 0) {
      const stored = anyUpserted ? await db.getReadingItems() : [];
      const fresh = stored.length > 0 ? stored : fetched;
      setReadingItems(fresh);
      setEdition((current) => (current === null || current.seed ? buildSeedEdition(fresh) : current));
    }
  }, []);

  useEffect(() => {
    if (bootRan.current) return;
    bootRan.current = true;

    // ?demo renders an in-memory preview of a populated cockpit without
    // touching Supabase (see src/lib/demo.ts).
    if (isDemoMode()) {
      const demo = buildDemoData();
      setContext(demo.context);
      setEdition(demo.edition);
      setThemes(demo.themes);
      setThemeLinks(demo.themeLinks);
      setPositions(demo.positions);
      setLoading(false);
      return;
    }

    (async () => {
      // 1. Context first: it decides onboarding and which feeds to refresh.
      // "Could not read" and "no row" are different states: an unreachable
      // backend must never dump an existing reader into onboarding, where
      // saving would overwrite their real sources once the backend returns.
      let ctx: AppContext | null = null;
      let contextReadable = true;
      try {
        ctx = await db.getContext();
      } catch (err) {
        console.warn('superlearn: context unreachable, staying out of onboarding', err);
        contextReadable = false;
      }

      const hasSources =
        ctx !== null &&
        (ctx.sources.feeds.length > 0 ||
          ctx.sources.blogs.length > 0 ||
          ctx.sources.resources.length > 0);

      if (contextReadable && !hasSources) {
        // One-time migration: legacy user_feeds table and la-feeds-v2
        // localStorage move into context.sources on first load.
        const legacyFeeds = await migrateLegacySources();
        if (legacyFeeds.length > 0) {
          const sources: Sources = { ...EMPTY_SOURCES, feeds: legacyFeeds };
          try {
            await db.saveContext({ sources });
            markLegacyMigrated();
            ctx = await db.getContext();
          } catch (err) {
            console.warn('superlearn: context migration deferred (table missing?)', err);
            // Keep an ephemeral context so the cockpit still works; it will
            // persist once the migration SQL has been applied.
            ctx = {
              id: 'ephemeral',
              tenant: 'default',
              sources,
              projects: [],
              orgContext: null,
              updatedAt: new Date().toISOString(),
            };
          }
        } else {
          // Onboarding only when no context row exists at all. A row with
          // zero sources means the reader chose to continue without them;
          // the cockpit's empty states and the sources panel take it from
          // there instead of a recurring setup gate.
          setNeedsOnboarding(ctx === null);
        }
      }
      setContext(ctx);

      // 2. Everything else in parallel.
      const [ed, th, links, pos, out, items, reads] = await Promise.all([
        db.getLatestEdition(),
        db.getThemes(),
        db.getThemeLinks(),
        db.getPositions(),
        db.getQueuedOutbox(),
        db.getReadingItems(),
        db.getReadStates(),
      ]);

      setThemes(th);
      setThemeLinks(links);
      setPositions(pos);
      setOutbox(out);
      setReadingItems(items);
      setReadStates(reads);
      setEdition(ed ?? (items.length > 0 ? buildSeedEdition(items) : null));
      setDegraded(db.degradedTables());
      setUnreachable(db.unreachableReads());
      setLoading(false);

      // 3. Background feed refresh so manifold always has a fresh corpus.
      await refreshFeeds(ctx);
    })().catch((err) => {
      console.error('superlearn: boot failed', err);
      setLoading(false);
    });
  }, [refreshFeeds]);

  const sendToManifold = useCallback(
    async (kind: OutboxKind, label: string, payload: Record<string, unknown> = {}) => {
      const optimistic: OutboxItem = {
        id: `local-${Math.random().toString(36).slice(2)}`,
        kind,
        label,
        payload,
        status: 'queued',
        createdAt: new Date().toISOString(),
      };
      setOutbox((o) => [optimistic, ...o]);
      if (isDemoMode()) {
        // Demo preview: the queue lives in memory only.
        say(`Sent to manifold · ${kind}`);
        return true;
      }
      try {
        const saved = await db.queueOutbox(kind, label, payload);
        if (saved) {
          setOutbox((o) => o.map((i) => (i.id === optimistic.id ? saved : i)));
        }
        say(`Sent to manifold · ${kind}`);
        return true;
      } catch (err) {
        console.warn('superlearn: outbox write failed', err);
        setOutbox((o) => o.filter((i) => i.id !== optimistic.id));
        setDegraded(db.degradedTables());
        say('manifold queue unreachable · not saved');
        return false;
      }
    },
    [say],
  );

  const recordPosition: AppStore['recordPosition'] = useCallback(
    async (p) => {
      if (isDemoMode()) {
        const local: Position = {
          id: `local-${Math.random().toString(36).slice(2)}`,
          themeId: p.themeId,
          kind: p.kind,
          title: p.title,
          body: p.body,
          status: p.status,
          createdAt: new Date().toISOString(),
          publishedAt: p.status === 'published' ? new Date().toISOString() : null,
        };
        setPositions((prev) => [local, ...prev]);
        return local;
      }
      try {
        const saved = await db.insertPosition(p);
        if (saved) setPositions((prev) => [saved, ...prev]);
        return saved;
      } catch (err) {
        console.warn('superlearn: position write failed', err);
        setDegraded(db.degradedTables());
        say('the desk is unreachable · not saved');
        return null;
      }
    },
    [say],
  );

  const publishPosition = useCallback(
    async (id: string) => {
      try {
        if (!isDemoMode()) await db.publishPosition(id);
        const now = new Date().toISOString();
        setPositions((prev) =>
          prev.map((p) => (p.id === id ? { ...p, status: 'published' as const, publishedAt: now } : p)),
        );
        return true;
      } catch (err) {
        console.warn('superlearn: publish failed', err);
        say('the desk is unreachable · not published');
        return false;
      }
    },
    [say],
  );

  const saveSources: AppStore['saveSources'] = useCallback(
    async (sources, projects, orgContext) => {
      if (isDemoMode()) {
        // Demo preview: nothing touches the real backend.
        setContext({
          id: 'demo',
          tenant: 'default',
          sources,
          projects: projects ?? [],
          orgContext: orgContext ?? null,
          updatedAt: new Date().toISOString(),
        });
        setNeedsOnboarding(false);
        say('demo preview · changes not persisted');
        return true;
      }
      let saved = true;
      let next: AppContext | null = null;
      try {
        await db.saveContext({ sources, projects, orgContext });
        setNeedsOnboarding(false);
        void sendToManifold('sources-updated', 'sources changed in the cockpit', {
          feeds: sources.feeds.length,
          blogs: sources.blogs.length,
          resources: sources.resources.length,
        });
        try {
          next = await db.getContext();
        } catch {
          // Save succeeded but the re-read did not; the ephemeral fallback
          // below mirrors what was just written.
        }
      } catch (err) {
        console.warn('superlearn: context save failed', err);
        saved = false;
        setDegraded(db.degradedTables());
        setNeedsOnboarding(false);
        // The truth, not comfort: nothing was persisted anywhere.
        say(
          err instanceof SupabaseError && err.tableMissing
            ? 'not synced · run the migration to enable saving'
            : 'backend unreachable · sources apply to this session only',
        );
      }
      // Keep working with an ephemeral context when persistence failed.
      const applied: AppContext = next ?? {
        id: 'ephemeral',
        tenant: 'default',
        sources,
        projects: projects ?? [],
        orgContext: orgContext ?? null,
        updatedAt: new Date().toISOString(),
      };
      setContext(applied);
      // New sources should produce fresh material right away.
      void refreshFeeds(applied);
      return saved;
    },
    [say, sendToManifold, refreshFeeds],
  );

  const markRead = useCallback((itemId: string) => {
    setReadStates((prev) => ({ ...prev, [itemId]: true }));
    if (isDemoMode()) return;
    db.setReadState(itemId, true).catch((err) =>
      console.warn('superlearn: read-state write failed', err),
    );
  }, []);

  const projectById = useCallback(
    (id: string | null | undefined) =>
      id ? context?.projects.find((p) => p.id === id) : undefined,
    [context],
  );

  const store = useMemo<AppStore>(
    () => ({
      loading,
      context,
      edition,
      themes,
      themeLinks,
      positions,
      outbox,
      readingItems,
      readStates,
      degraded,
      unreachable,
      needsOnboarding,
      view,
      setView,
      focusThemeId,
      setFocusThemeId,
      toast,
      say,
      sendToManifold,
      recordPosition,
      publishPosition,
      saveSources,
      markRead,
      projectById,
    }),
    [
      loading,
      context,
      edition,
      themes,
      themeLinks,
      positions,
      outbox,
      readingItems,
      readStates,
      degraded,
      unreachable,
      needsOnboarding,
      view,
      focusThemeId,
      toast,
      say,
      sendToManifold,
      recordPosition,
      publishPosition,
      saveSources,
      markRead,
      projectById,
    ],
  );

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
