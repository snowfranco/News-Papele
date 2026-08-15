// Environment and secret loading. Secrets come from the process environment
// (how the GitHub Actions runtime injects them, from repository secrets:
// .github/workflows/manifold-edition.yml) or, for local dev, from a .env
// file at the repo root or in manifold/ (both gitignored via the .env* rule).
// Nothing here is ever committed; .env.example documents every variable.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Superlearn repo root: manifold/src -> manifold -> repo root. */
export const REPO_ROOT = join(HERE, '..', '..');

/** manifold home: manifold/ (holds reports/ and local .env). */
export const AGENT_ROOT = join(HERE, '..');

function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadDotEnvFile(path: string): Record<string, string> {
  try {
    return parseDotEnv(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

// Load both possible local files; the repo-root .env wins over manifold/.env,
// and process.env wins over both (envVar). On GitHub Actions neither file
// exists and everything comes from process.env.
const dotenv = {
  ...loadDotEnvFile(join(AGENT_ROOT, '.env')),
  ...loadDotEnvFile(join(REPO_ROOT, '.env')),
};

/** Process env wins over .env so one-off overrides work on the CLI. An
 * empty value (KEY= placeholder lines, blank shell exports) counts as
 * unset at every level, so the chain keeps moving instead of stopping on
 * a blank: empty process.env falls through to .env, empty .env falls
 * through to the built-in default. */
export function envVar(name: string): string | undefined {
  for (const value of [process.env[name], dotenv[name]]) {
    if (value !== undefined && value.trim() !== '') return value;
  }
  return undefined;
}

export interface ManifoldConfig {
  supabaseUrl: string;
  /** Service role key when present, anon key as a stopgap otherwise. */
  supabaseKey: string | null;
  /** True when running on the anon key rather than the service role key. */
  anonFallback: boolean;
  /** Model for the editorial pass and the evals judge. */
  model: string;
  anthropicApiKey: string | null;
  /** Max reading_items fed to one pass. */
  itemCap: number;
  /** Attempts before an invalid model output is rejected for the run. */
  maxAttempts: number;
  /** Rolling window (days) in which an outbox park excludes its items from
   * lede and start_here candidacy. */
  parkWindowDays: number;
  /** Below this many viable (non-excluded) candidates, the prompt asks for
   * a smaller honest edition instead of a padded one. */
  editionFloor: number;
  tenant: string;
}

export function loadConfig(): ManifoldConfig {
  const serviceKey = envVar('SUPABASE_SERVICE_ROLE_KEY') ?? null;
  const anonKey = envVar('SUPABASE_ANON_KEY') ?? null;
  return {
    supabaseUrl: envVar('SUPABASE_URL') ?? 'https://gijdjbjycymqsuhwfcbu.supabase.co',
    supabaseKey: serviceKey ?? anonKey,
    anonFallback: serviceKey === null && anonKey !== null,
    model: envVar('MANIFOLD_MODEL') ?? 'claude-sonnet-5',
    anthropicApiKey: envVar('ANTHROPIC_API_KEY') ?? null,
    itemCap: Number(envVar('MANIFOLD_ITEM_CAP') ?? 120),
    maxAttempts: Number(envVar('MANIFOLD_MAX_ATTEMPTS') ?? 2),
    parkWindowDays: Number(envVar('MANIFOLD_PARK_WINDOW_DAYS') ?? 90),
    editionFloor: Number(envVar('MANIFOLD_EDITION_FLOOR') ?? 3),
    tenant: envVar('SUPERLEARN_TENANT') ?? 'default',
  };
}
