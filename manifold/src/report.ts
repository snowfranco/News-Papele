// Decision-grade run reports to manifold/reports/, house style: answer
// first, every claim cites the run's own numbers, under two pages. The
// directory is gitignored; on GitHub Actions the edition workflow uploads it
// as a build artifact so the operator can read a scheduled run's report
// without any run committing to the repo (.github/workflows/manifold-edition.yml).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROOT } from './env.ts';
import type { PassInputs } from './inputs.ts';
import type { PassResult } from './run.ts';
import type { WriteReceipt } from './writer.ts';

const REPORT_DIR = join(AGENT_ROOT, 'reports');

function torontoStamp(nowIso: string): { date: string; time: string } {
  const d = new Date(nowIso);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Toronto',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  return { date, time };
}

function reportPath(date: string, kind: string): string {
  let path = join(REPORT_DIR, `${date}-${kind}.md`);
  let n = 2;
  while (existsSync(path)) {
    path = join(REPORT_DIR, `${date}-${kind}-${n}.md`);
    n += 1;
  }
  return path;
}

export function writeRunReport(
  inputs: PassInputs,
  result: PassResult,
  receipt: WriteReceipt | null,
  meta: { transport: string; dryRun: boolean; failure?: string },
): string {
  const { date, time } = torontoStamp(inputs.nowIso);
  const checks = result.gate ? Object.entries(result.gate.checks) : [];
  const failedChecks = checks.filter(([, ok]) => !ok).map(([name]) => name);
  const excluded = new Set(inputs.excludedItemIds);
  const viableCount = inputs.items.filter((i) => !excluded.has(i.id)).length;

  // gate === null covers two distinct failures: nothing was attempted
  // (attempt 0, e.g. empty corpus), or the model replied maxAttempts times
  // but no reply ever parsed and validated, so the gate never ran.
  const neverAttempted = result.attempts.length === 1 && result.attempts[0]?.attempt === 0;
  const verdict = meta.failure
    ? `Run FAILED: ${meta.failure}`
    : result.ok
      ? receipt
        ? `Edition ${receipt.editionNo} written to Supabase: ${receipt.themesUpserted} themes upserted, ${receipt.linksInserted} links inserted, ${receipt.themesDecayed} carried themes decayed.`
        : 'Pass and gate succeeded; dry run, nothing written.'
      : result.gate === null
        ? neverAttempted
          ? 'Run aborted before the editorial pass (see attempt notes). Nothing was written.'
          : `No model reply parsed and validated in ${result.attempts.length} attempt(s); the gate never ran. Nothing was written.`
        : `Run REJECTED at the deterministic gate after ${result.attempts.length} attempt(s). Nothing was written.`;

  const lines: string[] = [
    `# manifold run: ${date} ${time} (America/Toronto)`,
    '',
    verdict,
    '',
    `- model: ${meta.transport}`,
    `- corpus: ${inputs.items.length} reading_items in the pass window, ${inputs.items.filter((i) => !i.read).length} unread`,
    `- exclusion set: ${inputs.excludedItemIds.length} handled item ids (read or parked); ${viableCount} of ${inputs.items.length} window items viable for lede/start_here`,
    `- context: ${(inputs.context?.projects ?? []).length} projects, ${inputs.existingThemes.length} existing themes carried in`,
    `- edition_no: ${result.built ? result.built.edition.edition_no : '(none)'}${inputs.maxEditionNo === 0 ? ' (first real edition; the cockpit was on its seed state)' : ''}`,
  ];

  if (result.gate) {
    lines.push('', '## Gate');
    lines.push(`- result: ${result.gate.pass ? 'PASS' : 'FAIL'} (${checks.length} deterministic checks)`);
    if (failedChecks.length > 0) lines.push(`- failed: ${failedChecks.join(', ')}`);
    for (const [name, ok] of checks) lines.push(`  - ${ok ? 'ok' : 'FAIL'}: ${name}`);
  }

  for (const attempt of result.attempts) {
    if (attempt.errors.length > 0) {
      lines.push('', `## Attempt ${attempt.attempt} rejections`);
      for (const err of attempt.errors.slice(0, 12)) lines.push(`- ${err}`);
    }
  }

  if (result.gate && result.gate.warnings.length > 0) {
    lines.push('', '## Warnings (non-blocking)');
    for (const warning of result.gate.warnings) lines.push(`- ${warning}`);
  }

  if (result.built) {
    const built = result.built;
    lines.push(
      '',
      '## What the pass produced',
      `- lede: "${built.edition.lede.title}" citing [${built.audit.lede.join(', ')}]`,
      `- emerging: ${built.edition.emerging.map((e) => `"${e.title}" (${e.lane})`).join('; ')}`,
      `- start_here: ${built.edition.start_here.map((s) => `"${s.title}" (${s.minutes}m)`).join('; ')}`,
      `- themes: ${built.themes.map((t) => `${t.id} (${t.lane}, heat ${t.heat})`).join(', ')}`,
    );
  }

  lines.push('', '-- manifold', '');

  mkdirSync(REPORT_DIR, { recursive: true });
  const path = reportPath(date, meta.dryRun ? 'dry-run' : 'edition');
  writeFileSync(path, lines.join('\n'));
  return path;
}
