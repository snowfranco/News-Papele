import { useState } from 'react';
import { ClaudeUnavailableError, suggestSources } from '../lib/claude';
import { validateFeedUrl } from '../lib/feeds';
import { useStore } from '../state/AppStore';
import { EMPTY_SOURCES } from '../types';
import type { LinkSource, Sources } from '../types';

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

function newId(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'source';
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Blogs and resources share this shape: enable toggle, remove, and an add
 * row that only checks URL shape (no proxy probe). */
function LinkSection({
  label,
  items,
  update,
}: {
  label: string;
  items: LinkSource[];
  update: (items: LinkSource[]) => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState<string | null>(null);

  function add() {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    // Must satisfy the same predicate zod applies on read (z.string().url()),
    // or one bad link would invalidate the stored sources.
    try {
      const parsed = new URL(trimmedUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
    } catch {
      setNote('enter a full valid url (https://…)');
      return;
    }
    setNote(null);
    const trimmedName = name.trim() || hostOf(trimmedUrl);
    update([...items, { id: newId(trimmedName), name: trimmedName, url: trimmedUrl, enabled: true }]);
    setName('');
    setUrl('');
  }

  return (
    <>
      <span className="sp-fieldlabel">{label}</span>
      {items.map((s) => (
        <div className="sp-suggestion" key={s.id}>
          <input
            type="checkbox"
            checked={s.enabled}
            onChange={() =>
              update(items.map((i) => (i.id === s.id ? { ...i, enabled: !i.enabled } : i)))
            }
            aria-label={`enable ${s.name}`}
          />
          <div style={{ flex: 1 }}>
            <div className="sp-sugname">{s.name}</div>
            <div className="sp-sugmeta">{s.url}</div>
          </div>
          <button className="sp-mini" onClick={() => update(items.filter((i) => i.id !== s.id))}>
            remove
          </button>
        </div>
      ))}
      <div className="sp-row" style={{ marginTop: 10 }}>
        <input
          className="sp-input"
          style={{ flex: '1 1 130px' }}
          placeholder="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={`${label} name`}
        />
        <input
          className="sp-input"
          style={{ flex: '2 1 220px' }}
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label={`${label} url`}
        />
        <button className="sp-mini" onClick={add} disabled={!url.trim()}>
          Add
        </button>
        {note && <span className="sp-sugstatus bad">{note}</span>}
      </div>
    </>
  );
}

/** Source editing after onboarding. All mutations stay in the local draft
 * until Save persists them through the same saveSources path. */
export function SourceManager({ onClose }: { onClose: () => void }) {
  const { context, saveSources } = useStore();
  const [draft, setDraft] = useState<Sources>(() => {
    const s = context?.sources ?? EMPTY_SOURCES;
    return { feeds: [...s.feeds], blogs: [...s.blogs], resources: [...s.resources] };
  });
  const [saving, setSaving] = useState(false);
  const [feedName, setFeedName] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [feedAddStatus, setFeedAddStatus] = useState<'checking' | 'unreachable · not added' | null>(
    null,
  );
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);

  async function addFeed() {
    const name = feedName.trim();
    let url = feedUrl.trim();
    if (!url || feedAddStatus === 'checking') return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    setFeedAddStatus('checking');
    const ok = await validateFeedUrl(url);
    if (!ok) {
      setFeedAddStatus('unreachable · not added');
      return;
    }
    setFeedAddStatus(null);
    setDraft((prev) => ({
      ...prev,
      feeds: [...prev.feeds, { id: newId(name || url), name: name || hostOf(url), url, enabled: true }],
    }));
    setFeedName('');
    setFeedUrl('');
  }

  async function handleSuggestMore() {
    if (suggestBusy) return;
    setSuggestBusy(true);
    setSuggestNote(null);
    try {
      const existing = [...draft.feeds, ...draft.blogs, ...draft.resources].map((s) => s.url);
      const suggestions = await suggestSources({
        area: context?.orgContext ?? '',
        projects: context?.projects ?? [],
        existingUrls: existing,
      });
      const taken = new Set(existing.map(normalizeUrl));
      const fresh = suggestions.filter((s) => {
        const norm = normalizeUrl(s.url);
        if (taken.has(norm)) return false;
        taken.add(norm);
        return true;
      });
      // Feed suggestions are probed before they join the draft; blogs and
      // resources only need URL shape, which the schema already enforced.
      const feedChecks = await Promise.all(
        fresh
          .filter((s) => s.kind === 'feed')
          .map(async (s) => ({ s, ok: await validateFeedUrl(s.url) })),
      );
      const toSource = (s: { name: string; url: string }) => ({
        id: newId(s.name),
        name: s.name,
        url: s.url,
        enabled: true,
      });
      const newFeeds = feedChecks.filter((c) => c.ok).map((c) => toSource(c.s));
      const newBlogs = fresh.filter((s) => s.kind === 'blog').map(toSource);
      const newResources = fresh.filter((s) => s.kind === 'resource').map(toSource);
      setDraft((prev) => ({
        feeds: [...prev.feeds, ...newFeeds],
        blogs: [...prev.blogs, ...newBlogs],
        resources: [...prev.resources, ...newResources],
      }));
      if (newFeeds.length + newBlogs.length + newResources.length === 0) {
        setSuggestNote('nothing new to add');
      }
    } catch (err) {
      if (!(err instanceof ClaudeUnavailableError)) console.warn('superlearn: suggest failed', err);
      setSuggestNote('assisted suggestions unavailable here');
    } finally {
      setSuggestBusy(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    await saveSources(draft, context?.projects, context?.orgContext);
    setSaving(false);
    onClose();
  }

  return (
    <div className="sp-out" aria-label="source manager">
      <span className="sp-fieldlabel">feeds</span>
      {draft.feeds.map((f) => (
        <div className="sp-suggestion" key={f.id}>
          <input
            type="checkbox"
            checked={f.enabled}
            onChange={() =>
              setDraft((prev) => ({
                ...prev,
                feeds: prev.feeds.map((x) => (x.id === f.id ? { ...x, enabled: !x.enabled } : x)),
              }))
            }
            aria-label={`enable ${f.name}`}
          />
          <div style={{ flex: 1 }}>
            <div className="sp-sugname">{f.name}</div>
            <div className="sp-sugmeta">{f.url}</div>
          </div>
          <button
            className="sp-mini"
            onClick={() =>
              setDraft((prev) => ({ ...prev, feeds: prev.feeds.filter((x) => x.id !== f.id) }))
            }
          >
            remove
          </button>
        </div>
      ))}
      <div className="sp-row" style={{ marginTop: 10 }}>
        <input
          className="sp-input"
          style={{ flex: '1 1 130px' }}
          placeholder="name"
          value={feedName}
          onChange={(e) => setFeedName(e.target.value)}
          aria-label="feed name"
        />
        <input
          className="sp-input"
          style={{ flex: '2 1 220px' }}
          placeholder="https://example.com/feed"
          value={feedUrl}
          onChange={(e) => setFeedUrl(e.target.value)}
          aria-label="feed url"
        />
        <button
          className="sp-mini"
          onClick={() => void addFeed()}
          disabled={feedAddStatus === 'checking' || !feedUrl.trim()}
        >
          Add
        </button>
        {feedAddStatus && (
          <span className={feedAddStatus === 'checking' ? 'sp-sugstatus pending' : 'sp-sugstatus bad'}>
            {feedAddStatus}
          </span>
        )}
      </div>

      <hr className="sp-hair" />
      <LinkSection
        label="blogs"
        items={draft.blogs}
        update={(blogs) => setDraft((prev) => ({ ...prev, blogs }))}
      />

      <hr className="sp-hair" />
      <LinkSection
        label="resources"
        items={draft.resources}
        update={(resources) => setDraft((prev) => ({ ...prev, resources }))}
      />

      <hr className="sp-hair" />
      <div className="sp-row">
        <button className="sp-mini" onClick={() => void handleSuggestMore()} disabled={suggestBusy}>
          {suggestBusy && (
            <span className="sp-spin" aria-hidden="true">
              ◌{' '}
            </span>
          )}
          Suggest more
        </button>
        {suggestNote && <span className="sp-sugstatus pending">{suggestNote}</span>}
      </div>
      <div className="sp-row" style={{ marginTop: 8 }}>
        <button className="sp-btn" onClick={() => void handleSave()} disabled={saving}>
          Save
        </button>
        <button className="sp-btn ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
