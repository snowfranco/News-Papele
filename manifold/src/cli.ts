// manifold CLI. Two commands, both runnable by the operator by hand and by
// the scheduled GitHub Actions workflows:
//   tsx manifold/src/cli.ts edition [--dry-run] [--model <id>] [--max-attempts N]
//   tsx manifold/src/cli.ts outbox  [--dry-run]
// (or the npm scripts: manifold:edition, manifold:edition:dry, manifold:sweep,
// manifold:sweep:dry). Exit codes: 0 success, 1 gate rejection or processing
// failure, 2 usage or configuration error.
import { loadConfig } from './env.ts';
import { makeSupabase } from './supabase.ts';
import { makeClaude } from './claude.ts';
import {
  fetchColumnPositions,
  fetchManifoldReplies,
  fetchPassInputs,
  fetchQueuedOutbox,
  fetchReplyCorpus,
  viableItems,
} from './inputs.ts';
import { runEditorialPass } from './run.ts';
import { runReplyGate } from './gate.ts';
import { runDevilsAdvocatePass, type ReplyInputs } from './devils_advocate.ts';
import { writePass, writeReply } from './writer.ts';
import { writeRunReport } from './report.ts';
import { processOutbox } from './outbox.ts';

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
}

async function editionCommand(args: string[]): Promise<number> {
  const config = loadConfig();
  if (option(args, '--model')) config.model = option(args, '--model') as string;
  if (option(args, '--max-attempts')) config.maxAttempts = Number(option(args, '--max-attempts'));
  const dryRun = flag(args, '--dry-run');

  const sb = makeSupabase(config);
  const claude = makeClaude(config.model, config.anthropicApiKey);
  if (config.anonFallback) {
    console.warn(
      'manifold: running on the anon key (SUPABASE_SERVICE_ROLE_KEY unset). Works while RLS is allow-all; set the service key for anything real.',
    );
  }

  console.log(`manifold: gathering inputs from ${config.supabaseUrl} ...`);
  const inputs = await fetchPassInputs(sb, config);
  const viable = viableItems(inputs).length;
  console.log(
    `manifold: ${inputs.items.length} items in window (${viable} viable after read/park exclusion), ${inputs.existingThemes.length} themes carried, edition_no ${inputs.maxEditionNo} -> ${inputs.maxEditionNo + 1}`,
  );
  if (inputs.items.length === 0 || viable === 0) {
    const why =
      inputs.items.length === 0
        ? 'corpus empty: no recent or unread reading_items; no editorial pass attempted'
        : `every item in the window is excluded (the reader read or parked all ${inputs.items.length}); a smaller edition beats a recycled one, and zero candidates means no edition at all`;
    console.error(`manifold: ${why}. No edition written.`);
    const reportFile = writeRunReport(
      inputs,
      {
        ok: false,
        built: null,
        gate: null,
        attempts: [{ attempt: 0, errors: [why] }],
        rawReply: null,
      },
      null,
      { transport: claude.describe(), dryRun },
    );
    console.error(`manifold: run report at ${reportFile}`);
    return 1;
  }

  console.log(`manifold: one editorial pass on ${claude.describe()} ...`);
  let result;
  try {
    result = await runEditorialPass(inputs, claude, config.maxAttempts);
  } catch (err) {
    // Transport failure (model unreachable, CLI session limit): still a
    // run, still reported, exit 1 so the operator reads it as retryable.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`manifold: model transport failed: ${msg}`);
    const reportFile = writeRunReport(
      inputs,
      { ok: false, built: null, gate: null, attempts: [{ attempt: 0, errors: [`model transport failed: ${msg}`] }], rawReply: null },
      null,
      { transport: claude.describe(), dryRun, failure: `model transport failed before any output: ${msg.slice(0, 300)}` },
    );
    console.error(`manifold: run report at ${reportFile}`);
    return 1;
  }

  let receipt = null;
  let writeFailure: string | undefined;
  if (result.ok && result.built && !dryRun) {
    try {
      receipt = await writePass(sb, result.built);
      console.log(
        `manifold: wrote edition ${receipt.editionNo} (${receipt.editionId}), ${receipt.themesUpserted} themes, ${receipt.linksInserted} links.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeFailure = `Supabase write failed after the gate passed: ${msg.slice(0, 300)}. Themes may have landed before the failure; the edition row did not (writes run themes, links, edition in that order). Rerun when Supabase is reachable.`;
      console.error(`manifold: ${writeFailure}`);
    }
  } else if (result.ok && dryRun) {
    console.log('manifold: dry run, gate passed, nothing written.');
  } else if (result.gate === null) {
    console.error(
      `manifold: no model reply parsed and validated in ${result.attempts.length} attempt(s); the gate never ran. Nothing written.`,
    );
    for (const err of result.attempts.at(-1)?.errors.slice(0, 5) ?? []) console.error(`  - ${err}`);
  } else {
    console.error(`manifold: gate REJECTED the output after ${result.attempts.length} attempt(s). Nothing written.`);
    for (const err of result.gate.errors.slice(0, 10)) console.error(`  - ${err}`);
  }

  const reportFile = writeRunReport(inputs, result, receipt, {
    transport: claude.describe(),
    dryRun,
    failure: writeFailure,
  });
  console.log(`manifold: run report at ${reportFile}`);
  return result.ok && !writeFailure ? 0 : 1;
}

async function outboxCommand(args: string[]): Promise<number> {
  const config = loadConfig();
  const dryRun = flag(args, '--dry-run');
  const sb = makeSupabase(config);
  if (config.anonFallback) {
    console.warn(
      'manifold: running on the anon key (SUPABASE_SERVICE_ROLE_KEY unset). Works while RLS is allow-all; set the service key for anything real.',
    );
  }

  let items;
  try {
    items = await fetchQueuedOutbox(sb);
  } catch (err) {
    console.error(`manifold: outbox read failed (retryable): ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  if (items.length === 0) {
    console.log('manifold: outbox empty, nothing to route.');
    return 0;
  }

  let routed;
  try {
    routed = await processOutbox(sb, items, config.tenant, dryRun);
  } catch (err) {
    // The only throw out of processOutbox is a state read failure before any
    // item is touched (loadState rethrows transient errors so a degraded-empty
    // load can never clobber the state row). Nothing was persisted; every item
    // stays queued for the next sweep.
    console.error(
      `manifold: outbox routing aborted before processing (retryable): ${err instanceof Error ? err.message : String(err)}. Nothing persisted; all items stay queued.`,
    );
    return 1;
  }
  for (const r of routed) {
    console.log(`manifold: [${r.action}] ${r.kind} "${r.label}" -> ${r.error ? 'still queued' : r.newStatus}${dryRun ? ' (dry run)' : ''}`);
    console.log(`  ${r.detail}`);
    if (r.error) console.error(`  error: ${r.error}`);
  }
  const failures = routed.filter((r) => r.error).length;
  console.log(
    `manifold: ${routed.length} outbox item(s) processed${failures > 0 ? `, ${failures} failed and stay queued` : ''}${dryRun ? ', dry run, nothing persisted' : ''}.`,
  );
  return failures > 0 ? 1 : 0;
}

async function devilsAdvocateCommand(args: string[]): Promise<number> {
  const config = loadConfig();
  if (option(args, '--model')) config.model = option(args, '--model') as string;
  if (option(args, '--max-attempts')) config.maxAttempts = Number(option(args, '--max-attempts'));
  const dryRun = flag(args, '--dry-run');

  const sb = makeSupabase(config);
  const claude = makeClaude(config.model, config.anthropicApiKey);
  if (config.anonFallback) {
    console.warn(
      'manifold: running on the anon key (SUPABASE_SERVICE_ROLE_KEY unset). Works while RLS is allow-all; set the service key for anything real.',
    );
  }

  console.log(`manifold: gathering columns and existing replies from ${config.supabaseUrl} ...`);
  const [columns, replies, items] = await Promise.all([
    fetchColumnPositions(sb),
    fetchManifoldReplies(sb),
    fetchReplyCorpus(sb, config.itemCap),
  ]);

  const answered = new Set(replies.filter((r) => r.kind === 'devils_advocate').map((r) => r.positionId));
  const pending = columns.filter((c) => !answered.has(c.id));
  console.log(
    `manifold: ${columns.length} column(s), ${answered.size} already answered, ${pending.length} pending, ${items.length} corpus items.`,
  );
  if (pending.length === 0) {
    console.log('manifold: nothing to push back on. Done.');
    return 0;
  }
  if (items.length === 0) {
    console.error(
      'manifold: corpus empty; a devils-advocate reply must cite reading_items. Nothing written.',
    );
    return 1;
  }

  let failures = 0;
  for (const column of pending) {
    const input: ReplyInputs = {
      positionId: column.id,
      positionTitle: column.title,
      positionBody: column.body,
      themeLabel: null,
      items,
      nowIso: new Date().toISOString(),
    };
    console.log(`manifold: composing devils-advocate reply for "${column.title}" (${column.id}) on ${claude.describe()} ...`);
    let result;
    try {
      result = await runDevilsAdvocatePass(input, claude, (built, ctx) => runReplyGate(ctx, built), config.maxAttempts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`manifold: model transport failed for ${column.id}: ${msg}`);
      failures++;
      continue;
    }

    if (!result.ok || !result.built) {
      console.error(`manifold: gate REJECTED the reply for ${column.id} after ${result.attempts.length} attempt(s). Nothing written for this column.`);
      for (const err of result.attempts.at(-1)?.errors.slice(0, 6) ?? []) console.error(`  - ${err}`);
      failures++;
      continue;
    }

    if (dryRun) {
      console.log(`manifold: dry run, gate passed for ${column.id}, nothing written.`);
      continue;
    }

    try {
      await writeReply(sb, result.built);
      console.log(`manifold: wrote devils-advocate reply for ${column.id}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // The unique (position_id, kind) constraint is the idempotency backstop
      // (23505): a concurrent run that landed the reply first is not a failure.
      if (/23505/.test(msg)) {
        console.log(`manifold: reply for ${column.id} already exists (concurrent run); skipping.`);
        continue;
      }
      console.error(`manifold: Supabase write failed for ${column.id}: ${msg}`);
      failures++;
    }
  }

  return failures > 0 ? 1 : 0;
}

const [, , command, ...rest] = process.argv;

try {
  let code: number;
  if (command === 'edition') code = await editionCommand(rest);
  else if (command === 'outbox') code = await outboxCommand(rest);
  else if (command === 'devils-advocate') code = await devilsAdvocateCommand(rest);
  else {
    console.error(
      'usage: tsx manifold/src/cli.ts <edition|outbox|devils-advocate> [--dry-run] [--model <id>] [--max-attempts N]',
    );
    code = 2;
  }
  process.exit(code);
} catch (err) {
  console.error(`manifold: fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
