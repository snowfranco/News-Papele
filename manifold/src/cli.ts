// manifold CLI. Three commands, all runnable by the operator by hand and by
// the scheduled GitHub Actions workflows:
//   tsx manifold/src/cli.ts edition [--dry-run] [--model <id>] [--max-attempts N]
//   tsx manifold/src/cli.ts outbox  [--dry-run]
//   tsx manifold/src/cli.ts ingest  [--dry-run]
// (or the npm scripts: manifold:edition, manifold:edition:dry, manifold:sweep,
// manifold:sweep:dry, manifold:ingest, manifold:ingest:dry). Exit codes: 0
// success, 1 gate rejection or processing failure, 2 usage or configuration
// error.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROOT, loadConfig } from './env.ts';
import { makeSupabase } from './supabase.ts';
import { makeClaude } from './claude.ts';
import { fetchPassInputs, fetchQueuedOutbox, viableItems } from './inputs.ts';
import { runEditorialPass } from './run.ts';
import { writePass } from './writer.ts';
import { writeRunReport } from './report.ts';
import { processOutbox } from './outbox.ts';
import { formatIngestReport, runIngestion } from './ingest.ts';

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

async function ingestCommand(args: string[]): Promise<number> {
  const config = loadConfig();
  const dryRun = flag(args, '--dry-run');
  const sb = makeSupabase(config);
  if (config.anonFallback) {
    console.warn(
      'manifold: running on the anon key (SUPABASE_SERVICE_ROLE_KEY unset). Works while RLS is allow-all; set the service key for anything real.',
    );
  }

  console.log(`manifold: ingesting feeds from ${config.supabaseUrl} (tenant ${config.tenant}) ...`);
  const report = await runIngestion(sb, config, dryRun);
  console.log(
    dryRun
      ? `manifold: dry run, ${report.itemsFetched} items would be upserted from ${report.feedsOk}/${report.feedsAttempted} feeds`
      : `manifold: ${report.itemsUpserted} items upserted from ${report.feedsOk}/${report.feedsAttempted} feeds`,
  );
  for (const f of report.perFeed) {
    if (f.error) console.error(`manifold: [FAIL] ${f.feedName}: ${f.error}`);
    else console.log(`manifold: [ok]   ${f.feedName}: fetched ${f.fetched}, upserted ${f.upserted}${dryRun ? ' (dry run)' : ''}`);
  }

  const REPORT_DIR = join(AGENT_ROOT, 'reports');
  mkdirSync(REPORT_DIR, { recursive: true });
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const path = join(REPORT_DIR, `${date}-ingest${dryRun ? '-dry-run' : ''}.md`);
  writeFileSync(path, formatIngestReport(report, dryRun));
  console.log(`manifold: run report at ${path}`);

  // A run with zero enabled feeds is a config gap, not an ingestion failure:
  // exit 0 with the note above. A run where every attempted feed failed IS
  // an ingestion failure and should page the operator.
  if (report.feedsAttempted > 0 && report.feedsOk === 0) return 1;
  return 0;
}

const [, , command, ...rest] = process.argv;

try {
  let code: number;
  if (command === 'edition') code = await editionCommand(rest);
  else if (command === 'outbox') code = await outboxCommand(rest);
  else if (command === 'ingest') code = await ingestCommand(rest);
  else {
    console.error(
      'usage: tsx manifold/src/cli.ts <edition|outbox|ingest> [--dry-run] [--model <id>] [--max-attempts N]',
    );
    code = 2;
  }
  process.exit(code);
} catch (err) {
  console.error(`manifold: fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
