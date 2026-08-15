# manifold evals rubric

Every run of the harness scores one editorial pass per fixture on two layers.
The deterministic layer is binary and blocking; the judged layer is scored by
an LLM judge against the rubric below. A fixture passes when the gate is all
green, every fixture assertion holds, every judged criterion is at least 0.5,
the judged mean is at least 0.7, and no score falls below its golden floor
(golden/golden.json). Real runs (manifold/src/cli.ts edition) apply the
deterministic layer as a hard write gate; the judged layer is evals-only.

## Deterministic checks (manifold/src/gate.ts, all must pass)

- schema-valid: every row passes the strict writer schemas
  (manifold/src/contract.ts).
- app-contract-round-trip: every row survives the app's OWN reader schemas,
  imported directly (src/schemas.ts via manifold/src/app-contract.ts, no
  vendored copy), with no salvage rewriting values.
- cited-ids-exist: every cited item id exists in the input batch; the lede,
  every emerging entry, and every theme cite at least one item.
- emerging-theme-written: every emerging card points at a theme this run writes.
- horizon-present: at least one emerging entry resolves to the horizon lane.
- numbers-grounded: every digit token in generated prose appears in the text
  of that section's cited items (the deterministic uncited-claim detector).
- no-shame-welcome: the welcome never mentions backlogs or unread piles and
  carries no digits at all.
- theme-ids-unique: one upsert batch never carries the same theme id twice
  (colliding model ids are merged upstream; this is the belt).
- parked-not-lede: the lede cites neither items the reader parked nor items
  this run maps to a parked theme. Parked may resurface in emerging (with a
  warning); it never leads.
- no-excluded-item-leads: no lede citation and no start_here entry is in the
  exclusion set (items the reader read, per article_read_states, or parked,
  per outbox park rows in the rolling window plus manifold state). Excluded
  items may still back themes and emerging entries; they are never led with
  and never re-recommended.
- superlearn-not-a-node: no theme or link makes Superlearn a node.
- project-ids-valid: apply_project_id and project link targets exist in
  context.projects. Tags enrich; they never gate an item's inclusion.

## Judged criteria (evals/judge.ts, 0.0 to 1.0 each)

- groundedness-depth: claims trace to cited items in substance, not merely
  co-citation. Catches misattribution the number check cannot.
- emergence-quality: horizon picks show early signal, novelty, and
  cross-source trajectory; hype, stale-but-loud, and single-source noise
  score low. A modest honest pick in an all-noise corpus scores high.
- clustering-coherence: themes are coherent, non-overlapping, well labeled.
- rationale-quality: "why this leads" argues from evidence, not headline
  restatement.
- tone-welcome: warm, no shame, no pressure, nothing counted.

## Thresholds

- deterministic: all pass, no exceptions (this subset is the production gate).
- judged: each >= 0.5, mean >= 0.7.
- golden floors: judged scores must not fall below golden/golden.json values;
  re-bless deliberately with `node evals/runner.ts --bless` after a reviewed
  improvement, never to make a red run green.

## Running

Full harness (real editorial pass + LLM judge; needs ANTHROPIC_API_KEY):

    npm run manifold:evals                       # pass + judge on every fixture
    npm run manifold:evals:bless                 # re-bless golden floors
    tsx manifold/evals/runner.ts --skip-judge    # real pass, deterministic layer only
    tsx manifold/evals/runner.ts --fixture hype-but-stale

Deterministic subset in CI (no model call, no API key): a Vitest suite over
the same build + gate code, run on every push (manifold/tests/gate.test.ts;
npm run manifold:evals:ci). The `--bless` command stays manual until CI can
safely carry a key (docs/adr/0001-manifold-runtime.md).

Full-harness scores append to results/history.jsonl (timestamp, git head,
model, per-criterion results) so drift across runs is visible in one file.
