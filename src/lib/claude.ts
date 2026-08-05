// Direct in-app Claude calls for assisted source setup. Resolution order:
// a hosted window.claude bridge when the environment injects one, then a
// plain fetch to the Anthropic API with a device-local key. Every failure
// mode surfaces as ClaudeUnavailableError so callers can degrade to the
// curated fallback sets below instead of blocking the reader.
import {
  ANTHROPIC_API_URL,
  ANTHROPIC_VERSION,
  CLAUDE_MODEL,
  LOCAL_API_KEY_STORAGE,
} from '../config';
import { sourceSuggestionsResponseSchema } from '../schemas';
import type { SourceSuggestion } from '../types';

// Some hosting environments (artifact runtimes) inject a Claude bridge.
declare global {
  interface Window {
    claude?: { complete?: (prompt: string) => Promise<string> };
  }
}

// The API key is a device-local secret: the one sanctioned localStorage use
// (sync state lives in Supabase). localStorage itself can throw in locked-
// down browsing modes, so both accessors swallow storage errors.
export function getStoredApiKey(): string | null {
  try {
    return localStorage.getItem(LOCAL_API_KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setStoredApiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) localStorage.setItem(LOCAL_API_KEY_STORAGE, trimmed);
    else localStorage.removeItem(LOCAL_API_KEY_STORAGE);
  } catch {
    // Storage unavailable: the key simply will not persist.
  }
}

export class ClaudeUnavailableError extends Error {
  reason: 'no-key' | 'http' | 'network' | 'bad-json';

  constructor(reason: ClaudeUnavailableError['reason'], message?: string) {
    super(message ?? `claude unavailable: ${reason}`);
    this.name = 'ClaudeUnavailableError';
    this.reason = reason;
  }
}

export async function callClaude(prompt: string, opts?: { maxTokens?: number }): Promise<string> {
  if (typeof window.claude?.complete === 'function') {
    try {
      return await window.claude.complete(prompt);
    } catch {
      throw new ClaudeUnavailableError('network', 'hosted claude bridge failed');
    }
  }

  const key = getStoredApiKey();
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        ...(key ? { 'x-api-key': key, 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: opts?.maxTokens ?? 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch {
    throw new ClaudeUnavailableError('network');
  }
  if (!res.ok) {
    throw new ClaudeUnavailableError(
      res.status === 401 && !key ? 'no-key' : 'http',
      `claude http ${res.status}`,
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ClaudeUnavailableError('bad-json', 'response was not json');
  }
  const text = (data as { content?: { text?: unknown }[] }).content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new ClaudeUnavailableError('bad-json', 'no text block in response');
  }
  return text;
}

export async function suggestSources(input: {
  area: string;
  projects: { id: string; label: string; description?: string }[];
  existingUrls: string[];
}): Promise<SourceSuggestion[]> {
  const projectLines =
    input.projects.length > 0
      ? `What they are building:\n${input.projects
          .map((p) => `- ${p.label}${p.description ? ` — ${p.description}` : ''}`)
          .join('\n')}`
      : 'They have not listed specific projects yet.';
  const exclusions =
    input.existingUrls.length > 0
      ? `\nExclude these URLs the reader already has:\n${input.existingUrls
          .map((u) => `- ${u}`)
          .join('\n')}`
      : '';

  const prompt = `You curate learning sources for a reader setting up their personal beat.

Their area and role: ${input.area}
${projectLines}

Suggest 6 to 10 reputable, currently-active sources for that area and role and what they are building.
Prefer kind "feed": direct RSS or Atom feed URLs (e.g. paths like /feed, /rss, .xml, /atom), never a homepage in place of the feed.
Also include a couple of kind "blog" (a strong site with no feed known) or kind "resource" (a durable reference hub).${exclusions}

Respond with STRICT JSON only, exactly this shape, no commentary outside the JSON:
{"suggestions":[{"name":string,"url":string,"kind":"feed"|"blog"|"resource","reason":string}]}
Each "reason" is one short sentence on why the source fits this reader.`;

  const raw = await callClaude(prompt);
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ClaudeUnavailableError('bad-json', 'suggestions were not valid json');
  }
  const result = sourceSuggestionsResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new ClaudeUnavailableError('bad-json', 'suggestions failed schema validation');
  }
  return result.data.suggestions;
}

const PRODUCT_SET: SourceSuggestion[] = [
  {
    name: "Lenny's Newsletter",
    url: 'https://www.lennysnewsletter.com/feed',
    kind: 'feed',
    reason: 'The widest-read product newsletter; strong on craft, growth, and career.',
  },
  {
    name: 'ChatPRD · How I AI',
    url: 'https://www.chatprd.ai/how-i-ai/feed',
    kind: 'feed',
    reason: 'Practical looks at how product people fold AI into their working week.',
  },
  {
    name: 'AI Product Playbook',
    url: 'https://amankhan1.substack.com/feed',
    kind: 'feed',
    reason: 'Hands-on playbooks for shipping AI products, from evals to UX.',
  },
  {
    name: 'The Business Engineer',
    url: 'https://businessengineer.ai/feed',
    kind: 'feed',
    reason: 'Business-model and strategy analysis with a visual, framework-first style.',
  },
  {
    name: 'SVPG',
    url: 'https://www.svpg.com/feed/',
    kind: 'feed',
    reason: 'Marty Cagan and partners on how strong product organisations work.',
  },
];

const AI_SET: SourceSuggestion[] = [
  {
    name: 'Simon Willison',
    url: 'https://simonwillison.net/atom/everything/',
    kind: 'feed',
    reason: 'Daily, grounded notes on what new models and tools can actually do.',
  },
  {
    name: 'Latent Space',
    url: 'https://www.latent.space/feed',
    kind: 'feed',
    reason: 'The AI-engineer beat: interviews and deep dives on building with models.',
  },
  {
    name: 'Import AI',
    url: 'https://importai.substack.com/feed',
    kind: 'feed',
    reason: "Jack Clark's weekly read on research and policy signal.",
  },
  {
    name: 'Interconnects',
    url: 'https://www.interconnects.ai/feed',
    kind: 'feed',
    reason: 'Nathan Lambert on the open-model frontier and training practice.',
  },
];

const DESIGN_SET: SourceSuggestion[] = [
  {
    name: 'Nielsen Norman Group',
    url: 'https://www.nngroup.com/feed/rss/',
    kind: 'feed',
    reason: 'Evidence-based UX research that stays useful long after trends pass.',
  },
  {
    name: 'UX Collective',
    url: 'https://uxdesign.cc/feed',
    kind: 'feed',
    reason: 'A broad practitioner feed for design thinking and craft.',
  },
];

/** Keyword-matched starter sets used when Claude is unavailable. First match
 * wins; the empty-regex entry makes the product set the universal default. */
export const CURATED_SETS: { match: RegExp; label: string; suggestions: SourceSuggestion[] }[] = [
  { match: /product|pm/i, label: 'product management', suggestions: PRODUCT_SET },
  { match: /ai|ml|engineer|develop/i, label: 'ai engineering', suggestions: AI_SET },
  { match: /design|ux/i, label: 'design', suggestions: DESIGN_SET },
  { match: /(?:)/, label: 'product management', suggestions: PRODUCT_SET },
];

export function curatedFor(area: string): SourceSuggestion[] {
  const set = CURATED_SETS.find((s) => s.match.test(area));
  return set ? set.suggestions : PRODUCT_SET;
}
