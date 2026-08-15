// LLM-as-judge for the soft criteria the deterministic gate cannot see:
// emergence quality, clustering coherence, rationale depth, tone. The judge
// gets the same corpus the pass got, the produced output, and an explicit
// rubric; it returns one score per criterion in [0, 1] with a rationale.
import { z } from 'zod';
import { extractJson, type ClaudeCaller } from '../src/claude.ts';
import type { BuiltPass } from '../src/editorial.ts';
import type { PassInputs } from '../src/inputs.ts';

export const JUDGED_CRITERIA = [
  'groundedness-depth',
  'emergence-quality',
  'clustering-coherence',
  'rationale-quality',
  'tone-welcome',
] as const;

export type JudgedCriterion = (typeof JUDGED_CRITERIA)[number];

const judgeReplySchema = z.object({
  scores: z.object({
    'groundedness-depth': z.number().min(0).max(1),
    'emergence-quality': z.number().min(0).max(1),
    'clustering-coherence': z.number().min(0).max(1),
    'rationale-quality': z.number().min(0).max(1),
    'tone-welcome': z.number().min(0).max(1),
  }),
  rationales: z.record(z.string()),
});

export type JudgeVerdict = z.infer<typeof judgeReplySchema>;

/** Same trims the editorial prompt applies (src/prompt.ts trim), so the
 * judge grades against exactly the context the editor actually saw. */
function judgeTrim(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + '…';
}

function corpusBlock(inputs: PassInputs): string {
  return inputs.items
    .map((i) => {
      const fields = [
        `id: ${i.id}`,
        `title: ${i.title}`,
        `source: ${i.sourceFeed ?? 'unknown'}`,
        `published: ${i.publishedAt ?? i.addedAt ?? 'unknown'}`,
        `read: ${i.read}`,
      ];
      if (i.topics.length > 0) fields.push(`topics: ${i.topics.join(', ')}`);
      if (i.snippet) fields.push(`snippet: ${judgeTrim(i.snippet, 320)}`);
      return `- ${fields.join(' | ')}`;
    })
    .join('\n');
}

/** The reader-side context the editor saw: projects (trimmed like the
 * editor's view), org context, carried themes with parked flags, and
 * reader notes. Anything shown here is fair grounding for reader claims. */
function readerContextBlock(inputs: PassInputs): string {
  const lines: string[] = [];
  lines.push('Projects:');
  lines.push(
    (inputs.context?.projects ?? [])
      .map((p) => `- ${p.id}: ${p.label}${p.description ? ` (${judgeTrim(p.description, 160)})` : ''}`)
      .join('\n') || '(none)',
  );
  lines.push(`\nOrg context: ${inputs.context?.orgContext ? judgeTrim(inputs.context.orgContext, 600) : '(none)'}`);
  const parked = new Set(inputs.state.parked.map((p) => p.themeId).filter(Boolean));
  if (inputs.existingThemes.length > 0) {
    lines.push('\nThemes carried in from earlier editions:');
    lines.push(
      inputs.existingThemes
        .map(
          (t) =>
            `- ${t.id} (${t.lane}, mastery ${t.mastery}, reads ${t.reads}): ${t.label}${parked.has(t.id) ? ' [PARKED by the reader]' : ''}`,
        )
        .join('\n'),
    );
  }
  if (inputs.state.notes.length > 0) {
    lines.push('\nReader notes to the editor (recent):');
    lines.push(inputs.state.notes.slice(-8).map((n) => `- ${judgeTrim(n.text, 240)}`).join('\n'));
  }
  return lines.join('\n');
}

export function buildJudgePrompt(inputs: PassInputs, built: BuiltPass): string {
  return `You are grading the output of manifold, an editorial agent that turns a reader's article corpus into a daily edition plus a theme map. Grade strictly against the rubric. You are a skeptical grader: when unsure, score lower and say why.

## The corpus the editor was given (its only allowed source of facts)

${corpusBlock(inputs)}

## Reader context (also fair grounding for claims about the reader)

${readerContextBlock(inputs)}

A claim about the reader's team, tools, decisions, or reading history is
grounded only if this reader context states it; a claim about the world is
grounded only if cited items state it. Judge both kinds.

## The edition the editor produced

${JSON.stringify(built.edition, null, 2)}

## The themes it wrote (with the item ids each cites)

${built.themes.map((t) => `- ${t.id} (${t.lane}, heat ${t.heat}): ${t.label}. why: ${t.why}. cites: [${(built.audit.themes[t.id] ?? []).join(', ')}]`).join('\n')}

## Rubric (score each 0.0 to 1.0)

1. groundedness-depth: Every factual claim in the deck, why, notes, and theme whys is actually supported by the cited items, not merely co-cited. Score 1.0 when every claim traces cleanly; 0.0 when claims are invented or misattributed.
2. emergence-quality: The horizon-lane picks are genuinely current and emerging: early signal, novelty, cross-source trajectory. Hype, stale news re-warmed, or single-source loudness scores low. An honest modest pick in a noisy corpus scores high.
3. clustering-coherence: Themes are coherent, non-overlapping, and well labeled; items sit under themes they actually belong to; no catch-all buckets.
4. rationale-quality: The lede's "why this leads" makes a real editorial argument from the cited evidence, not a restatement of the headline.
5. tone-welcome: Welcoming and warm without being saccharine; no shame, no pressure, no counting of anything.

Reply with ONE JSON object, nothing else:
{"scores": {"groundedness-depth": 0.0, "emergence-quality": 0.0, "clustering-coherence": 0.0, "rationale-quality": 0.0, "tone-welcome": 0.0}, "rationales": {"groundedness-depth": "...", "emergence-quality": "...", "clustering-coherence": "...", "rationale-quality": "...", "tone-welcome": "..."}}`;
}

export async function judgePass(
  inputs: PassInputs,
  built: BuiltPass,
  claude: ClaudeCaller,
): Promise<JudgeVerdict> {
  const reply = await claude.complete(buildJudgePrompt(inputs, built));
  return judgeReplySchema.parse(extractJson(reply));
}
