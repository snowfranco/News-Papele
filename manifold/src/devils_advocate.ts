// The devils-advocate pass. Second manifold-authored writer alongside the
// editorial pass (manifold/src/editorial.ts) and structured the same way: one
// model call per candidate produces a counter-argument grounded in cited
// reading_items, a deterministic build wraps the model output into an insert
// row, the reply gate (manifold/src/gate.ts runReplyGate) rejects anything
// uncited, and only gate-passed rows reach public.manifold_replies.
//
// When it fires: a scheduled or manual sweep over reader columns
// (positions.kind = 'column') that have no devils_advocate reply yet, honoring
// the unique (position_id, kind) constraint so a rerun is idempotent. The
// reader sees the reply next to the column on the Position Desk with the
// shared <Citations> atom (src/components/Citations.tsx).
import { z } from 'zod';
import type { ReadingItem } from './app-contract.ts';
import type { ClaudeCaller } from './claude.ts';
import { extractJson } from './claude.ts';
import type { ManifoldReplyInsert } from './contract.ts';
import { manifoldReplyInsertSchema } from './contract.ts';

/** Inputs to one reply attempt. */
export interface ReplyInputs {
  positionId: string;
  positionTitle: string;
  positionBody: string;
  themeLabel: string | null;
  /** Recent reading_items the reply may cite (the pass's ONLY factual source). */
  items: ReadingItem[];
  /** Injected clock for deterministic fixtures. */
  nowIso: string;
}

export interface BuiltReply {
  insert: ManifoldReplyInsert;
}

/** Model output shape for one devils-advocate reply. The model returns the
 * argument plus the ids it stands on; the build wraps it into an insert row. */
export const replyModelOutputSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  item_ids: z.array(z.string().min(1)).min(1),
});

export type ReplyModelOutput = z.infer<typeof replyModelOutputSchema>;

function trim(text: string | null, max: number): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + '…';
}

function itemLines(items: ReadingItem[]): string {
  return items
    .map((i) => {
      const fields = [
        `id: ${i.id}`,
        `title: ${i.title}`,
        `source: ${i.sourceFeed ?? 'unknown'}`,
      ];
      if (i.snippet) fields.push(`snippet: ${trim(i.snippet, 280)}`);
      return `- ${fields.join(' | ')}`;
    })
    .join('\n');
}

export function buildDevilsAdvocatePrompt(input: ReplyInputs, feedback?: string[]): string {
  const gateFeedback =
    feedback && feedback.length > 0
      ? `\n\nYOUR PREVIOUS ATTEMPT FAILED THESE DETERMINISTIC CHECKS. Fix every one:\n${feedback.map((e) => `- ${e}`).join('\n')}\n`
      : '';
  const themeLine = input.themeLabel ? `on theme "${input.themeLabel}" ` : '';
  return `You are manifold, the editor behind Superlearn. The reader has published a column ${themeLine}and asked you to play devil's advocate. Compose the strongest counter-argument you can defend, grounded in the reader's own sources.

## Reader's column

Title: ${input.positionTitle}
Body: ${trim(input.positionBody, 2000)}

## Reader's corpus (reading_items; this is your ONLY source of facts)

${itemLines(input.items)}

## Rules

1. Ground everything. Every factual claim in your reply must trace to the items above; item_ids must list every reading_items id you rely on. Never introduce a fact, number, name, or source that does not appear in the cited items' title or snippet. No hype, no speculation, no invented citations.
2. Argue the strongest opposite case honestly. Steelman the counter-position; do not straw-man the reader. If the corpus is thin, write a short, honest reply rather than padding.
3. Warm but sharp. This is a colleague pushing back, not a scold. No shame language, no backlog talk.
4. Reply with ONE JSON object and nothing else. No markdown fences, no prose around it. Shape:

{
  "title": "one-line devils-advocate headline",
  "body": "2 to 5 sentences making the counter-case, grounded in the cited items",
  "item_ids": ["<reading_items id>", "..."]
}${gateFeedback}`;
}

/** Deterministic build: wrap the validated model output into an insert row.
 * The row still faces the reply gate before it ever reaches Supabase. */
export function buildReplyFromModel(input: ReplyInputs, output: ReplyModelOutput): BuiltReply {
  return {
    insert: {
      position_id: input.positionId,
      kind: 'devils_advocate',
      title: output.title,
      body: output.body,
      item_ids: output.item_ids,
    },
  };
}

export interface ReplyAttempt {
  attempt: number;
  errors: string[];
}

export interface ReplyResult {
  ok: boolean;
  built: BuiltReply | null;
  attempts: ReplyAttempt[];
  rawReply: string | null;
}

export async function runDevilsAdvocatePass(
  input: ReplyInputs,
  claude: ClaudeCaller,
  gate: (built: BuiltReply, input: ReplyInputs) => { pass: boolean; errors: string[] },
  maxAttempts: number,
): Promise<ReplyResult> {
  const attempts: ReplyAttempt[] = [];
  let feedback: string[] | undefined;
  let rawReply: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildDevilsAdvocatePrompt(input, feedback);
    rawReply = await claude.complete(prompt);

    let parsed: unknown;
    try {
      parsed = extractJson(rawReply);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attempts.push({ attempt, errors: [msg] });
      feedback = [`Your reply was not a single parseable JSON object: ${msg}`];
      continue;
    }

    const output = replyModelOutputSchema.safeParse(parsed);
    if (!output.success) {
      const errors = output.error.issues.slice(0, 6).map((i) => `output shape: ${i.path.join('.')}: ${i.message}`);
      attempts.push({ attempt, errors });
      feedback = errors;
      continue;
    }

    const built = buildReplyFromModel(input, output.data);
    // Strict writer schema first: catches empty title/body before the gate.
    const inserted = manifoldReplyInsertSchema.safeParse(built.insert);
    if (!inserted.success) {
      const errors = inserted.error.issues.slice(0, 6).map((i) => `insert: ${i.path.join('.')}: ${i.message}`);
      attempts.push({ attempt, errors });
      feedback = errors;
      continue;
    }

    const gateResult = gate(built, input);
    attempts.push({ attempt, errors: gateResult.errors });
    if (gateResult.pass) return { ok: true, built, attempts, rawReply };
    feedback = gateResult.errors;

    if (attempt === maxAttempts) return { ok: false, built, attempts, rawReply };
  }

  return { ok: false, built: null, attempts, rawReply };
}
