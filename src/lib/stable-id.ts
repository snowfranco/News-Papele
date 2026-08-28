// Deterministic id for feed articles so upserts dedupe across refreshes.
// Extracted from src/lib/format.ts so manifold (Node, no DOM) can share it:
// the app and the server-side ingester MUST produce identical ids for the
// same link, or dedup falls apart and the same article lands twice under
// different ids.
export function stableItemId(link: string): string {
  let hash = 5381;
  for (let i = 0; i < link.length; i++) {
    hash = (hash * 33) ^ link.charCodeAt(i);
  }
  return `feed-${(hash >>> 0).toString(36)}`;
}
