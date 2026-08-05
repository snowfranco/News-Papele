// Feed fetching through the same three-proxy fallback chain the legacy app
// used: rss2json, then allorigins, then corsproxy. Ported from the legacy
// bundle; behaviour (timeouts, item caps, XML fallback parsing) preserved.
import { FEED_ITEM_LIMIT } from '../config';
import { stableItemId, stripHtml } from './format';

export interface FetchedArticle {
  id: string;
  title: string;
  link: string;
  snippet: string;
  /** Normalised to a valid ISO string, or null. Never an unparseable date:
   * a single bad pubDate must not sink a whole feed downstream. */
  pubDate: string | null;
}

const TIMEOUT_MS = 8000;

function toIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function viaRss2Json(feedUrl: string): Promise<FetchedArticle[]> {
  const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}&api_key=&count=15`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = (await res.json()) as {
    status?: string;
    items?: { title?: string; description?: string; content?: string; link?: string; guid?: string; pubDate?: string }[];
  };
  if (data.status !== 'ok' || !data.items?.length) throw new Error('rss2json failed');
  return data.items.slice(0, FEED_ITEM_LIMIT).map((item) => ({
    id: stableItemId(item.link || item.guid || `${feedUrl}-${item.title}`),
    title: stripHtml(item.title ?? 'Untitled'),
    link: item.link || item.guid || '#',
    snippet: stripHtml(item.description ?? item.content ?? '').slice(0, 350),
    pubDate: toIso(item.pubDate),
  }));
}

function parseXml(xml: string, feedUrl: string): FetchedArticle[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return Array.from(doc.querySelectorAll('item, entry'))
    .slice(0, FEED_ITEM_LIMIT)
    .map((el) => {
      const title = el.querySelector('title')?.textContent ?? 'Untitled';
      const link =
        el.querySelector('link')?.textContent?.trim() ||
        el.querySelector('link')?.getAttribute('href') ||
        '#';
      const pubDate = toIso(el.querySelector('pubDate, published, updated')?.textContent);
      const content = el.querySelector('content\\:encoded, content')?.textContent ?? '';
      const description = el.querySelector('description, summary')?.textContent ?? '';
      return {
        id: stableItemId(link !== '#' ? link : `${feedUrl}-${title}-${pubDate ?? ''}`),
        title: stripHtml(title),
        link: link.trim(),
        snippet: stripHtml(description || content).slice(0, 350),
        pubDate,
      };
    });
}

async function viaAllOrigins(feedUrl: string): Promise<FetchedArticle[]> {
  const url = `https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`allorigins ${res.status}`);
  const text = await res.text();
  if (!text.includes('<item') && !text.includes('<entry')) throw new Error('not XML');
  return parseXml(text, feedUrl);
}

async function viaCorsProxy(feedUrl: string): Promise<FetchedArticle[]> {
  const url = `https://corsproxy.io/?${encodeURIComponent(feedUrl)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`corsproxy ${res.status}`);
  const text = await res.text();
  if (!text.includes('<item') && !text.includes('<entry')) throw new Error('not XML');
  return parseXml(text, feedUrl);
}

/** Fetch one feed through the proxy chain. Throws if every strategy fails. */
export async function fetchFeed(feedUrl: string): Promise<FetchedArticle[]> {
  let lastError: unknown = null;
  for (const strategy of [viaRss2Json, viaAllOrigins, viaCorsProxy]) {
    try {
      const items = await strategy(feedUrl);
      if (items.length > 0) return items;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`All strategies failed for ${feedUrl}: ${String(lastError)}`);
}

/** Probe a suggested feed URL: resolves true only when the proxy chain can
 * actually fetch at least one item. Used to validate onboarding suggestions
 * before they are seeded into context. */
export async function validateFeedUrl(feedUrl: string): Promise<boolean> {
  try {
    const items = await fetchFeed(feedUrl);
    return items.length > 0;
  } catch {
    return false;
  }
}
