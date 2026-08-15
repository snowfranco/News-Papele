// The one editorial prompt. Everything manifold believes about editing
// lives here, in one place, versioned with the gate that enforces it.
import type { PassInputs } from './inputs.ts';

const PROMPT_VERSION = 'v0.4';

function trim(text: string | null, max: number): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + '…';
}

function itemLines(inputs: PassInputs): string {
  const excluded = new Set(inputs.excludedItemIds);
  return inputs.items
    .map((i) => {
      const fields = [
        `id: ${i.id}`,
        `title: ${i.title}`,
        `source: ${i.sourceFeed ?? 'unknown'}`,
        `published: ${i.publishedAt ?? i.addedAt ?? 'unknown'}`,
        `read: ${i.read}`,
      ];
      if (excluded.has(i.id)) fields.push('EXCLUDED (already read or parked)');
      if (i.topics.length > 0) fields.push(`topics: ${i.topics.join(', ')}`);
      if (i.snippet) fields.push(`snippet: ${trim(i.snippet, 320)}`);
      return `- ${fields.join(' | ')}`;
    })
    .join('\n');
}

/** A corpus note after the items: how many candidates remain viable once
 * the reader's reads and parks are honored, and what a thin day means. */
function corpusNote(inputs: PassInputs): string {
  const excluded = new Set(inputs.excludedItemIds);
  const viable = inputs.items.filter((i) => !excluded.has(i.id)).length;
  if (excluded.size === 0 || viable === inputs.items.length) return '';
  const note = `${viable} of ${inputs.items.length} items are viable candidates; the rest are EXCLUDED (the reader already read or parked them).`;
  if (viable >= inputs.editionFloor) return `\n${note}`;
  return `\n${note} That is a thin day: produce a smaller, honest edition (one emerging entry and one start_here read are enough) rather than padding with excluded items.`;
}

function themeLines(inputs: PassInputs): string {
  if (inputs.existingThemes.length === 0) return '(none yet; this is the first pass)';
  const parked = new Set(inputs.state.parked.map((p) => p.themeId).filter(Boolean));
  return inputs.existingThemes
    .map(
      (t) =>
        `- id: ${t.id} | label: ${t.label} | lane: ${t.lane} | discipline: ${t.discipline} | heat: ${t.heat} | mastery: ${t.mastery} | reads: ${t.reads}${parked.has(t.id) ? ' | PARKED by the reader' : ''}`,
    )
    .join('\n');
}

function contextBlock(inputs: PassInputs): string {
  const projects = inputs.context?.projects ?? [];
  const lines: string[] = [];
  lines.push(
    projects.length > 0
      ? `Reader projects (the only valid apply_project_id / project_ids values):\n${projects
          .map((p) => `- id: ${p.id} | label: ${p.label}${p.description ? ` | ${trim(p.description, 160)}` : ''}`)
          .join('\n')}`
      : 'Reader projects: none defined. apply_project_id must be null and every project_ids list must be empty.',
  );
  if (inputs.context?.orgContext) {
    lines.push(`Org context: ${trim(inputs.context.orgContext, 600)}`);
  }
  if (inputs.state.notes.length > 0) {
    lines.push(
      `Reader notes to manifold (recent):\n${inputs.state.notes
        .slice(-8)
        .map((n) => `- ${n.ts.slice(0, 10)}: ${trim(n.text, 240)}`)
        .join('\n')}`,
    );
  }
  const itemIdsInWindow = new Set(inputs.items.map((i) => i.id));
  const excludedHere = inputs.excludedItemIds.filter((id) => itemIdsInWindow.has(id));
  if (excludedHere.length > 0) {
    lines.push(
      `The reader already handled these items (read or parked). NEVER cite them in the lede and NEVER put them in start_here; they may still back themes and emerging entries: ${excludedHere.join(', ')}`,
    );
  }
  if (inputs.state.assignments.length > 0) {
    lines.push(
      `Reader assigned items to themes (honor each one: include the item in that theme's item_ids, creating the theme with a fitting kebab-case id if none exists yet):\n${inputs.state.assignments
        .slice(-8)
        .map(
          (a) =>
            `- item ${a.itemId} -> ${a.themeId ? `theme ${a.themeId}` : `new theme labeled "${trim(a.newThemeLabel, 80)}"`}`,
        )
        .join('\n')}`,
    );
  }
  if (inputs.state.signals.length > 0) {
    lines.push(
      `Reader signals (recent):\n${inputs.state.signals
        .slice(-8)
        .map((s) => `- ${s.kind}: ${trim(s.label, 120)}${s.themeId ? ` (theme ${s.themeId})` : ''}`)
        .join('\n')}`,
    );
  }
  if (inputs.recentLedeTitles.length > 0) {
    lines.push(`Recent lede titles (do not repeat these):\n${inputs.recentLedeTitles.map((t) => `- ${t}`).join('\n')}`);
  }
  return lines.join('\n\n');
}

export function buildEditorialPrompt(inputs: PassInputs, gateFeedback?: string[]): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(inputs.nowIso));

  const feedback =
    gateFeedback && gateFeedback.length > 0
      ? `\n\nYOUR PREVIOUS ATTEMPT FAILED THESE DETERMINISTIC CHECKS. Fix every one:\n${gateFeedback.map((e) => `- ${e}`).join('\n')}\n`
      : '';

  return `You are manifold, the editor behind Superlearn, a personal learning cockpit. You read everything the reader's sources published and shape it into one small daily edition plus an updated theme map. You are an editor with taste: skeptical of hype, protective of genuinely emerging work, and warm to the reader without ever being saccharine.

Today is ${today} (America/Toronto). Editorial prompt ${PROMPT_VERSION}.

## The reader's corpus (reading_items; this is your ONLY source of facts)

${itemLines(inputs)}${corpusNote(inputs)}

## Existing themes (carry these forward; reuse their ids when the subject matches)

${themeLines(inputs)}

## Reader context

${contextBlock(inputs)}

## Editorial rules

A deterministic gate checks the checkable ones after you answer: citations exist, numbers trace to cited items, a horizon entry is present, the welcome carries no digits and no backlog talk, parked items do not lead, EXCLUDED items (already read or parked) neither lead nor appear in start_here, Superlearn is not a node, project ids are real. The rest is your editorial judgment; the evals judge grades it.

1. Ground everything. Every factual claim you write must trace to the items above, and every section cites the item ids it stands on. Never introduce a fact, number, name, or source that does not appear in the cited items' title or snippet. This includes the kicker and the beat. The same rule covers the reader: never assert anything about the reader's team, tools, or decisions beyond what the reader context below states; connect an item to their world as a suggestion ("worth weighing for X"), never as an invented fact ("the tools your team already uses"). If the corpus is thin, write a modest edition; never pad with invented material.
2. Two lanes. "applied" connects to a reader project; "horizon" is current and emerging learning that no project gates. Weight early signal, novelty, and cross-source trajectory over raw volume. A topic that is merely loud, old news re-warmed, or single-source hype does not belong in the horizon lane. At least one emerging entry must be lane "horizon" (the gate checks the resolved lane of the theme you cite).
3. Lane and project tags are enrichment, never filters. Never drop an important item because it matches no project. When projects exist, apply_project_id may name one for the lede; otherwise it is null.
4. Never shame. The welcome is warm and brief. Never mention unread counts, backlogs, piles, or catching up, and use NO digits at all in the welcome (the gate rejects any digit there; spell out a number only if you truly need one).
5. Superlearn itself is never a theme, never a project, never a node. It is the surface you write into.
6. The lede is the one piece most worth the reader's attention today, with an honest "why this leads" rationale grounded in cited items. Prefer signal over recency, and never lead with a stale item just because it is loud. Never build the lede on EXCLUDED items (the reader already read or parked them) or on items backing a PARKED theme (the gate rejects both); a resurfaced parked theme may appear in emerging, never as the lede. Excluding an item is not losing it: it is respecting a reader decision, and a smaller edition beats a recycled one.
7. Themes are coherent and non-overlapping, each with a UNIQUE id. Reuse an existing theme id when the subject continues it; coin a new kebab-case id when it is genuinely new. Do not resurface themes the reader PARKED unless the corpus shows a real new development. 3 to 8 themes total is right; each cites the items backing it.
8. start_here is 2 to 4 reads the reader should actually start with today (1 is fine on a thin day): only items that are not EXCLUDED (the gate rejects re-recommending anything already read or parked), keep total time honest, one line each on why.

## Output

Reply with ONE JSON object and nothing else. No markdown fences, no prose around it. Shape:

{
  "welcome": "1 to 2 warm sentences",
  "beat": "a 2 to 4 word beat name for this edition, or null",
  "lede": {
    "kicker": "short kicker line",
    "title": "the lede headline (may quote the item's own title)",
    "deck": "1 to 2 sentence deck",
    "why": "2 to 4 sentences: why this leads today, grounded in the cited items",
    "apply_project_id": null,
    "item_ids": ["<reading_items id>", "..."]
  },
  "emerging": [
    { "theme_id": "<id from your themes array below>", "tag": "short lane-ish tag", "title": "card title", "note": "1 to 2 sentences", "item_ids": ["..."] }
  ],
  "start_here": [
    { "item_id": "<reading_items id>", "minutes": 8, "note": "one line on why this read" }
  ],
  "themes": [
    {
      "id": "existing-or-new-kebab-id",
      "label": "Human label",
      "discipline": "one word-ish discipline",
      "lane": "applied" | "horizon",
      "why": "1 to 2 sentences: why this theme matters to the reader now",
      "item_ids": ["items backing this theme"],
      "relate_theme_ids": ["other theme ids this relates to"],
      "project_ids": ["reader project ids this theme serves, or empty"]
    }
  ]
}

Editorial guidance on size (judgment, not gate): 2 to 4 emerging entries, 2 to 4 start_here reads, 3 to 8 themes.${feedback}`;
}
