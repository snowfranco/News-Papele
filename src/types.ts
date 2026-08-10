// The Superlearn domain contract.
//
// Read/write split:
//   - manifold (the background agent) WRITES: editions, themes, theme_links,
//     and recommendations; it READS: outbox, context, reading_items.
//   - the app READS: editions, themes, theme_links, positions, context,
//     reading_items; it WRITES: outbox, positions, context, reading_items
//     (feed refresh), article_read_states.
//
// Every shape manifold writes and the app reads has a zod schema in
// schemas.ts; the data layer validates rows on the way in and degrades to
// empty states rather than rendering unvalidated payloads.

export type ViewKey = 'edition' | 'map' | 'desk' | 'feeds';

// ---------------------------------------------------------------- context

export interface FeedSource {
  id: string;
  name: string;
  url: string;
  color?: string;
  enabled: boolean;
}

export interface LinkSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface Sources {
  feeds: FeedSource[];
  blogs: LinkSource[];
  resources: LinkSource[];
}

export interface Project {
  id: string;
  label: string;
  description?: string;
}

export interface AppContext {
  id: string;
  tenant: string;
  sources: Sources;
  projects: Project[];
  orgContext: string | null;
  updatedAt: string;
}

export const EMPTY_SOURCES: Sources = { feeds: [], blogs: [], resources: [] };

// ----------------------------------------------------------------- themes

/** The two manifold lanes. Applied connects to something the user is
 * building; horizon is current-and-emerging learning that no project gates.
 * Lane is an enrichment tag and a lens, never a filter. */
export type Lane = 'applied' | 'horizon';

export type Mastery = 'unread' | 'progress' | 'position';

export interface Theme {
  id: string;
  label: string;
  discipline: string;
  lane: Lane;
  /** 0..1 relative heat; drives node radius on the map. */
  heat: number;
  mastery: Mastery;
  why: string;
  reads: number;
  createdAt: string;
  updatedAt: string;
}

export type ThemeLinkKind = 'relate' | 'project';

export interface ThemeLink {
  id: string;
  /** Theme id. */
  sourceId: string;
  /** Theme id for kind 'relate'; project id (from context.projects) for kind 'project'. */
  targetId: string;
  kind: ThemeLinkKind;
}

// --------------------------------------------------------------- editions

export interface EditionLede {
  kicker: string;
  title: string;
  deck: string;
  /** The "why this leads" rationale, grounded in the reader's sources. */
  why: string;
  /** Project id from context.projects, or null for a horizon lede. */
  applyProjectId: string | null;
  /** reading_items ids backing the lede. */
  itemIds: string[];
  /** Primary link to start reading, when known. */
  url?: string;
}

export interface EditionEmerging {
  themeId: string | null;
  tag: string;
  title: string;
  note: string;
  meta: string;
  lane: Lane;
}

export interface EditionRead {
  itemId: string | null;
  title: string;
  minutes: number;
  note: string;
  url?: string;
}

export interface Edition {
  id: string;
  editionNo: number | null;
  editionDate: string;
  beat: string | null;
  /** Welcoming brief. Never mentions unread counts; that is a contract rule
   * enforced by schema validation, not just tone guidance. */
  welcome: string;
  lede: EditionLede | null;
  emerging: EditionEmerging[];
  startHere: EditionRead[];
  createdAt: string;
  /** True when built client-side from raw feed items because manifold has
   * not written an edition yet. */
  seed?: boolean;
}

// -------------------------------------------------------------- positions

export type PositionKind = 'column' | 'contrarian' | 'hot_take' | 'explain_back';

export type PositionStatus = 'draft' | 'published';

export interface Position {
  id: string;
  themeId: string | null;
  kind: PositionKind;
  title: string;
  body: string;
  status: PositionStatus;
  createdAt: string;
  publishedAt: string | null;
}

// ----------------------------------------------------------------- outbox

export type OutboxKind =
  | 'note'
  | 'park'
  | 'start-reading'
  | 'read-next'
  | 'draft-position'
  | 'add-note'
  | 'publish-column'
  | 'challenge-response'
  | 'send-to-project'
  | 'sources-updated'
  | 'request-edition'
  | 'assign-to-theme';

/** Payload for outbox kind 'park' when parking a concrete reading item (the
 * Feeds tab always sends this shape; older callers may park a bare label with
 * an empty payload, which stays valid). Consumed by manifold. */
export interface ParkItemPayload {
  itemId: string;
  source: string | null;
  title: string;
  url: string | null;
}

/** Payload for outbox kind 'assign-to-theme'. Exactly one of themeId or
 * newThemeLabel is set: the app never creates themes directly, manifold owns
 * theme creation and reconciliation off the outbox. Consumed by manifold. */
export type AssignToThemePayload =
  | { itemId: string; themeId: string }
  | { itemId: string; newThemeLabel: string };

export type OutboxStatus = 'queued' | 'seen' | 'done';

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  label: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  createdAt: string;
}

// ---------------------------------------------------------- reading items

/** An item is an article today; the same shape (plus the sibling resources
 * table) carries durable resources later without a rewrite. */
export type ReadingItemType = 'article' | 'book' | 'course' | 'training' | 'webinar' | 'note';

export type ReadingItemOrigin = 'feed' | 'manual' | 'manifold';

export interface ReadingItem {
  id: string;
  type: ReadingItemType;
  title: string;
  url: string | null;
  snippet: string | null;
  topics: string[];
  read: boolean;
  addedAt: string;
  sourceFeed: string | null;
  publishedAt: string | null;
  origin: ReadingItemOrigin;
  imagePreview: string | null;
}

// ------------------------------------------------------------- resources

export type ResourceKind = 'book' | 'course' | 'training' | 'webinar' | 'article' | 'other';

export interface Resource {
  id: string;
  kind: ResourceKind;
  title: string;
  url: string | null;
  author: string | null;
  note: string | null;
  createdAt: string;
}

// ------------------------------------------------------- source suggestion

/** Shape returned by the assisted-onboarding Claude call. */
export interface SourceSuggestion {
  name: string;
  url: string;
  kind: 'feed' | 'blog' | 'resource';
  reason: string;
}

/** Validation status for a suggested feed after probing the proxy chain. */
export type SuggestionCheck = 'pending' | 'ok' | 'unreachable' | 'duplicate';
