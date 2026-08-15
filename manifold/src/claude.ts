// The one model-call seam. Everything manifold knows about "call the model"
// lives behind the ClaudeCaller interface (complete + describe); the pass
// logic (run.ts, editorial.ts, evals/judge.ts) never touches a transport.
// That narrowness is deliberate: BYOK (an Anthropic API key from the
// environment) is the whole story for v1, but a future proxy, hosted key, or
// per-tenant key plugs in here by adding one transport, with no change to any
// caller (docs/adr/0001-manifold-runtime.md, the auth section).
//
// Two transports today, one interface:
//   1. ANTHROPIC_API_KEY set: direct Messages API call. This is the BYOK
//      path the scheduled runtime always uses (GitHub Actions injects the
//      key from repo secrets; there is no `claude` CLI on the runner).
//   2. Otherwise: the local `claude` CLI in print mode, a convenience for
//      local dev on a machine with Claude Code auth. No other transport, no
//      agent loop.
import { execFile } from 'node:child_process';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MAX_TOKENS = 8192;
const CLI_TIMEOUT_MS = 300_000;

export interface ClaudeCaller {
  /** Send one prompt, get the model's text back. */
  complete(prompt: string): Promise<string>;
  /** Which transport and model this caller uses, for run reports. */
  describe(): string;
}

async function apiComplete(prompt: string, model: string, apiKey: string): Promise<string> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(CLI_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
  if (!text) throw new Error('Anthropic API returned no text content');
  return text;
}

function cliComplete(prompt: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      ['-p', '--model', model, '--output-format', 'json'],
      { timeout: CLI_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // The CLI sometimes exits non-zero with the real story in the
          // stdout envelope (e.g. session limits); surface it.
          let detail = stderr.slice(0, 400);
          try {
            const envelope = JSON.parse(stdout) as { result?: string };
            if (envelope.result) detail = String(envelope.result).slice(0, 400);
          } catch {
            if (!detail && stdout) detail = stdout.slice(0, 400);
          }
          reject(new Error(`claude CLI failed: ${err.message}\n${detail}`));
          return;
        }
        try {
          const envelope = JSON.parse(stdout) as { result?: string; is_error?: boolean };
          if (envelope.is_error) {
            reject(new Error(`claude CLI error result: ${String(envelope.result).slice(0, 400)}`));
            return;
          }
          if (typeof envelope.result === 'string' && envelope.result.length > 0) {
            resolve(envelope.result);
            return;
          }
        } catch {
          // Not a JSON envelope; fall through to raw stdout.
        }
        if (stdout.trim()) resolve(stdout);
        else reject(new Error('claude CLI returned empty output'));
      },
    );
    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

export function makeClaude(model: string, anthropicApiKey: string | null): ClaudeCaller {
  const transport = anthropicApiKey ? 'anthropic-api' : 'claude-cli';
  return {
    complete(prompt: string) {
      return anthropicApiKey ? apiComplete(prompt, model, anthropicApiKey) : cliComplete(prompt, model);
    },
    describe() {
      return `${model} via ${transport}`;
    },
  };
}

/** Pull the first JSON object out of a model reply that may carry fences or
 * prose around it. Throws when nothing parseable is found. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  for (const candidate of [unfenced, trimmed]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // keep trying
    }
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // fall through
    }
  }
  throw new Error(`Model reply carried no parseable JSON object (first 200 chars: ${text.slice(0, 200)})`);
}
