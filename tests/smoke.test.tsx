// Phase 1 smoke test: boots the whole cockpit against a mocked data layer
// and walks the skeleton end to end — masthead, edition, theme map, position
// desk, command bar, outbox. Per-view suites arrive in Phase 2.
import { StrictMode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { StoreProvider } from '../src/state/AppStore';
import * as db from '../src/data/dataLayer';
import type {
  AppContext,
  Edition,
  OutboxItem,
  OutboxKind,
  Position,
  ReadingItem,
  Theme,
  ThemeLink,
} from '../src/types';

// Fixtures live in vi.hoisted so the vi.mock factories (hoisted above the
// imports) can reference them. Type annotations are erased at runtime, so
// the hoisting is safe.
const fx = vi.hoisted(() => {
  const context: AppContext = {
    id: 'ctx-1',
    tenant: 'default',
    sources: {
      feeds: [
        { id: 'f1', name: 'signal review', url: 'https://example.com/feeds/signal.xml', enabled: true },
        { id: 'f2', name: 'systems weekly', url: 'https://example.com/feeds/systems.xml', enabled: true },
      ],
      blogs: [],
      resources: [],
    },
    projects: [{ id: 'frameshift', label: 'frameshift' }],
    orgContext: null,
    updatedAt: '2026-08-04T08:00:00.000Z',
  };

  const edition: Edition = {
    id: 'ed-12',
    editionNo: 12,
    editionDate: '2026-08-04',
    beat: 'am beat',
    welcome: 'Welcome back. The morning is set out for you; settle in wherever you like.',
    lede: {
      kicker: "today's lede · ai craft",
      title: 'Context engineering is quietly becoming the whole job',
      deck: 'Three of your sources converged on the same idea this week.',
      why: 'It sits directly under the retrieval work you have been circling.',
      applyProjectId: 'frameshift',
      itemIds: ['i1'],
      url: 'https://example.com/a',
    },
    emerging: [
      {
        themeId: null,
        tag: 'quiet build-up',
        title: 'Small models are getting good at tool use',
        note: 'A steady current with no project attached; pure curiosity.',
        meta: 'seen across two sources',
        lane: 'horizon',
        itemIds: ['i3'],
      },
      {
        themeId: 'th-progress',
        tag: 'applied',
        title: 'Evals as a design instrument',
        note: 'Keeps surfacing next to your build notes.',
        meta: 'feeds frameshift',
        lane: 'applied',
        itemIds: [],
      },
    ],
    startHere: [
      {
        itemId: 'i1',
        title: 'A field guide to context windows',
        minutes: 9,
        note: 'the lede, up close.',
        url: 'https://example.com/a',
      },
      {
        itemId: null,
        title: 'Why agents forget',
        minutes: 12,
        note: 'a slower companion read.',
        url: 'https://example.com/b',
      },
    ],
    createdAt: '2026-08-04T07:00:00.000Z',
  };

  const themes: Theme[] = [
    {
      id: 'th-position',
      label: 'context engineering',
      discipline: 'ai craft',
      lane: 'applied',
      heat: 0.9,
      mastery: 'position',
      why: 'you have already written a column here.',
      reads: 7,
      itemIds: ['i1'],
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    },
    {
      id: 'th-progress',
      label: 'evals as design',
      discipline: 'craft',
      lane: 'applied',
      heat: 0.6,
      mastery: 'progress',
      why: 'mid-thread; the argument is still forming.',
      reads: 3,
      itemIds: ['i2'],
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    },
    {
      // Horizon guarantee: first-class, no project links anywhere.
      id: 'th-horizon',
      label: 'small models',
      discipline: 'strategy',
      lane: 'horizon',
      heat: 0.4,
      mastery: 'unread',
      why: 'a new current worth watching.',
      reads: 0,
      itemIds: ['i3'],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    },
  ];

  const themeLinks: ThemeLink[] = [
    { id: 'l1', sourceId: 'th-position', targetId: 'th-progress', kind: 'relate' },
    { id: 'l2', sourceId: 'th-position', targetId: 'frameshift', kind: 'project' },
  ];

  const positions: Position[] = [
    {
      id: 'pos-1',
      themeId: 'th-position',
      kind: 'column',
      title: 'Context is the product now',
      body: 'The window is the workbench; everything else is staging.',
      status: 'published',
      createdAt: '2026-07-28T09:00:00.000Z',
      publishedAt: '2026-07-28T09:00:00.000Z',
    },
    {
      id: 'pos-2',
      themeId: 'th-progress',
      kind: 'column',
      title: 'Evals are a design instrument',
      body: 'A half-formed argument about feedback loops.',
      status: 'draft',
      createdAt: '2026-08-01T09:00:00.000Z',
      publishedAt: null,
    },
  ];

  // Feed fixtures: two day groups (one item now, two 26 hours ago) across
  // the two context feeds, so the Feeds tab renders a rail, counts, and
  // date group headers. i3 arrives read via the read-states fixture.
  const NOW_ISO = new Date().toISOString();
  const DAY_AGO_ISO = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();

  const readingItems: ReadingItem[] = [
    {
      id: 'i1',
      type: 'article',
      title: 'A field guide to context windows',
      url: 'https://example.com/a',
      snippet: 'How context budgets shape agent design.',
      topics: ['ai craft'],
      read: false,
      addedAt: NOW_ISO,
      sourceFeed: 'signal review',
      publishedAt: NOW_ISO,
      origin: 'feed',
      imagePreview: null,
    },
    {
      id: 'i2',
      type: 'article',
      title: 'Latency budgets for retrieval pipelines',
      url: 'https://example.com/c',
      snippet: 'Where the milliseconds actually go.',
      topics: ['craft'],
      read: false,
      addedAt: DAY_AGO_ISO,
      sourceFeed: 'signal review',
      publishedAt: DAY_AGO_ISO,
      origin: 'feed',
      imagePreview: null,
    },
    {
      id: 'i3',
      type: 'article',
      title: 'The quiet rise of on-device inference',
      url: 'https://example.com/d',
      snippet: 'Small models moving onto the edge.',
      topics: ['strategy'],
      read: false,
      addedAt: DAY_AGO_ISO,
      sourceFeed: 'systems weekly',
      publishedAt: DAY_AGO_ISO,
      origin: 'feed',
      imagePreview: null,
    },
  ];

  const readStates: Record<string, boolean> = { i3: true };

  return { context, edition, themes, themeLinks, positions, readingItems, readStates };
});

vi.mock('../src/data/dataLayer', () => ({
  getContext: vi.fn(async () => fx.context),
  saveContext: vi.fn(async () => undefined),
  getLatestEdition: vi.fn(async () => fx.edition),
  getThemes: vi.fn(async () => fx.themes),
  getThemeLinks: vi.fn(async () => fx.themeLinks),
  getPositions: vi.fn(async () => fx.positions),
  getQueuedOutbox: vi.fn(async (): Promise<OutboxItem[]> => []),
  queueOutbox: vi.fn(
    async (
      kind: OutboxKind,
      label: string,
      payload?: Record<string, unknown>,
    ): Promise<OutboxItem> => ({
      id: 'ob-' + Math.random().toString(36).slice(2),
      kind,
      label,
      payload: payload ?? {},
      status: 'queued',
      createdAt: new Date().toISOString(),
    }),
  ),
  getReadingItems: vi.fn(async () => fx.readingItems),
  upsertFeedItems: vi.fn(async () => undefined),
  getReadStates: vi.fn(async (): Promise<Record<string, boolean>> => fx.readStates),
  setReadState: vi.fn(async () => undefined),
  getLegacyUserFeeds: vi.fn(async () => []),
  insertPosition: vi.fn(
    async (p: db.NewPosition): Promise<Position> => ({
      id: 'pos-' + Math.random().toString(36).slice(2),
      themeId: p.themeId,
      kind: p.kind,
      title: p.title,
      body: p.body,
      status: p.status,
      createdAt: new Date().toISOString(),
      publishedAt: p.status === 'published' ? new Date().toISOString() : null,
    }),
  ),
  publishPosition: vi.fn(async () => undefined),
  degradedTables: vi.fn((): string[] => []),
  unreachableReads: vi.fn((): string[] => []),
}));

// No network in tests: feed refresh resolves empty, probes succeed.
vi.mock('../src/lib/feeds', () => ({
  fetchFeed: vi.fn(async () => []),
  validateFeedUrl: vi.fn(async () => true),
}));

const LEDE_TITLE = 'Context engineering is quietly becoming the whole job';

// The store now writes ?view=… to the URL on every tab switch
// (deep-link support) and tests in this file share one happy-dom window,
// so each test must boot from a clean URL or it inherits the previous
// test's view.
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

function renderApp() {
  render(
    <StrictMode>
      <StoreProvider>
        <App />
      </StoreProvider>
    </StrictMode>,
  );
}

describe('superlearn cockpit smoke', () => {
  it('opens on the edition: masthead, lede, apply lens, horizon card', async () => {
    renderApp();

    // Boot settles once the lede title is on screen.
    expect(await screen.findByText(LEDE_TITLE)).toBeInTheDocument();

    expect(screen.getByText('the superlearn dispatch')).toBeInTheDocument();
    expect(screen.getByText(/edition 12/)).toBeInTheDocument();

    expect(screen.getByText(/settle in wherever you like/)).toBeInTheDocument();

    // The apply lens is an enrichment tag, and tapping it reveals the action.
    const lens = screen.getByRole('button', { name: /apply to → frameshift/ });
    await userEvent.click(lens);
    expect(
      await screen.findByRole('button', { name: /send to frameshift context/i }),
    ).toBeInTheDocument();

    // Horizon guarantee: at least one emerging card is tagged horizon.
    expect(document.querySelector('.sp-etag.horizon')).not.toBeNull();
  });

  it('switches between edition, theme map, and position desk', async () => {
    renderApp();
    await screen.findByText(LEDE_TITLE);

    await userEvent.click(screen.getByRole('tab', { name: 'Theme map' }));
    expect((await screen.findAllByText(/position formed/)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Tap a star to focus it/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Position desk' }));
    expect(
      await screen.findByText(/position desk · prove you understood it/),
    ).toBeInTheDocument();
    expect((await screen.findAllByText('Context is the product now')).length).toBeGreaterThan(0);
  });

  it('queues a command-bar note to manifold and shows it in the outbox', async () => {
    renderApp();
    await screen.findByText(LEDE_TITLE);

    const input = screen.getByPlaceholderText(/^Tell manifold/);
    await userEvent.type(input, 'hello manifold');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(db.queueOutbox).toHaveBeenCalledWith('note', 'hello manifold', expect.anything());

    const chip = await screen.findByText(/manifold · 1 queued/);
    await userEvent.click(chip);
    expect(await screen.findByText(/hello manifold/)).toBeInTheDocument();
  });

  it('never shames the backlog and never shows the retired product name', async () => {
    renderApp();
    await screen.findByText(LEDE_TITLE);

    const seen: string[] = [document.body.textContent ?? ''];

    await userEvent.click(screen.getByRole('tab', { name: 'Theme map' }));
    await screen.findByText(/Tap a star to focus it/);
    seen.push(document.body.textContent ?? '');

    await userEvent.click(screen.getByRole('tab', { name: 'Position desk' }));
    await screen.findByText(/position desk · prove you understood it/);
    seen.push(document.body.textContent ?? '');

    const everything = seen.join('\n');
    // Assembled from parts so this guard never trips a repo-wide search
    // for the old product name.
    expect(everything).not.toMatch(new RegExp(['pa', 'pele'].join(''), 'i'));
    expect(everything).not.toMatch(/\d+\s+unread/i);
  });
});

// ---------------------------------------------------------------- feeds tab

const ROW_TODAY = 'A field guide to context windows'; // i1 · signal review · now
const ROW_OLDER = 'Latency budgets for retrieval pipelines'; // i2 · signal review · 26h ago
const ROW_OTHER = 'The quiet rise of on-device inference'; // i3 · systems weekly · 26h ago · read

describe('feeds bench', () => {
  /** Boot the cockpit, then walk to the Feeds tab and wait for the rail. */
  async function openFeeds() {
    renderApp();
    await screen.findByText(LEDE_TITLE);
    await userEvent.click(screen.getByRole('tab', { name: 'Feeds' }));
    await screen.findByRole('navigation', { name: 'sources' });
  }

  function rail() {
    return within(screen.getByRole('navigation', { name: 'sources' }));
  }

  it('shows the source rail with counts and day group headers', async () => {
    await openFeeds();

    // "All sources" plus one entry per configured feed, each with its
    // inventory count (counts are inventory, never pressure).
    const allBtn = rail().getByRole('button', { name: /All sources/ });
    expect(within(allBtn).getByText('3')).toBeInTheDocument();
    const signalBtn = rail().getByRole('button', { name: /signal review/ });
    expect(within(signalBtn).getByText('2')).toBeInTheDocument();
    const systemsBtn = rail().getByRole('button', { name: /systems weekly/ });
    expect(within(systemsBtn).getByText('1')).toBeInTheDocument();

    // Chronological bench: the fixture spans two day groups.
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(document.querySelectorAll('.sp-fdday').length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByRole('article', { name: ROW_TODAY })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: ROW_OTHER })).toBeInTheDocument();
  });

  it('filters rows by source and restores on "All sources"', async () => {
    await openFeeds();

    await userEvent.click(rail().getByRole('button', { name: /systems weekly/ }));
    expect(await screen.findByRole('article', { name: ROW_OTHER })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: ROW_TODAY })).not.toBeInTheDocument();
    expect(screen.queryByRole('article', { name: ROW_OLDER })).not.toBeInTheDocument();

    await userEvent.click(rail().getByRole('button', { name: /All sources/ }));
    expect(await screen.findByRole('article', { name: ROW_TODAY })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: ROW_OTHER })).toBeInTheDocument();
  });

  it('round-trips the read pill through setReadState', async () => {
    await openFeeds();

    // i3 arrives already read via the read-states fixture.
    const readRow = screen.getByRole('article', { name: ROW_OTHER });
    expect(within(readRow).getByRole('button', { name: 'read' })).toBeInTheDocument();

    const row = screen.getByRole('article', { name: ROW_TODAY });
    await userEvent.click(within(row).getByRole('button', { name: 'unread' }));
    expect(db.setReadState).toHaveBeenCalledWith('i1', true);
    // The optimistic flip shows immediately.
    expect(within(row).getByRole('button', { name: 'read' })).toBeInTheDocument();
  });

  it('parks an item to manifold with the full item payload', async () => {
    await openFeeds();

    const row = screen.getByRole('article', { name: ROW_TODAY });
    await userEvent.click(within(row).getByRole('button', { name: 'Park' }));
    expect(db.queueOutbox).toHaveBeenCalledWith('park', ROW_TODAY, {
      itemId: 'i1',
      source: 'signal review',
      title: ROW_TODAY,
      url: 'https://example.com/a',
    });
  });

  it('assigns an item to an existing theme and to a new one via the outbox', async () => {
    await openFeeds();

    // Existing theme: the menu lists every charted theme label.
    const row = screen.getByRole('article', { name: ROW_TODAY });
    await userEvent.click(within(row).getByRole('button', { name: 'Theme' }));
    expect(within(row).getByRole('button', { name: 'context engineering' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'evals as design' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'small models' })).toBeInTheDocument();

    await userEvent.click(within(row).getByRole('button', { name: 'evals as design' }));
    expect(db.queueOutbox).toHaveBeenCalledWith(
      'assign-to-theme',
      `${ROW_TODAY} → evals as design`,
      { itemId: 'i1', themeId: 'th-progress' },
    );

    // New theme: the app never creates it; the label rides the outbox and
    // manifold reconciles.
    const other = screen.getByRole('article', { name: ROW_OLDER });
    await userEvent.click(within(other).getByRole('button', { name: 'Theme' }));
    await userEvent.click(within(other).getByRole('button', { name: 'New theme…' }));
    await userEvent.type(
      within(other).getByLabelText(`new theme for ${ROW_OLDER}`),
      'agent memory',
    );
    await userEvent.click(within(other).getByRole('button', { name: 'Send' }));
    expect(db.queueOutbox).toHaveBeenCalledWith(
      'assign-to-theme',
      `${ROW_OLDER} → agent memory`,
      { itemId: 'i2', newThemeLabel: 'agent memory' },
    );
  });

  it('narrows visible rows by title from the search box', async () => {
    await openFeeds();

    await userEvent.type(
      screen.getByLabelText('search loaded items by title or source'),
      'latency',
    );
    expect(await screen.findByRole('article', { name: ROW_OLDER })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: ROW_TODAY })).not.toBeInTheDocument();
    expect(screen.queryByRole('article', { name: ROW_OTHER })).not.toBeInTheDocument();
  });

  it('deep links straight to the feeds bench via ?view=feeds', async () => {
    window.history.replaceState(null, '', '?view=feeds');
    try {
      renderApp();
      expect(await screen.findByRole('navigation', { name: 'sources' })).toBeInTheDocument();
      expect(screen.getByText('feeds · every source, newest first')).toBeInTheDocument();
      // The edition did not render; feeds opened immediately.
      expect(screen.queryByText(LEDE_TITLE)).not.toBeInTheDocument();
    } finally {
      // Tests in this file share one happy-dom window; leave the URL clean.
      window.history.replaceState(null, '', '/');
    }
  });

  it('never renders an unread counter on the bench or its tab', async () => {
    await openFeeds();
    expect(document.body.textContent).not.toMatch(/\d+\s+unread/i);
    // The tab itself carries no badge of any kind.
    expect(screen.getByRole('tab', { name: 'Feeds' }).textContent).toBe('Feeds');
  });
});

// ------------------------------------------------------------- citations

describe('citations', () => {
  it('opens a live source sheet on the lede with the cited article and both actions', async () => {
    renderApp();
    await screen.findByText(LEDE_TITLE);

    // The lede cites i1, whose title resolves from reading_items.
    await userEvent.click(screen.getByRole('button', { name: 'sources for the lede' }));
    const sheet = await screen.findByRole('dialog', { name: 'sources for the lede' });
    expect(within(sheet).getByText('A field guide to context windows')).toBeInTheDocument();
    // External and internal actions are both offered.
    expect(within(sheet).getByRole('link', { name: 'Open article' })).toHaveAttribute(
      'href',
      'https://example.com/a',
    );
    expect(within(sheet).getByRole('button', { name: 'Open in Feeds' })).toBeInTheDocument();
  });

  it('opens a live source sheet on an emerging card that carries item ids', async () => {
    renderApp();
    await screen.findByText(LEDE_TITLE);

    // This emerging card cites i3; the marker is live.
    await userEvent.click(
      screen.getByRole('button', { name: 'sources for Small models are getting good at tool use' }),
    );
    const sheet = await screen.findByRole('dialog', {
      name: 'sources for Small models are getting good at tool use',
    });
    expect(within(sheet).getByText('The quiet rise of on-device inference')).toBeInTheDocument();
  });

  it('renders a disabled marker on an emerging card with no recorded ids', async () => {
    renderApp();
    await screen.findByText(LEDE_TITLE);

    // An older edition may carry an emerging entry with no item_ids; the marker
    // is honest about the gap rather than hidden or invented.
    const disabled = await screen.findByLabelText(
      'no sources recorded for Evals as a design instrument',
    );
    expect(disabled).toHaveAttribute('title', 'no sources recorded');
  });

  it('deep-links a cited source into the Feeds tab via Open in Feeds', async () => {
    renderApp();
    await screen.findByText(LEDE_TITLE);

    await userEvent.click(screen.getByRole('button', { name: 'sources for the lede' }));
    const sheet = await screen.findByRole('dialog', { name: 'sources for the lede' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Open in Feeds' }));

    // The Feeds bench opens and the cited row is present; the edition is gone.
    expect(await screen.findByRole('navigation', { name: 'sources' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'A field guide to context windows' })).toBeInTheDocument();
    expect(screen.queryByText(LEDE_TITLE)).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('item')).toBe('i1');
    window.history.replaceState(null, '', '/');
  });

  it('gives each Start Here row an Open in Feeds affordance', async () => {
    renderApp();
    await screen.findByText(LEDE_TITLE);

    expect(
      screen.getByRole('button', { name: 'open A field guide to context windows in Feeds' }),
    ).toBeInTheDocument();
  });
});
