// One-time state import: seeds manifold_state in Supabase from the working
// state that lived in the Mission Control repo before the extraction
// (manifold/state/seed-from-missioncontrol.json, copied verbatim from
// agents/manifold/state/state.json). Run once, with the service role key,
// so no reader intent (parks, notes, reading signals, theme assignments) is
// lost in the move:
//
//   npm run manifold:state:import
//
// Idempotent enough for a re-run: it MERGES the seed into any existing row by
// outboxId, so running it twice does not duplicate entries and never clobbers
// state the live sweep has since accumulated. Exit codes: 0 ok, 1 failure.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/env.ts';
import { makeSupabase } from '../src/supabase.ts';
import { loadState, saveState, hasOutboxId, type ManifoldState } from '../src/state.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(HERE, '..', 'state', 'seed-from-missioncontrol.json');

type WithOutbox = { outboxId?: string };

/** Append seed entries the live row does not already carry (by outboxId).
 * Entries without an outboxId are always appended (they cannot be de-duped),
 * but the shipped seed has an outboxId on every entry. */
function mergeMissing<T extends WithOutbox>(live: T[], seed: T[], has: (id: string) => boolean): T[] {
  const out = [...live];
  for (const entry of seed) {
    if (entry.outboxId && has(entry.outboxId)) continue;
    out.push(entry);
  }
  return out;
}

async function main(): Promise<number> {
  const config = loadConfig();
  if (config.anonFallback) {
    console.warn('manifold: importing on the anon key; set SUPABASE_SERVICE_ROLE_KEY for anything real.');
  }
  const sb = makeSupabase(config);

  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Partial<ManifoldState>;
  const live = await loadState(sb, config.tenant);

  const merged: ManifoldState = {
    parked: mergeMissing(live.parked, seed.parked ?? [], (id) => hasOutboxId(live, id)),
    notes: mergeMissing(live.notes, seed.notes ?? [], (id) => hasOutboxId(live, id)),
    signals: mergeMissing(live.signals, seed.signals ?? [], (id) => hasOutboxId(live, id)),
    assignments: mergeMissing(live.assignments, seed.assignments ?? [], (id) => hasOutboxId(live, id)),
    handoffs: live.handoffs,
  };

  await saveState(sb, config.tenant, merged);
  console.log(
    `manifold: imported state for tenant "${config.tenant}" -> ${merged.parked.length} parks, ${merged.notes.length} notes, ${merged.signals.length} signals, ${merged.assignments.length} assignments.`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`manifold: state import failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
