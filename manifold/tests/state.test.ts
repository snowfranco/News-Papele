// Regression tests for manifold state durability (manifold/src/state.ts).
//
// The bug these lock down: loadState must degrade to empty ONLY when the table
// is genuinely missing. On a transient read error (timeout, 5xx, reset) it must
// RETHROW, because a caller that loaded empty and then saved would upsert an
// empty blob over the tenant's whole state row and wipe every accumulated park,
// note, signal, and assignment. Found by adversarial review of the extraction
// (docs/manifold-extraction-report.md). No key and no real network: a fake
// SupabaseClient drives the branches, so this runs in CI.
import { describe, it, expect } from 'vitest';
import { loadState } from '../src/state.ts';
import { SupabaseError, type SupabaseClient } from '../src/supabase.ts';

function throwingClient(err: unknown): SupabaseClient {
  return { fetch: async () => { throw err; } } as SupabaseClient;
}
function returningClient(value: unknown): SupabaseClient {
  return { fetch: async () => value } as unknown as SupabaseClient;
}

const EMPTY = { parked: [], notes: [], signals: [], assignments: [], handoffs: [] };

describe('manifold state durability', () => {
  it('degrades to empty when the table is missing (404)', async () => {
    const s = await loadState(throwingClient(new SupabaseError(404, 'Not Found')), 'default');
    expect(s).toEqual(EMPTY);
  });

  it('degrades to empty when the table is missing (PGRST205 in the body)', async () => {
    const err = new SupabaseError(400, '{"code":"PGRST205","message":"Could not find the table in the schema cache"}');
    const s = await loadState(throwingClient(err), 'default');
    expect(s).toEqual(EMPTY);
  });

  it('RETHROWS a transient 5xx so a later save cannot clobber the state row', async () => {
    await expect(
      loadState(throwingClient(new SupabaseError(503, 'service unavailable')), 'default'),
    ).rejects.toThrow();
  });

  it('RETHROWS a 429 rate-limit rather than degrading to empty', async () => {
    await expect(
      loadState(throwingClient(new SupabaseError(429, 'Too Many Requests')), 'default'),
    ).rejects.toThrow();
  });

  it('RETHROWS a timeout-style error that is not a SupabaseError', async () => {
    await expect(
      loadState(throwingClient(new Error('The operation was aborted due to timeout')), 'default'),
    ).rejects.toThrow();
  });

  it('returns normalized empty state when the row is genuinely absent (successful empty read)', async () => {
    const s = await loadState(returningClient([]), 'default');
    expect(s).toEqual(EMPTY);
  });

  it('normalizes a partial state row, filling every missing array', async () => {
    const client = returningClient([{ state: { parked: [{ ts: 't', themeId: null, itemIds: ['x'], label: 'l' }] } }]);
    const s = await loadState(client, 'default');
    expect(s.parked).toHaveLength(1);
    expect(s.notes).toEqual([]);
    expect(s.signals).toEqual([]);
    expect(s.assignments).toEqual([]);
    expect(s.handoffs).toEqual([]);
  });
});
