// Supabase REST access for manifold. Mirrors the app's supabaseClient.ts
// (sbFetch over PostgREST) so both sides speak to the same tables the same
// way. Writes require a key; reads and writes share one code path.
import type { ManifoldConfig } from './env.ts';

export class SupabaseError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`Supabase ${status}: ${body.slice(0, 400)}`);
    this.status = status;
    this.body = body;
  }
}

const TIMEOUT_MS = 15_000;

export interface SbOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** PostgREST Prefer header, e.g. resolution=merge-duplicates. */
  prefer?: string;
}

export interface SupabaseClient {
  fetch<T = unknown>(path: string, options?: SbOptions): Promise<T>;
}

export function makeSupabase(config: ManifoldConfig): SupabaseClient {
  if (!config.supabaseKey) {
    throw new Error(
      'No Supabase key. Set SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY in the environment (repo secrets on GitHub Actions, or a local .env). See .env.example.',
    );
  }
  const key = config.supabaseKey;

  async function once<T>(path: string, options: SbOptions): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    };
    if (options.prefer) headers.Prefer = options.prefer;
    const res = await fetch(`${config.supabaseUrl}/rest/v1${path}`, {
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

  return {
    async fetch<T = unknown>(path: string, options: SbOptions = {}): Promise<T> {
      const method = options.method ?? 'GET';
      try {
        return await once<T>(path, options);
      } catch (err) {
        // One retry for idempotent calls on transient failures (network
        // blip, timeout, 5xx). POSTs never retry: editions must not risk a
        // double insert.
        const retryable = method === 'GET' || method === 'PATCH';
        const transient =
          !(err instanceof SupabaseError) || err.status >= 500 || err.status === 429;
        if (!retryable || !transient) throw err;
        await new Promise((r) => setTimeout(r, 2000));
        return once<T>(path, options);
      }
    },
  };
}

/** True when a Supabase error means the table has not been migrated yet, so
 * a read can degrade to empty instead of crashing (mirrors the app's
 * SupabaseError.tableMissing, src/data/supabaseClient.ts). manifold's own
 * error carries only status + body, so this sniffs both. */
export function isTableMissing(err: unknown): boolean {
  if (!(err instanceof SupabaseError)) return false;
  if (err.status === 404) return true;
  return /PGRST205|PGRST204|42P01|42703/.test(err.body);
}
