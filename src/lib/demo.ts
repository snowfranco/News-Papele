// Demo fixtures, loaded only when the page is opened with ?demo. This is an
// in-memory preview of a populated cockpit (what the views look like once
// manifold writes real editions and themes). Nothing here touches Supabase
// and nothing is persisted. The copy is honest about being a demo.
import type { AppContext, Edition, Position, ReadingItem, Theme, ThemeLink } from '../types';

export interface DemoData {
  context: AppContext;
  edition: Edition;
  themes: Theme[];
  themeLinks: ThemeLink[];
  positions: Position[];
  readingItems: ReadingItem[];
  readStates: Record<string, boolean>;
}

export function isDemoMode(): boolean {
  return new URLSearchParams(window.location.search).has('demo');
}

export function buildDemoData(): DemoData {
  const now = new Date();
  const iso = now.toISOString();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000).toISOString();

  const context: AppContext = {
    id: 'demo',
    tenant: 'default',
    sources: {
      feeds: [
        { id: 'demo-f1', name: 'a product newsletter', url: 'https://example.com/feed', enabled: true },
        { id: 'demo-f2', name: 'an ai engineering blog', url: 'https://example.com/rss', enabled: true },
      ],
      blogs: [],
      resources: [],
    },
    projects: [
      { id: 'atlas', label: 'atlas', description: 'the internal research tool you are building' },
      { id: 'field-notes', label: 'field notes', description: 'your public writing' },
    ],
    orgContext: 'demo beat: product work at the edge of ai',
    updatedAt: iso,
  };

  const themes: Theme[] = [
    {
      id: 'demo-evals',
      label: 'evals as the spec',
      discipline: 'craft',
      lane: 'applied',
      heat: 0.85,
      mastery: 'position',
      why: 'The test set, not the document, is becoming the living definition of what good means.',
      reads: 6,
      createdAt: daysAgo(30),
      updatedAt: iso,
    },
    {
      id: 'demo-context',
      label: 'context engineering',
      discipline: 'craft',
      lane: 'applied',
      heat: 0.7,
      mastery: 'progress',
      why: 'Feeding agents the right slice of the world beats bigger prompts.',
      reads: 3,
      createdAt: daysAgo(21),
      updatedAt: iso,
    },
    {
      id: 'demo-distribution',
      label: 'distribution before product',
      discipline: 'gtm',
      lane: 'applied',
      heat: 0.55,
      mastery: 'progress',
      why: 'An audience compounds while a backlog only accrues.',
      reads: 4,
      createdAt: daysAgo(18),
      updatedAt: iso,
    },
    {
      id: 'demo-onchain-agents',
      label: 'agent-to-agent commerce',
      discipline: 'strategy',
      lane: 'horizon',
      heat: 0.45,
      mastery: 'unread',
      why: 'Early signal: agents buying from agents, with no human in the checkout flow. Small volume, steep trajectory.',
      reads: 0,
      createdAt: daysAgo(6),
      updatedAt: iso,
    },
    {
      id: 'demo-local-models',
      label: 'small local models',
      discipline: 'craft',
      lane: 'horizon',
      heat: 0.4,
      mastery: 'unread',
      why: 'Rising fast in the last three weeks: capable models on laptops change what a private-by-default product can be.',
      reads: 1,
      createdAt: daysAgo(9),
      updatedAt: iso,
    },
  ];

  const themeLinks: ThemeLink[] = [
    { id: 'demo-l1', sourceId: 'demo-evals', targetId: 'demo-context', kind: 'relate' },
    { id: 'demo-l2', sourceId: 'demo-context', targetId: 'demo-local-models', kind: 'relate' },
    { id: 'demo-l3', sourceId: 'demo-evals', targetId: 'atlas', kind: 'project' },
    { id: 'demo-l4', sourceId: 'demo-context', targetId: 'atlas', kind: 'project' },
    { id: 'demo-l5', sourceId: 'demo-distribution', targetId: 'field-notes', kind: 'project' },
  ];

  const edition: Edition = {
    id: 'demo-edition',
    editionNo: 12,
    editionDate: iso.slice(0, 10),
    beat: 'demo beat',
    welcome:
      'Welcome back. This is the demo edition: real editions are written by manifold from your own sources, in this same shape.',
    lede: {
      kicker: "today's lede · craft",
      title: 'The eval set is quietly becoming the spec',
      deck: 'Several of your sources converged on one idea this week: the test set, not the document, now says what good means.',
      why: 'Rising signal across your craft sources, and it maps directly onto the measurement gap in atlas. Reading this is also progress on that build.',
      applyProjectId: 'atlas',
      itemIds: [],
    },
    emerging: [
      {
        themeId: 'demo-onchain-agents',
        tag: 'horizon',
        title: 'Agents buying from agents',
        note: 'Tied to none of your projects, rising anyway. Early, steep, worth twenty minutes.',
        meta: '3 sources · 2 wks · early signal',
        lane: 'horizon',
      },
      {
        themeId: 'demo-distribution',
        tag: 'go-to-market',
        title: 'Distribution before product',
        note: 'Your writing cadence is the moat for field notes.',
        meta: '4 sources · steady',
        lane: 'applied',
      },
    ],
    startHere: [
      { itemId: null, title: 'Why the eval set outranks the spec', minutes: 14, note: 'the lede, in one sitting.' },
      { itemId: null, title: 'A field guide to agent-to-agent payments', minutes: 9, note: 'the horizon item, early and short.' },
      { itemId: null, title: 'Context windows are a product decision', minutes: 11, note: 'bridges both of your builds.' },
    ],
    createdAt: iso,
  };

  const positions: Position[] = [
    {
      id: 'demo-p1',
      themeId: 'demo-evals',
      kind: 'column',
      title: 'The spec is dead, long live the eval set',
      body: '',
      status: 'published',
      createdAt: daysAgo(7),
      publishedAt: daysAgo(7),
    },
    {
      id: 'demo-p2',
      themeId: 'demo-distribution',
      kind: 'column',
      title: 'Ship the newsletter before the product',
      body: '',
      status: 'draft',
      createdAt: daysAgo(2),
      publishedAt: null,
    },
  ];

  const hoursAgo = (n: number) => new Date(now.getTime() - n * 3600000).toISOString();
  const demoItem = (
    n: number,
    source: string,
    title: string,
    snippet: string,
    publishedAt: string,
  ): ReadingItem => ({
    id: `demo-item-${n}`,
    type: 'article',
    title,
    url: `https://example.com/demo/${n}`,
    snippet,
    topics: [],
    read: false,
    addedAt: publishedAt,
    sourceFeed: source,
    publishedAt,
    origin: 'feed',
    imagePreview: null,
  });

  const readingItems: ReadingItem[] = [
    demoItem(1, 'a product newsletter', 'Why the eval set outranks the spec', 'The living definition of good moves from the document to the test set.', hoursAgo(2)),
    demoItem(2, 'an ai engineering blog', 'Context windows are a product decision', 'What you feed the model is a design surface, not plumbing.', hoursAgo(5)),
    demoItem(3, 'a product newsletter', 'Distribution before product, revisited', 'An audience compounds while a backlog only accrues.', hoursAgo(26)),
    demoItem(4, 'an ai engineering blog', 'A field guide to agent-to-agent payments', 'Early signal: agents buying from agents, no human in the checkout flow.', hoursAgo(30)),
    demoItem(5, 'a product newsletter', 'The roadmap is a hypothesis list', 'Treating commitments as bets changes the meeting.', hoursAgo(78)),
    demoItem(6, 'an ai engineering blog', 'Small local models change the privacy default', 'Capable models on laptops make private-by-default products practical.', hoursAgo(102)),
  ];

  return {
    context,
    edition,
    themes,
    themeLinks,
    positions,
    readingItems,
    readStates: { 'demo-item-3': true, 'demo-item-5': true },
  };
}
