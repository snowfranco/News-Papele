// manifold's own working state: parks, reader notes, reading signals, theme
// assignments, and routing records consumed or produced by the outbox sweep
// and the next editorial pass.
//
// Storage moved from a Mission Control file (state/state.json) to a Supabase
// table (manifold_state, supabase/migrations/20260815000000_manifold_state.sql)
// so the extracted agent keeps no state on the ephemeral GitHub Actions
// runner: a fresh runner every run means a file would vanish between the
// sweep that records a park and the edition that must honor it. The shape,
// the outbox-id idempotency guard, and the durability contract (persist the
// effect before flipping the outbox row) are unchanged; only the backend is
// (docs/adr/0001-manifold-runtime.md). This also satisfies the app rule
// "Supabase for state that must sync, never localStorage" (AGENTS.md).
import { isTableMissing, type SupabaseClient } from './supabase.ts';

export interface ParkMark {
  ts: string;
  themeId: string | null;
  itemIds: string[];
  label: string;
  /** Outbox row this came from; makes re-application idempotent. */
  outboxId?: string;
}

export interface ReaderNote {
  ts: string;
  text: string;
  source: string;
  outboxId?: string;
}

export interface ReaderSignal {
  ts: string;
  kind: 'start-reading' | 'read-next';
  themeId: string | null;
  itemIds: string[];
  label: string;
  outboxId?: string;
}

/** A reader assign-to-theme intent (AssignToThemePayload in the app
 * contract): exactly one of themeId or newThemeLabel is set. manifold owns
 * theme creation and reconciliation, so these are applied here and consumed
 * by the next editorial pass, never handed to another agent. */
export interface ThemeAssignment {
  ts: string;
  itemId: string;
  themeId: string | null;
  newThemeLabel: string | null;
  label: string;
  outboxId?: string;
}

/** An outbox item the sweep could not simply apply and instead routed: a
 * decision card (draft-position, publish-column) or a handoff (send-to-project
 * and any future kind). In Mission Control these appended to queues/*.jsonl
 * for the Sphere overseer; that repo is gone, so the record lives here now,
 * durable and idempotent, for a future overseer to read (OVERLAY.md handoff
 * target; docs/adr/0001-manifold-runtime.md). Recording it is the extracted
 * equivalent of the queue append; the outbox row itself moves to 'seen'. */
export interface HandoffRecord {
  ts: string;
  /** 'decision' (holds for an operator go/no-go) or 'handoff' (routed work). */
  route: 'decision' | 'handoff';
  kind: string;
  subject: string;
  note: string;
  outboxId?: string;
}

export interface ManifoldState {
  parked: ParkMark[];
  notes: ReaderNote[];
  signals: ReaderSignal[];
  assignments: ThemeAssignment[];
  handoffs: HandoffRecord[];
}

const KEEP = 500;

function empty(): ManifoldState {
  return { parked: [], notes: [], signals: [], assignments: [], handoffs: [] };
}

function normalize(raw: Partial<ManifoldState> | null | undefined): ManifoldState {
  return {
    parked: raw?.parked ?? [],
    notes: raw?.notes ?? [],
    signals: raw?.signals ?? [],
    assignments: raw?.assignments ?? [],
    handoffs: raw?.handoffs ?? [],
  };
}

/** Read the tenant's state row.
 *
 * Degrades to empty state ONLY when the table has not been migrated yet (or
 * the row is genuinely absent, which a successful read returns as empty): the
 * editorial pass still runs on a fresh project, it just carries no accumulated
 * parks or notes.
 *
 * A transient or otherwise unknown read error (a timeout, a 5xx, a connection
 * reset on the Actions runner) is RETHROWN, never degraded to empty. This
 * matters because callers save after loading: a sweep or the state import that
 * degraded to empty here would then upsert that empty blob over the tenant's
 * whole row and wipe every accumulated park, note, signal, and assignment (the
 * upsert replaces the jsonb wholesale). The file version could not fail
 * transiently, so it degraded safely; the networked version must abort and let
 * the caller retry, the same way saveState failures already leave work queued.
 * A rethrow also keeps the exclusion set honest: an edition never drops a
 * parked item (and so never leads with it) just because one read blipped. */
export async function loadState(sb: SupabaseClient, tenant: string): Promise<ManifoldState> {
  try {
    const rows = await sb.fetch<{ state?: Partial<ManifoldState> }[]>(
      `/manifold_state?tenant=eq.${encodeURIComponent(tenant)}&select=state&limit=1`,
    );
    return normalize(rows[0]?.state);
  } catch (err) {
    if (isTableMissing(err)) {
      console.warn(
        'manifold: manifold_state table not found; running with empty state. Run supabase/migrations/20260815000000_manifold_state.sql.',
      );
      return empty();
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/** True when any state entry already records this outbox row. */
export function hasOutboxId(state: ManifoldState, outboxId: string): boolean {
  return (
    state.parked.some((p) => p.outboxId === outboxId) ||
    state.notes.some((n) => n.outboxId === outboxId) ||
    state.signals.some((s) => s.outboxId === outboxId) ||
    state.assignments.some((a) => a.outboxId === outboxId) ||
    state.handoffs.some((h) => h.outboxId === outboxId)
  );
}

/** Upsert the tenant's state row. Throws on failure so the sweep leaves the
 * triggering outbox item queued for the next run (durability contract,
 * src/outbox.ts), the same way the file version let a write error propagate
 * rather than reporting a park it had not persisted. */
export async function saveState(sb: SupabaseClient, tenant: string, state: ManifoldState): Promise<void> {
  const trimmed: ManifoldState = {
    parked: state.parked.slice(-KEEP),
    notes: state.notes.slice(-KEEP),
    signals: state.signals.slice(-KEEP),
    assignments: state.assignments.slice(-KEEP),
    handoffs: state.handoffs.slice(-KEEP),
  };
  await sb.fetch('/manifold_state?on_conflict=tenant', {
    method: 'POST',
    body: [{ tenant, state: trimmed, updated_at: new Date().toISOString() }],
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}
