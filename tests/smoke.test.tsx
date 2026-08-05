// Phase 1 smoke test: boots the whole cockpit against a mocked data layer
// and walks the skeleton end to end — masthead, edition, theme map, position
// desk, command bar, outbox. Per-view suites arrive in Phase 2.
import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
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
      },
      {
        themeId: 'th-progress',
        tag: 'applied',
        title: 'Evals as a design instrument',
        note: 'Keeps surfacing next to your build notes.',
        meta: 'feeds frameshift',
        lane: 'applied',
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

  const readingItems: ReadingItem[] = [
    {
      id: 'i1',
      type: 'article',
      title: 'A field guide to context windows',
      url: 'https://example.com/a',
      snippet: 'How context budgets shape agent design.',
      topics: ['ai craft'],
      read: false,
      addedAt: '2026-08-04T06:00:00.000Z',
      sourceFeed: 'signal review',
      publishedAt: '2026-08-04T05:00:00.000Z',
      origin: 'feed',
      imagePreview: null,
    },
  ];

  return { context, edition, themes, themeLinks, positions, readingItems };
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
  getReadStates: vi.fn(async (): Promise<Record<string, boolean>> => ({})),
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
