// Server-side feed ingestion. Fetches every enabled feed directly (no CORS
// proxy required in Node, unlike the browser path in src/lib/feeds.ts), and
// upserts the items into reading_items so manifold and the app share one
// fresh corpus regardless of whether anyone opened the app. Runs on a cron
// (.github/workflows/manifold-ingest.yml), reads the feed list from the same
// context.sources.feeds shape the app writes, and mirrors the field-for-field
// shape of the app's upsertFeedItems (src/data/dataLayer.ts) so the two paths
// stay contract-compatible.
//
// The parser handles RSS 2.0 and Atom with a small tolerant regex core: RSS
// and Atom feeds vary wildly in the wild (mixed CDATA, mixed encoded content,
// half-namespaced tags) and a stricter XML parser would refuse feeds every
// commercial reader happily consumes. Fields extracted: title, link,
// pubDate/published/updated, description/summary/content. Anything richer is
// out of scope; manifold only needs enough to cluster and cite.
import { contextRowSchema, parseRows } from './app-contract.ts';
import type { AppContext, FeedSource } from './app-contract.ts';
import type { ManifoldConfig } from './env.ts';
import { stableItemId } from '../../src/lib/stable-id.ts';
import type { SupabaseClient } from './supabase.ts';

const FETCH_TIMEOUT_MS = 15_000;
const ITEM_LIMIT_PER_FEED = 40;
const CONCURRENT_FETCHES = 4;
// A polite, honest UA. Many feed hosts return 403/406 for the default Node
// UA (or none) but accept anything that identifies a bot with a URL.
const USER_AGENT =
  'SuperlearnBot/1.0 (+https://github.com/snowfranco/Superlearn) manifold-ingest';

interface FetchedArticle {
  id: string;
  title: string;
  link: string;
  snippet: string;
  pubDate: string | null;
}

export interface FeedIngestReport {
  feedId: string;
  feedName: string;
  fetched: number;
  upserted: number;
  error: string | null;
}

export interface IngestReport {
  tenant: string;
  feedsAttempted: number;
  feedsOk: number;
  feedsFailed: number;
  itemsFetched: number;
  itemsUpserted: number;
  perFeed: FeedIngestReport[];
}

// ----------------------------------------------------------------- parsing

/** Strip tags and collapse whitespace. Node-safe (no DOM), so this cannot
 * reuse src/lib/format.ts stripHtml, which builds a DIV. */
function stripTags(html: string): string {
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Peel any CDATA wrapper off, then return the raw inner text. Callers that
 * want prose-only pass this through stripTags. */
function unwrapCdata(raw: string): string {
  const m = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : raw;
}

/** First inner text of any of the named tags in a block, or null. Case
 * insensitive, tolerates namespaced tag names like content:encoded. */
function firstTag(block: string, names: string[]): string | null {
  for (const name of names) {
    // Escape ':' so content:encoded works. Non-greedy match to the closing tag.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)</${escaped}>`, 'i');
    const m = block.match(re);
    if (m) return unwrapCdata(m[1]);
  }
  return null;
}

/** Atom link resolution: prefer rel="alternate" (or no rel), type html-ish,
 * over rel="self". Falls back to the first link href found. */
function atomLink(block: string): string | null {
  const linkTags = [...block.matchAll(/<link\b[^/>]*\/?>/gi)].map((m) => m[0]);
  const scored = linkTags.map((tag) => {
    const rel = tag.match(/\brel="([^"]*)"/i)?.[1] ?? '';
    const href = tag.match(/\bhref="([^"]*)"/i)?.[1] ?? '';
    let score = 0;
    if (!rel || rel === 'alternate') score += 2;
    if (/text\/html/i.test(tag.match(/\btype="([^"]*)"/i)?.[1] ?? '')) score += 1;
    if (rel === 'self') score -= 2;
    return { href, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.href || null;
}

function rssLink(block: string): string | null {
  // RSS: <link>URL</link> (no href attr). Fall back to atom-style href if
  // the feed mixes formats.
  const inner = firstTag(block, ['link']);
  if (inner && inner.trim().length > 0 && !/^<link/i.test(inner)) return stripTags(inner);
  return atomLink(block);
}

function toIso(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseFeed(xml: string): FetchedArticle[] {
  const isAtom = /<feed\b[^>]*xmlns=["']?http:\/\/www\.w3\.org\/2005\/Atom/i.test(xml);
  const entryTag = isAtom ? 'entry' : 'item';
  const entryRe = new RegExp(`<${entryTag}\\b[\\s\\S]*?</${entryTag}>`, 'gi');
  const blocks = xml.match(entryRe) ?? [];
  const out: FetchedArticle[] = [];
  for (const block of blocks) {
    const titleRaw = firstTag(block, ['title']);
    const title = titleRaw ? stripTags(titleRaw) : 'Untitled';
    const link = (isAtom ? atomLink(block) : rssLink(block))?.trim() || '';
    if (!link) continue; // No link means no stable id; skip.
    const pubDateRaw =
      firstTag(block, ['pubDate']) ??
      firstTag(block, ['published']) ??
      firstTag(block, ['updated']) ??
      firstTag(block, ['dc:date']);
    const bodyRaw =
      firstTag(block, ['content:encoded']) ??
      firstTag(block, ['content']) ??
      firstTag(block, ['description']) ??
      firstTag(block, ['summary']) ??
      '';
    const snippet = stripTags(bodyRaw).slice(0, 350);
    out.push({
      id: stableItemId(link),
      title: title || 'Untitled',
      link,
      snippet,
      pubDate: toIso(pubDateRaw),
    });
    if (out.length >= ITEM_LIMIT_PER_FEED) break;
  }
  return out;
}

// ----------------------------------------------------------------- fetching

async function fetchFeed(feedUrl: string): Promise<FetchedArticle[]> {
  const res = await fetch(feedUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      // Ask for feed-shaped content types first but accept anything: some
      // hosts route by Accept and default to HTML for '*/*'.
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      'User-Agent': USER_AGENT,
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!/<(item|entry)\b/i.test(text)) {
    throw new Error(`response is not a feed (no <item> or <entry> in ${text.length} bytes)`);
  }
  return parseFeed(text);
}

async function pool<T, R>(items: T[], size: number, worker: (i: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

// ---------------------------------------------------------------- writing

async function upsertItems(sb: SupabaseClient, feed: FeedSource, items: FetchedArticle[]): Promise<number> {
  if (items.length === 0) return 0;
  const now = new Date().toISOString();
  const rows = items.map((a) => ({
    id: a.id,
    type: 'article',
    title: a.title,
    url: a.link,
    snippet: a.snippet,
    topics: [] as string[],
    read: false,
    added_at: now,
    source_feed: feed.name,
    published_at: a.pubDate,
    origin: 'feed',
  }));
  await sb.fetch('/reading_items?on_conflict=id', {
    method: 'POST',
    body: rows,
    prefer: 'resolution=ignore-duplicates,return=minimal',
  });
  return rows.length;
}

// ----------------------------------------------------------------- runner

async function loadContext(sb: SupabaseClient, tenant: string): Promise<AppContext | null> {
  const rows = await sb.fetch<unknown[]>(
    `/context?tenant=eq.${encodeURIComponent(tenant)}&limit=1`,
  );
  return parseRows(rows, contextRowSchema, 'context')[0] ?? null;
}

export async function runIngestion(
  sb: SupabaseClient,
  config: ManifoldConfig,
  dryRun: boolean,
): Promise<IngestReport> {
  const ctx = await loadContext(sb, config.tenant);
  const feeds = (ctx?.sources.feeds ?? []).filter((f) => f.enabled);
  const perFeed: FeedIngestReport[] = await pool(feeds, CONCURRENT_FETCHES, async (feed) => {
    try {
      const fetched = await fetchFeed(feed.url);
      const upserted = dryRun ? 0 : await upsertItems(sb, feed, fetched);
      return { feedId: feed.id, feedName: feed.name, fetched: fetched.length, upserted, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { feedId: feed.id, feedName: feed.name, fetched: 0, upserted: 0, error: msg.slice(0, 300) };
    }
  });
  return {
    tenant: config.tenant,
    feedsAttempted: feeds.length,
    feedsOk: perFeed.filter((f) => f.error === null).length,
    feedsFailed: perFeed.filter((f) => f.error !== null).length,
    itemsFetched: perFeed.reduce((n, f) => n + f.fetched, 0),
    itemsUpserted: perFeed.reduce((n, f) => n + f.upserted, 0),
    perFeed,
  };
}

export function formatIngestReport(report: IngestReport, dryRun: boolean): string {
  const stamp = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });
  const lines: string[] = [];
  lines.push(`# manifold ingest: ${stamp} (America/Toronto)`);
  lines.push('');
  lines.push(
    dryRun
      ? `Dry run. ${report.itemsFetched} items would be upserted from ${report.feedsOk}/${report.feedsAttempted} feeds (tenant ${report.tenant}).`
      : `${report.itemsUpserted} items upserted from ${report.feedsOk}/${report.feedsAttempted} feeds (tenant ${report.tenant}).`,
  );
  lines.push('');
  if (report.feedsFailed > 0) {
    lines.push(`## Failed feeds (${report.feedsFailed})`);
    for (const f of report.perFeed.filter((x) => x.error)) {
      lines.push(`- ${f.feedName} (${f.feedId}): ${f.error}`);
    }
    lines.push('');
  }
  lines.push(`## Per feed`);
  for (const f of report.perFeed.filter((x) => !x.error)) {
    lines.push(`- ${f.feedName}: fetched ${f.fetched}, upserted ${f.upserted}`);
  }
  lines.push('');
  lines.push('-- manifold');
  return lines.join('\n');
}
