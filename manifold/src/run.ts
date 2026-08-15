// The attempt loop: prompt, one model call, deterministic build, gate.
// On a gate failure the model gets one more attempt with the exact check
// failures quoted back; still failing means the run is rejected. This is
// retry-on-invalid, not an agent loop: no tools, no multi-step planning.
import { extractJson, type ClaudeCaller } from './claude.ts';
import { modelOutputSchema } from './contract.ts';
import type { BuiltPass } from './editorial.ts';
import { buildFromModel } from './editorial.ts';
import { runGate, type GateResult } from './gate.ts';
import type { PassInputs } from './inputs.ts';
import { buildEditorialPrompt } from './prompt.ts';

export interface AttemptRecord {
  attempt: number;
  errors: string[];
}

export interface PassResult {
  ok: boolean;
  built: BuiltPass | null;
  gate: GateResult | null;
  attempts: AttemptRecord[];
  /** Raw model text of the final attempt, for the run log. */
  rawReply: string | null;
}

export async function runEditorialPass(
  inputs: PassInputs,
  claude: ClaudeCaller,
  maxAttempts: number,
): Promise<PassResult> {
  const attempts: AttemptRecord[] = [];
  let feedback: string[] | undefined;
  let rawReply: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildEditorialPrompt(inputs, feedback);
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

    const modelOutput = modelOutputSchema.safeParse(parsed);
    if (!modelOutput.success) {
      const errors = modelOutput.error.issues
        .slice(0, 8)
        .map((i) => `output shape: ${i.path.join('.')}: ${i.message}`);
      attempts.push({ attempt, errors });
      feedback = errors;
      continue;
    }

    const built = buildFromModel(inputs, modelOutput.data);
    const gate = runGate(inputs, built);
    attempts.push({ attempt, errors: gate.errors });
    if (gate.pass) {
      return { ok: true, built, gate, attempts, rawReply };
    }
    feedback = gate.errors;

    if (attempt === maxAttempts) {
      return { ok: false, built, gate, attempts, rawReply };
    }
  }

  return { ok: false, built: null, gate: null, attempts, rawReply };
}
