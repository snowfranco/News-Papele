// The deterministic eval subset that CI runs on every push (npm run
// manifold:evals:ci). These exercise the REAL build + gate code
// (manifold/src/editorial.ts buildFromModel, manifold/src/gate.ts runGate)
// over crafted inputs, with no model call and no Supabase, so CI carries no
// API key. The full harness with the LLM judge stays a manual command
// (manifold/evals/runner.ts; docs/adr/0001-manifold-runtime.md).
//
// Each named check the extraction promised to preserve gets a focused test:
// schema-valid, cited-ids-exist, no-excluded-item-leads, horizon-present,
// plus parked-not-lede, numbers-grounded, and no-shame-welcome so the whole
// gate is covered by fast deterministic tests.
import { describe, it, expect } from 'vitest';
import { buildFromModel } from '../src/editorial.ts';
import { runGate } from '../src/gate.ts';
import type { ModelOutput } from '../src/contract.ts';
import type { PassInputs } from '../src/inputs.ts';
import type { ReadingItem } from '../src/app-contract.ts';

const NOW = '2026-08-15T12:00:00.000Z';

function item(id: string, title: string, snippet: string, source: string): ReadingItem {
  return {
    id,
    type: 'article',
    title,
    url: `https://example.com/${id}`,
    snippet,
    topics: ['agents'],
    read: false,
    addedAt: NOW,
    sourceFeed: source,
    publishedAt: NOW,
    origin: 'feed',
    imagePreview: null,
  };
}

function baseInputs(overrides: Partial<PassInputs> = {}): PassInputs {
  return {
    items: [
      item('a', 'Agents learn to curate their own memory', 'Teams report agent-curated memory files.', 'The AI Flow'),
      item('b', 'A benchmark for long-horizon agent tasks', 'Self-curated memory beats retrieval on long tasks.', 'Dept of Product'),
      item('c', 'Memory as a product surface', 'Users now expect to view and edit agent memory.', 'ChatPRD'),
    ],
    context: null,
    existingThemes: [],
    existingLinks: [],
    maxEditionNo: 0,
    recentLedeTitles: [],
    state: { parked: [], notes: [], signals: [], assignments: [], handoffs: [] },
    excludedItemIds: [],
    editionFloor: 3,
    nowIso: NOW,
    ...overrides,
  };
}

function baseOutput(): ModelOutput {
  return {
    welcome: 'Good to see you back on your beat today.',
    beat: 'Agent memory',
    lede: {
      kicker: 'The shift worth watching',
      title: 'Agents are learning to curate their own memory',
      deck: 'Three sources describe the same move toward agent-curated memory files.',
      why: 'The pattern shows up independently across sources, which is the trajectory signal an editor weights over raw volume.',
      apply_project_id: null,
      item_ids: ['a'],
    },
    emerging: [
      {
        theme_id: 'agent-memory',
        tag: 'horizon',
        title: 'Agent-curated memory files',
        note: 'Independent sources report the same shift toward self-curated memory.',
        item_ids: ['b'],
      },
    ],
    start_here: [{ item_id: 'c', note: 'A short read on memory as a product surface.' }],
    themes: [
      {
        id: 'agent-memory',
        label: 'Agent-curated memory',
        discipline: 'agents',
        lane: 'horizon',
        why: 'A current and emerging thread no project gates.',
        item_ids: ['a', 'b', 'c'],
        relate_theme_ids: [],
        project_ids: [],
      },
    ],
  };
}

describe('manifold deterministic gate', () => {
  it('passes a clean edition on every check', () => {
    const gate = runGate(baseInputs(), buildFromModel(baseInputs(), baseOutput()));
    expect(gate.pass).toBe(true);
    expect(Object.values(gate.checks).every(Boolean)).toBe(true);
    // schema-valid is one of the checks the extraction promised to keep.
    expect(gate.checks['schema-valid']).toBe(true);
    // Every emerging entry and theme carries at least one backing id.
    expect(gate.checks['citation-ids-present']).toBe(true);
  });

  it('fails cited-ids-exist when the lede cites an unknown item', () => {
    const output = baseOutput();
    output.lede.item_ids = ['does-not-exist'];
    const gate = runGate(baseInputs(), buildFromModel(baseInputs(), output));
    expect(gate.checks['cited-ids-exist']).toBe(false);
    expect(gate.pass).toBe(false);
  });

  it('fails no-excluded-item-leads when the lede cites a read/parked item', () => {
    const inputs = baseInputs({ excludedItemIds: ['a'] });
    const gate = runGate(inputs, buildFromModel(inputs, baseOutput()));
    expect(gate.checks['no-excluded-item-leads']).toBe(false);
    expect(gate.pass).toBe(false);
  });

  it('fails no-excluded-item-leads when start_here re-recommends an excluded item', () => {
    const inputs = baseInputs({ excludedItemIds: ['c'] });
    const gate = runGate(inputs, buildFromModel(inputs, baseOutput()));
    expect(gate.checks['no-excluded-item-leads']).toBe(false);
  });

  it('fails horizon-present when no emerging entry resolves to the horizon lane', () => {
    const output = baseOutput();
    output.themes[0]!.lane = 'applied';
    const gate = runGate(baseInputs(), buildFromModel(baseInputs(), output));
    expect(gate.checks['horizon-present']).toBe(false);
    expect(gate.pass).toBe(false);
  });

  it('fails parked-not-lede when the lede cites a parked item', () => {
    const inputs = baseInputs({
      state: { parked: [{ ts: NOW, themeId: null, itemIds: ['a'], label: 'parked' }], notes: [], signals: [], assignments: [], handoffs: [] },
    });
    const gate = runGate(inputs, buildFromModel(inputs, baseOutput()));
    expect(gate.checks['parked-not-lede']).toBe(false);
  });

  it('fails numbers-grounded when prose invents a figure absent from cited items', () => {
    const output = baseOutput();
    output.lede.why = 'Adoption jumped 87 percent across the sources this week.';
    const gate = runGate(baseInputs(), buildFromModel(baseInputs(), output));
    expect(gate.checks['numbers-grounded']).toBe(false);
  });

  it('fails no-shame-welcome when the welcome carries a digit', () => {
    const output = baseOutput();
    output.welcome = 'You have 4 things waiting for you today.';
    const gate = runGate(baseInputs(), buildFromModel(baseInputs(), output));
    expect(gate.checks['no-shame-welcome']).toBe(false);
  });

  it('fails citation-ids-present when an emerging entry persists no item ids', () => {
    const inputs = baseInputs();
    const built = buildFromModel(inputs, baseOutput());
    built.edition.emerging[0]!.item_ids = [];
    const gate = runGate(inputs, built);
    expect(gate.checks['citation-ids-present']).toBe(false);
    expect(gate.pass).toBe(false);
  });

  it('fails citation-ids-present when a theme persists no item ids', () => {
    const inputs = baseInputs();
    const built = buildFromModel(inputs, baseOutput());
    built.themes[0]!.item_ids = [];
    const gate = runGate(inputs, built);
    expect(gate.checks['citation-ids-present']).toBe(false);
    expect(gate.pass).toBe(false);
  });
});
