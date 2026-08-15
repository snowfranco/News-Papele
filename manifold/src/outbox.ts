// Slice B: the outbox router. The outbox is the human-to-manifold queue.
// Simple intents (park, note, reading signals, assign-to-theme) are applied
// to manifold's own state and marked done; anything that needs an operator
// decision or a future overseer (draft-position, publish-column, and unknown
// kinds) is RECORDED durably in manifold state and marked seen (in flight
// elsewhere). Nothing is deleted; nothing loops.
//
// In Mission Control the routed records appended to queues/*.jsonl for the
// Sphere overseer. That repo is gone; the routing record now lives in
// manifold state (state.handoffs), durable and idempotent, for a future
// overseer to read (state.ts HandoffRecord; docs/adr/0001-manifold-runtime.md).
// The routing taxonomy (which kinds apply vs route) is unchanged.
import type { OutboxItem } from './app-contract.ts';
import type { SupabaseClient } from './supabase.ts';
import { hasOutboxId, loadState, saveState, type ManifoldState } from './state.ts';
import { torontoIso } from './time.ts';

export interface RoutedItem {
  id: string;
  kind: string;
  label: string;
  action: 'applied' | 'routed-decision' | 'routed-handoff';
  detail: string;
  newStatus: 'seen' | 'done';
  /** Set when persisting this item failed; it stays queued for the next sweep. */
  error?: string;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Item ids a park payload references. Two shapes exist in the wild: the
 * edition view parks with a plural itemIds array, the Feeds tab parks with
 * ParkItemPayload's singular itemId (src/types.ts). Reading only one shape
 * silently drops the other's parks. */
export function parkPayloadItemIds(payload: Record<string, unknown>): string[] {
  const ids = strArray(payload['itemIds']);
  const single = str(payload['itemId']);
  if (single && !ids.includes(single)) ids.push(single);
  return ids;
}

/** Pure routing decision for one item; the caller persists the effects. */
export function routeItem(item: OutboxItem): RoutedItem {
  const themeId = str(item.payload['themeId']);
  const itemIds = parkPayloadItemIds(item.payload);

  switch (item.kind) {
    case 'note':
    case 'add-note':
      return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        action: 'applied',
        detail: 'attached to manifold state; the next editorial pass reads it',
        newStatus: 'done',
      };
    case 'park':
      return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        action: 'applied',
        detail: themeId
          ? `theme ${themeId} marked parked in manifold state`
          : `items [${itemIds.join(', ')}] marked parked in manifold state`,
        newStatus: 'done',
      };
    case 'assign-to-theme': {
      // manifold owns theme creation and reconciliation (AssignToThemePayload,
      // src/types.ts): applied here as an assignment the next editorial pass
      // honors, never handed to another agent.
      const itemId = str(item.payload['itemId']);
      const newLabel = str(item.payload['newThemeLabel']);
      return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        action: 'applied',
        detail: newLabel
          ? `item ${itemId ?? '(unknown)'} assigned to new theme "${newLabel}"; the next editorial pass reconciles it`
          : `item ${itemId ?? '(unknown)'} assigned to theme ${themeId ?? '(unknown)'}; the next editorial pass reconciles it`,
        newStatus: 'done',
      };
    }
    case 'start-reading':
    case 'read-next':
      return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        action: 'applied',
        detail: 'recorded as a reader signal for the next pass',
        newStatus: 'done',
      };
    case 'sources-updated':
      return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        action: 'applied',
        detail: 'noted; every pass reads context fresh',
        newStatus: 'done',
      };
    case 'request-edition':
      return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        action: 'applied',
        detail: 'edition requested; run `npm run manifold:edition` or wait for the scheduled pass',
        newStatus: 'done',
      };
    case 'draft-position':
      return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        action: 'routed-decision',
        detail: `decision card: draft a position on theme ${themeId ?? '(unknown)'}; recorded in manifold state for an operator go/no-go, marked seen`,
        newStatus: 'seen',
      };
    case 'publish-column':
      return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        action: 'routed-decision',
        detail: `publish gate for "${item.label}"; recorded in manifold state for an operator go/no-go, marked seen`,
        newStatus: 'seen',
      };
    default:
      // send-to-project, challenge-response, and anything a future app
      // version adds: record as a handoff for a future overseer.
      return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        action: 'routed-handoff',
        detail: `handoff recorded for a future overseer: ${item.kind} "${item.label}"; marked seen`,
        newStatus: 'seen',
      };
  }
}

/** Apply one item's effect to manifold state. Idempotent: an item whose
 * outboxId is already recorded is skipped, so a sweep that died between
 * saving state and PATCHing the row can rerun safely. */
function applyToState(state: ManifoldState, item: OutboxItem): void {
  if (hasOutboxId(state, item.id)) return;
  const ts = torontoIso();
  const themeId = str(item.payload['themeId']);
  const itemId = str(item.payload['itemId']);
  const itemIds = parkPayloadItemIds(item.payload);

  if (item.kind === 'note' || item.kind === 'add-note') {
    // The app puts the note body in payload.note for add-note (the label is
    // only a caption like "note on <theme>"); the command bar's plain
    // 'note' carries the text as the label. A note referencing a theme or
    // an item keeps that reference in the text the next pass reads.
    const body = str(item.payload['note']) ?? item.label;
    const ref = themeId ? `[theme ${themeId}] ` : itemId ? `[item ${itemId}] ` : '';
    state.notes.push({ ts, text: `${ref}${body}`, source: str(item.payload['source']) ?? item.kind, outboxId: item.id });
  } else if (item.kind === 'park') {
    state.parked.push({ ts, themeId, itemIds, label: item.label, outboxId: item.id });
  } else if (item.kind === 'assign-to-theme') {
    state.assignments.push({
      ts,
      itemId: itemId ?? '(unknown)',
      themeId,
      newThemeLabel: str(item.payload['newThemeLabel']),
      label: item.label,
      outboxId: item.id,
    });
  } else if (item.kind === 'start-reading' || item.kind === 'read-next') {
    state.signals.push({ ts, kind: item.kind, themeId, itemIds, label: item.label, outboxId: item.id });
  } else if (item.kind === 'request-edition') {
    state.notes.push({ ts, text: `reader requested an edition: ${item.label}`, source: item.kind, outboxId: item.id });
  }
}

/** Record a routed item (decision or handoff) into manifold state. Idempotent
 * by outboxId, the extracted equivalent of the Mission Control queueContains
 * guard, so a sweep that died before flipping the row never double-records. */
function recordRouting(state: ManifoldState, item: OutboxItem, decision: RoutedItem): void {
  if (hasOutboxId(state, item.id)) return;
  state.handoffs.push({
    ts: torontoIso(),
    route: decision.action === 'routed-decision' ? 'decision' : 'handoff',
    kind: item.kind,
    subject: `${item.kind}: ${item.label}`,
    note: decision.detail,
    outboxId: item.id,
  });
}

export async function processOutbox(
  sb: SupabaseClient,
  items: OutboxItem[],
  tenant: string,
  dryRun: boolean,
): Promise<RoutedItem[]> {
  const state = await loadState(sb, tenant);
  const routed: RoutedItem[] = [];

  for (const item of items) {
    const decision = routeItem(item);
    routed.push(decision);
    if (dryRun) continue;

    try {
      // Persist the effect durably BEFORE flipping the row's status, and
      // make every effect idempotent, so a failure at any point leaves the
      // item queued and the next sweep neither loses nor duplicates it.
      if (decision.action === 'applied') {
        applyToState(state, item);
      } else {
        recordRouting(state, item, decision);
      }
      await saveState(sb, tenant, state);

      await sb.fetch(`/outbox?id=eq.${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: { status: decision.newStatus },
        prefer: 'return=minimal',
      });
    } catch (err) {
      decision.error = err instanceof Error ? err.message : String(err);
      decision.detail += ' (persist failed; item stays queued for the next sweep)';
    }
  }

  return routed;
}
