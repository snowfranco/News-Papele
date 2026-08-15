// The evals runner. For every fixture: run the REAL editorial pass (same
// code path as production), apply the deterministic gate, apply the
// fixture's assertions, optionally run the LLM judge, and score against the
// thresholds and the golden floors. Results append to results/history.jsonl.
//
//   node evals/runner.ts [--fixture <name>] [--skip-judge] [--model <id>] [--bless]
//
// Exit codes: 0 all fixtures pass, 1 any failure or regression, 2 usage.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { z } from 'zod';
import { envVar, loadConfig } from '../src/env.ts';
import { makeClaude } from '../src/claude.ts';
import { buildExclusionSet, type PassInputs } from '../src/inputs.ts';
import { runEditorialPass } from '../src/run.ts';
import type { BuiltPass } from '../src/editorial.ts';
import { JUDGED_CRITERIA, judgePass, type JudgeVerdict } from './judge.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, 'fixtures');
const RESULTS_DIR = join(HERE, 'results');
const GOLDEN_PATH = join(HERE, 'golden', 'golden.json');

/** Every judged criterion must clear MIN_JUDGED; their mean must clear
 * MEAN_JUDGED. The deterministic checks have no threshold: all must pass. */
const MIN_JUDGED = 0.5;
const MEAN_JUDGED = 0.7;

// ------------------------------------------------------------ fixture shape

const fixtureSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  context: z.object({
    projects: z
      .array(z.object({ id: z.string(), label: z.string(), description: z.string().optional() }))
      .default([]),
    org_context: z.string().nullable().default(null),
  }),
  existing_themes: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        discipline: z.string(),
        lane: z.enum(['applied', 'horizon']),
        heat: z.number().min(0).max(1),
        mastery: z.enum(['unread', 'progress', 'position']),
        reads: z.number().int().min(0),
        days_since_update: z.number().min(0),
      }),
    )
    .default([]),
  state: z
    .object({
      parked: z
        .array(
          z.object({
            themeId: z.string().nullable(),
            itemIds: z.array(z.string()).default([]),
            label: z.string(),
          }),
        )
        .default([]),
      notes: z.array(z.object({ text: z.string(), source: z.string() })).default([]),
      signals: z
        .array(
          z.object({
            kind: z.enum(['start-reading', 'read-next']),
            themeId: z.string().nullable().default(null),
            itemIds: z.array(z.string()).default([]),
            label: z.string(),
          }),
        )
        .default([]),
    })
    .default({ parked: [], notes: [], signals: [] }),
  /** Extra item ids the reader handled outside state.parked, e.g. outbox
   * park rows the sweep has not applied yet. Joined with read items and
   * state parks into the exclusion set (PassInputs.excludedItemIds). */
  excluded_ids: z.array(z.string()).default([]),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      source: z.string(),
      days_ago: z.number().min(0),
      snippet: z.string().default(''),
      read: z.boolean().default(false),
      topics: z.array(z.string()).default([]),
      url: z.string().url().optional(),
    }),
  ),
  expect: z.object({
    lede_not_in: z.array(z.string()).optional(),
    /** No start_here entry may cite any of these ids. */
    start_here_not_in: z.array(z.string()).optional(),
    lede_in: z.array(z.string()).optional(),
    cited_somewhere: z.array(z.string()).optional(),
    /** At least one of these ids is cited by the lede OR an emerging card:
     * the placements a reader actually sees first. Use this for "the signal
     * must surface prominently"; leading with it satisfies it. */
    prominent_cites_any: z.array(z.string()).optional(),
    /** Strict variant: an emerging CARD must cite one of these. Only for
     * fixtures where card placement itself is the behavior under test. */
    emerging_cites_any: z.array(z.string()).optional(),
    min_horizon_emerging: z.number().int().min(0).optional(),
    max_themes: z.number().int().min(1).optional(),
    notes: z.string(),
  }),
});

type Fixture = z.infer<typeof fixtureSchema>;

function materialize(fixture: Fixture): PassInputs {
  const nowIso = new Date().toISOString();
  const now = Date.parse(nowIso);
  const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
  const state = {
    parked: fixture.state.parked.map((p) => ({ ts: nowIso, themeId: p.themeId, itemIds: p.itemIds, label: p.label })),
    notes: fixture.state.notes.map((n) => ({ ts: nowIso, text: n.text, source: n.source })),
    signals: fixture.state.signals.map((s) => ({ ts: nowIso, ...s })),
    assignments: [],
    handoffs: [],
  };
  const readIds = fixture.items.filter((i) => i.read).map((i) => i.id);
  return {
    items: fixture.items.map((i) => ({
      id: i.id,
      type: 'article' as const,
      title: i.title,
      url: i.url ?? `https://fixture.invalid/${i.id}`,
      snippet: i.snippet || null,
      topics: i.topics,
      read: i.read,
      addedAt: daysAgo(i.days_ago),
      sourceFeed: i.source,
      publishedAt: daysAgo(i.days_ago),
      origin: 'feed' as const,
      imagePreview: null,
    })),
    context: {
      id: 'fixture-context',
      tenant: 'default',
      sources: { feeds: [], blogs: [], resources: [] },
      projects: fixture.context.projects,
      orgContext: fixture.context.org_context,
      updatedAt: nowIso,
    },
    existingThemes: fixture.existing_themes.map((t) => ({
      id: t.id,
      label: t.label,
      discipline: t.discipline,
      lane: t.lane,
      heat: t.heat,
      mastery: t.mastery,
      why: '',
      reads: t.reads,
      // Carried-forward input themes need no backing ids; the gate checks the
      // themes a pass writes, not the ones it reads.
      itemIds: [],
      createdAt: daysAgo(t.days_since_update + 30),
      updatedAt: daysAgo(t.days_since_update),
    })),
    existingLinks: [],
    maxEditionNo: 0,
    recentLedeTitles: [],
    state,
    excludedItemIds: buildExclusionSet(readIds, fixture.excluded_ids, state),
    editionFloor: 3,
    nowIso,
  };
}

// -------------------------------------------------------------- assertions

interface AssertionResult {
  name: string;
  pass: boolean;
  detail: string;
}

function citedEverywhere(built: BuiltPass): Set<string> {
  const cited = new Set<string>(built.audit.lede);
  for (const ids of built.audit.emerging) for (const id of ids) cited.add(id);
  for (const id of built.audit.startHere) cited.add(id);
  for (const ids of Object.values(built.audit.themes)) for (const id of ids) cited.add(id);
  return cited;
}

function runAssertions(fixture: Fixture, built: BuiltPass): AssertionResult[] {
  const out: AssertionResult[] = [];
  const expect = fixture.expect;
  const ledeIds = new Set(built.audit.lede);
  const cited = citedEverywhere(built);

  if (expect.lede_not_in) {
    const hits = expect.lede_not_in.filter((id) => ledeIds.has(id));
    out.push({
      name: 'lede_not_in',
      pass: hits.length === 0,
      detail: hits.length === 0 ? 'lede avoided the banned items' : `lede cites banned item(s): ${hits.join(', ')}`,
    });
  }
  if (expect.start_here_not_in) {
    const startHere = new Set(built.audit.startHere);
    const hits = expect.start_here_not_in.filter((id) => startHere.has(id));
    out.push({
      name: 'start_here_not_in',
      pass: hits.length === 0,
      detail:
        hits.length === 0
          ? 'start_here avoided the banned items'
          : `start_here recommends banned item(s): ${hits.join(', ')}`,
    });
  }
  if (expect.lede_in) {
    const hit = expect.lede_in.some((id) => ledeIds.has(id));
    out.push({
      name: 'lede_in',
      pass: hit,
      detail: hit ? 'lede cites an expected item' : `lede cites none of: ${expect.lede_in.join(', ')}`,
    });
  }
  if (expect.cited_somewhere) {
    const missing = expect.cited_somewhere.filter((id) => !cited.has(id));
    out.push({
      name: 'cited_somewhere',
      pass: missing.length === 0,
      detail: missing.length === 0 ? 'all must-cite items surfaced' : `never cited: ${missing.join(', ')}`,
    });
  }
  if (expect.prominent_cites_any) {
    const prominent = new Set([...built.audit.lede, ...built.audit.emerging.flat()]);
    const hit = expect.prominent_cites_any.some((id) => prominent.has(id));
    out.push({
      name: 'prominent_cites_any',
      pass: hit,
      detail: hit
        ? 'the lede or an emerging entry cites an expected signal item'
        : 'neither the lede nor any emerging entry cites the expected signal',
    });
  }
  if (expect.emerging_cites_any) {
    const hit = built.audit.emerging.some((ids) => ids.some((id) => expect.emerging_cites_any?.includes(id)));
    out.push({
      name: 'emerging_cites_any',
      pass: hit,
      detail: hit ? 'an emerging entry cites an expected signal item' : 'no emerging entry cites the expected signal',
    });
  }
  if (expect.min_horizon_emerging !== undefined) {
    const n = built.edition.emerging.filter((e) => e.lane === 'horizon').length;
    out.push({
      name: 'min_horizon_emerging',
      pass: n >= expect.min_horizon_emerging,
      detail: `${n} horizon emerging entries (need ${expect.min_horizon_emerging})`,
    });
  }
  if (expect.max_themes !== undefined) {
    out.push({
      name: 'max_themes',
      pass: built.themes.length <= expect.max_themes,
      detail: `${built.themes.length} themes (max ${expect.max_themes})`,
    });
  }
  return out;
}

// ------------------------------------------------------------------ golden

type Golden = Record<string, { judged_floors: Partial<Record<string, number>> }>;

function loadGolden(): Golden {
  try {
    return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Golden;
  } catch {
    return {};
  }
}

// -------------------------------------------------------------------- main

function flag(name: string): boolean {
  return process.argv.includes(name);
}
function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const config = loadConfig();
if (option('--model')) config.model = option('--model') as string;
const skipJudge = flag('--skip-judge');
const bless = flag('--bless');
const only = option('--fixture');

const claude = makeClaude(config.model, config.anthropicApiKey);
const judgeModel = envVar('MANIFOLD_JUDGE_MODEL') ?? config.model;
const judgeClaude = makeClaude(judgeModel, config.anthropicApiKey);

const fixtureFiles = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .filter((f) => !only || f === `${only}.json` || f.replace(/\.json$/, '') === only)
  .sort();

if (fixtureFiles.length === 0) {
  console.error(only ? `no fixture named ${only}` : 'no fixtures found');
  process.exit(2);
}

let gitHead = 'unknown';
try {
  gitHead = execSync('git rev-parse --short HEAD', { cwd: HERE }).toString().trim();
} catch {
  // fine: reports still carry timestamps
}

const golden = loadGolden();
const newGolden: Golden = {};
let allPass = true;

console.log(`manifold evals: ${fixtureFiles.length} fixture(s), pass on ${claude.describe()}, judge on ${judgeModel}${skipJudge ? ' (judge SKIPPED)' : ''}\n`);

for (const file of fixtureFiles) {
  const fixture = fixtureSchema.parse(JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')));
  console.log(`=== ${fixture.name} ===`);
  console.log(`    ${fixture.description}`);

  const inputs = materialize(fixture);
  const result = await runEditorialPass(inputs, claude, config.maxAttempts);

  const deterministic: Record<string, boolean> = result.gate?.checks ?? {};
  const gatePassed = result.ok && result.built !== null;
  const assertions = gatePassed && result.built ? runAssertions(fixture, result.built) : [];
  const assertionsPassed = assertions.every((a) => a.pass);

  let judge: JudgeVerdict | null = null;
  let judgedPassed = true;
  const floors = golden[fixture.name]?.judged_floors ?? {};
  const regressions: string[] = [];

  if (gatePassed && result.built && !skipJudge) {
    judge = await judgePass(inputs, result.built, judgeClaude);
    const scores = Object.values(judge.scores);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    judgedPassed = scores.every((s) => s >= MIN_JUDGED) && mean >= MEAN_JUDGED;
    for (const criterion of JUDGED_CRITERIA) {
      const floor = floors[criterion];
      if (floor !== undefined && judge.scores[criterion] < floor) {
        regressions.push(`${criterion} ${judge.scores[criterion]} < golden floor ${floor}`);
      }
    }
  }

  const fixturePass = gatePassed && assertionsPassed && judgedPassed && regressions.length === 0;
  allPass = allPass && fixturePass;

  console.log(`    gate: ${gatePassed ? 'PASS' : 'FAIL'} (${result.attempts.length} attempt(s))`);
  if (!gatePassed) {
    for (const err of (result.gate?.errors ?? result.attempts.at(-1)?.errors ?? []).slice(0, 6)) {
      console.log(`      - ${err}`);
    }
  }
  for (const a of assertions) console.log(`    assert ${a.pass ? 'ok  ' : 'FAIL'} ${a.name}: ${a.detail}`);
  if (judge) {
    for (const criterion of JUDGED_CRITERIA) {
      console.log(`    judge  ${judge.scores[criterion].toFixed(2)} ${criterion}: ${(judge.rationales[criterion] ?? '').slice(0, 110)}`);
    }
  }
  if (regressions.length > 0) for (const r of regressions) console.log(`    REGRESSION ${r}`);
  console.log(`    fixture: ${fixturePass ? 'PASS' : 'FAIL'}\n`);

  // Only a healthy fixture may contribute floors: gate, assertions, and
  // judged thresholds must all hold. A floor regression alone does not
  // block, because re-blessing after a reviewed tradeoff is exactly what
  // --bless is for; what it must never do is make a genuinely red run
  // green (RUBRIC.md).
  if (judge && gatePassed && assertionsPassed && judgedPassed) {
    newGolden[fixture.name] = {
      judged_floors: Object.fromEntries(
        JUDGED_CRITERIA.map((c) => [c, Math.max(0, Math.round((judge.scores[c] - 0.15) * 100) / 100)]),
      ),
    };
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  appendFileSync(
    join(RESULTS_DIR, 'history.jsonl'),
    JSON.stringify({
      ts: new Date().toISOString(),
      git: gitHead,
      model: config.model,
      judge_model: skipJudge ? null : judgeModel,
      fixture: fixture.name,
      gate: gatePassed,
      deterministic,
      assertions: Object.fromEntries(assertions.map((a) => [a.name, a.pass])),
      judged: judge?.scores ?? null,
      judge_rationales: judge?.rationales ?? null,
      regressions,
      pass: fixturePass,
    }) + '\n',
  );
}

if (bless && Object.keys(newGolden).length > 0) {
  // Merge over the existing golden set: a --fixture run re-blesses only that
  // fixture and never wipes the others' floors.
  const merged = { ...golden, ...newGolden };
  mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
  writeFileSync(GOLDEN_PATH, JSON.stringify(merged, null, 2) + '\n');
  console.log(`golden floors blessed for ${Object.keys(newGolden).join(', ')} -> ${GOLDEN_PATH}`);
}

console.log(allPass ? 'ALL FIXTURES PASS' : 'FAILURES PRESENT');
process.exit(allPass ? 0 : 1);
