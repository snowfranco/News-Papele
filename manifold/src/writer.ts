// Supabase writes, only ever called with a gate-passed BuiltPass. Order
// matters: themes, then links, then the edition, so a reader never sees an
// edition that references themes which are not there yet.
import type { BuiltPass } from './editorial.ts';
import type { SupabaseClient } from './supabase.ts';

export interface WriteReceipt {
  editionId: string;
  editionNo: number;
  themesUpserted: number;
  themesDecayed: number;
  linksInserted: number;
}

export async function writePass(sb: SupabaseClient, built: BuiltPass): Promise<WriteReceipt> {
  if (built.themes.length > 0) {
    await sb.fetch('/themes?on_conflict=id', {
      method: 'POST',
      body: built.themes,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  for (const decay of built.decayed) {
    await sb.fetch(`/themes?id=eq.${encodeURIComponent(decay.id)}`, {
      method: 'PATCH',
      body: { heat: decay.heat, updated_at: decay.updated_at },
      prefer: 'return=minimal',
    });
  }

  if (built.links.length > 0) {
    await sb.fetch('/theme_links?on_conflict=source_id,target_id,kind', {
      method: 'POST',
      body: built.links,
      prefer: 'resolution=ignore-duplicates,return=minimal',
    });
  }

  await sb.fetch('/editions', {
    method: 'POST',
    body: [built.edition],
    prefer: 'return=minimal',
  });

  return {
    editionId: built.edition.id,
    editionNo: built.edition.edition_no,
    themesUpserted: built.themes.length,
    themesDecayed: built.decayed.length,
    linksInserted: built.links.length,
  };
}
