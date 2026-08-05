// Runtime configuration. The Supabase project and anon key are the same ones
// the legacy app shipped with (the anon key is public by design; row access
// is governed by RLS policies in supabase/migrations).

export const SUPABASE_URL = 'https://gijdjbjycymqsuhwfcbu.supabase.co';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpamRqYmp5Y3ltcXN1aHdmY2J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMzM3NTMsImV4cCI6MjA5MjkwOTc1M30.R1CwG-iyr3fQ7ILoS5Jj8QmbknbAdnoEdUnsnQCW3RU';

// Model for direct in-app Claude calls (assisted onboarding, source
// suggestions). This is the same call pattern the legacy app used for
// article summaries: a plain fetch that degrades gracefully when no
// key/proxy is available.
export const CLAUDE_MODEL = 'claude-sonnet-5';
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

// Device-local (never synced) storage key for an optional user-supplied
// Anthropic API key. Sync-state lives in Supabase; this is a secret that
// must stay on the device, which is the one sanctioned localStorage use.
export const LOCAL_API_KEY_STORAGE = 'superlearn-anthropic-key';

// Legacy localStorage key migrated into context.sources on first load.
export const LEGACY_FEEDS_STORAGE = 'la-feeds-v2';

// The single tenant this deployment uses today. The context table is keyed
// by tenant so a future multi-tenant build changes this value, not the schema.
export const TENANT = 'default';

// How many items per feed to upsert into reading_items on refresh.
export const FEED_ITEM_LIMIT = 12;

// Reads needed before the desk considers a theme ready for a column.
export const POSITION_READY_READS = 5;
