// Low-level Supabase REST access. Everything network-shaped goes through
// sbFetch; the typed table API lives in dataLayer.ts. No other module may
// talk to Supabase directly.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';

export class SupabaseError extends Error {
  status: number;
  code: string | null;
  /** True when the failure means the table has not been migrated yet. */
  tableMissing: boolean;

  constructor(status: number, body: string) {
    let code: string | null = null;
    let message = body;
    try {
      const parsed = JSON.parse(body) as { code?: string; message?: string };
      code = parsed.code ?? null;
      message = parsed.message ?? body;
    } catch {
      // non-JSON error body; keep raw text
    }
    super(`Supabase ${status}: ${message}`);
    this.status = status;
    this.code = code;
    // PGRST205: PostgREST cannot find the table in its schema cache.
    // PGRST204: a body column is not in the schema cache (partial schema).
    // 42P01: Postgres "relation does not exist". 42703: column missing
    // (schema migrated partially). All mean "run the migration".
    this.tableMissing =
      code === 'PGRST205' ||
      code === 'PGRST204' ||
      code === '42P01' ||
      code === '42703' ||
      status === 404;
  }
}

const baseHeaders: Record<string, string> = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

export interface SbOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** PostgREST Prefer header, e.g. resolution=merge-duplicates. */
  prefer?: string;
}

// A hung connection must never leave the cockpit on its loading line forever.
const TIMEOUT_MS = 10_000;

/** Fetch a PostgREST path like `/themes?order=updated_at.desc`. Returns the
 * parsed JSON body, or [] for empty responses. Throws SupabaseError. */
export async function sbFetch<T = unknown>(path: string, options: SbOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...baseHeaders };
  if (options.prefer) headers.Prefer = options.prefer;

  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new SupabaseError(res.status, await res.text());
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : []) as T;
}
