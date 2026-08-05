import { useRef, useState } from 'react';
import {
  ClaudeUnavailableError,
  curatedFor,
  getStoredApiKey,
  setStoredApiKey,
  suggestSources,
} from '../lib/claude';
import { validateFeedUrl } from '../lib/feeds';
import { useStore } from '../state/AppStore';
import type { SourceSuggestion } from '../types';

type RowStatus = 'checking' | 'fetchable' | 'unreachable' | 'link' | 'already added';

interface ReviewRow {
  id: string;
  name: string;
  url: string;
  kind: SourceSuggestion['kind'];
  reason: string;
  checked: boolean;
  status: RowStatus;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'source'
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function statusClass(status: RowStatus): string {
  if (status === 'fetchable') return 'sp-sugstatus ok';
  if (status === 'unreachable') return 'sp-sugstatus bad';
  return 'sp-sugstatus pending';
}

/** Collaborative source setup. The assisted path (Claude suggests, the
 * reader edits) is the default; curated sets and manual entry are fallbacks,
 * never gates. */
export function Onboarding() {
  const { context, saveSources, say } = useStore();
  const [step, setStep] = useState<'brief' | 'review'>('brief');
  const [area, setArea] = useState(context?.orgContext ?? '');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  // Captured once so the affordance does not vanish mid-typing.
  const [hadKeyAtMount] = useState(() => getStoredApiKey() !== null);
  const [showKeyRow, setShowKeyRow] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const rowSeq = useRef(0);

  const contextUrls = [
    ...(context?.sources.feeds ?? []),
    ...(context?.sources.blogs ?? []),
    ...(context?.sources.resources ?? []),
  ].map((s) => s.url);

  function buildRows(suggestions: SourceSuggestion[], taken: Set<string>): ReviewRow[] {
    return suggestions.map((s) => {
      const norm = normalizeUrl(s.url);
      const duplicate = taken.has(norm);
      if (!duplicate) taken.add(norm);
      return {
        id: `row-${rowSeq.current++}`,
        name: s.name,
        url: s.url,
        kind: s.kind,
        reason: s.reason,
        checked: !duplicate,
        status: duplicate ? 'already added' : s.kind === 'feed' ? 'checking' : 'link',
      };
    });
  }

  /** Probe feed rows in parallel; each row resolves independently. */
  function beginChecks(pending: ReviewRow[]) {
    for (const row of pending) {
      if (row.status !== 'checking') continue;
      void validateFeedUrl(row.url).then((ok) => {
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? ok
                ? { ...r, status: 'fetchable' as const }
                : { ...r, status: 'unreachable' as const, checked: false }
              : r,
          ),
        );
      });
    }
  }

  function enterReview(suggestions: SourceSuggestion[]) {
    const next = buildRows(suggestions, new Set(contextUrls.map(normalizeUrl)));
    setRows(next);
    setStep('review');
    beginChecks(next);
  }

  async function handleSuggest() {
    if (busy) return;
    setBusy(true);
    try {
      const suggestions = await suggestSources({
        area: area.trim(),
        projects: context?.projects ?? [],
        existingUrls: contextUrls,
      });
      enterReview(suggestions);
    } catch (err) {
      if (!(err instanceof ClaudeUnavailableError)) console.warn('superlearn: suggest failed', err);
      say('assisted suggestions unavailable here · starting from a curated set');
      enterReview(curatedFor(area));
    } finally {
      setBusy(false);
    }
  }

  async function handleSuggestMore() {
    if (busy) return;
    setBusy(true);
    try {
      const suggestions = await suggestSources({
        area: area.trim(),
        projects: context?.projects ?? [],
        existingUrls: [...contextUrls, ...rows.map((r) => r.url)],
      });
      const taken = new Set([...contextUrls, ...rows.map((r) => r.url)].map(normalizeUrl));
      const added = buildRows(
        suggestions.filter((s) => !taken.has(normalizeUrl(s.url))),
        taken,
      );
      setRows((prev) => [...prev, ...added]);
      beginChecks(added);
    } catch (err) {
      if (!(err instanceof ClaudeUnavailableError)) console.warn('superlearn: suggest failed', err);
      say('assisted suggestions unavailable here');
    } finally {
      setBusy(false);
    }
  }

  function handleManualAdd() {
    const name = manualName.trim();
    let url = manualUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const taken = new Set([...contextUrls, ...rows.map((r) => r.url)].map(normalizeUrl));
    const duplicate = taken.has(normalizeUrl(url));
    const row: ReviewRow = {
      id: `row-${rowSeq.current++}`,
      name: name || hostOf(url),
      url,
      kind: 'feed',
      reason: 'added by you.',
      checked: !duplicate,
      status: duplicate ? 'already added' : 'checking',
    };
    setRows((prev) => [...prev, row]);
    setManualName('');
    setManualUrl('');
    beginChecks([row]);
  }

  function toggleRow(id: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, checked: !r.checked } : r)));
  }

  async function handleSave() {
    if (saving) return;
    // A checked row is saved even when the probe said unreachable: the probe
    // can false-negative (proxy hiccups) and the reader has the last word.
    const chosen = rows.filter((r) => r.checked && r.status !== 'already added');
    const toSource = (r: ReviewRow, i: number) => ({
      id: `${slugify(r.name)}-${i}`,
      name: r.name,
      url: r.url,
      enabled: true,
    });
    setSaving(true);
    // On false return saveSources has already toasted and kept an ephemeral
    // context; nothing more to do either way.
    await saveSources(
      {
        feeds: chosen.filter((r) => r.kind === 'feed').map(toSource),
        blogs: chosen.filter((r) => r.kind === 'blog').map(toSource),
        resources: chosen.filter((r) => r.kind === 'resource').map(toSource),
      },
      context?.projects,
      area.trim(),
    );
    setSaving(false);
  }

  if (step === 'brief') {
    return (
      <div className="sp-onboard">
        <h2>Set up your beat.</h2>
        <p className="sp-welcome">
          Superlearn reads your sources and prepares editions for you. Describe your area and
          what you are building, and it will propose a starter set you can edit.
        </p>
        <div className="sp-step">
          <label className="sp-fieldlabel" htmlFor="sp-area">
            your area, role, and what you are building
          </label>
          <textarea
            id="sp-area"
            className="sp-textarea"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="e.g. product manager building AI-assisted tools for small teams"
          />
        </div>
        {!hadKeyAtMount && (
          <div className="sp-step">
            <button className="sp-chip" onClick={() => setShowKeyRow((s) => !s)}>
              add an Anthropic API key (optional)
            </button>
            {showKeyRow && (
              <div style={{ marginTop: 10 }}>
                <label className="sp-fieldlabel" htmlFor="sp-key">
                  anthropic api key · stays on this device
                </label>
                <input
                  id="sp-key"
                  className="sp-input"
                  type="password"
                  autoComplete="off"
                  value={keyDraft}
                  onChange={(e) => {
                    setKeyDraft(e.target.value);
                    setStoredApiKey(e.target.value);
                  }}
                />
                <p className="sp-enote" style={{ marginTop: 6 }}>
                  Needed for assisted suggestions when Superlearn runs outside an environment
                  that provides Claude. Stored only in this browser.
                </p>
              </div>
            )}
          </div>
        )}
        <div className="sp-row">
          <button className="sp-btn" onClick={() => void handleSuggest()} disabled={busy}>
            {busy && (
              <span className="sp-spin" aria-hidden="true">
                ◌{' '}
              </span>
            )}
            Suggest my sources
          </button>
          <button className="sp-btn ghost" onClick={() => enterReview(curatedFor(area))} disabled={busy}>
            Start from a curated set
          </button>
          <button className="sp-btn ghost" onClick={() => enterReview([])} disabled={busy}>
            I will add them manually
          </button>
        </div>
      </div>
    );
  }

  const anyChecking = rows.some((r) => r.status === 'checking');
  const checkedCount = rows.filter((r) => r.checked).length;

  return (
    <div className="sp-onboard">
      <h2>Your starter sources.</h2>
      <p className="sp-welcome">
        Suggested for your beat. Uncheck anything, add your own. Feeds are checked against the
        fetcher before they are saved.
      </p>
      <div className="sp-step">
        {rows.map((row) => {
          // Unreachable rows stay togglable: the probe advises, the reader
          // decides. Only true duplicates are locked out.
          const disabled = row.status === 'already added';
          return (
            <div className="sp-suggestion" key={row.id}>
              <input
                type="checkbox"
                checked={row.checked}
                disabled={disabled}
                onChange={() => toggleRow(row.id)}
                aria-label={`include ${row.name}`}
              />
              <div style={{ flex: 1 }}>
                <div className="sp-sugname">{row.name}</div>
                <div className="sp-sugmeta">{row.url}</div>
                {row.reason && <div className="sp-enote">{row.reason}</div>}
              </div>
              <span className={statusClass(row.status)}>{row.status}</span>
            </div>
          );
        })}
      </div>
      <div className="sp-step">
        <label className="sp-fieldlabel" htmlFor="sp-manual-url">
          add your own
        </label>
        <div className="sp-row">
          <input
            className="sp-input"
            style={{ flex: '1 1 130px' }}
            placeholder="name"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            aria-label="source name"
          />
          <input
            id="sp-manual-url"
            className="sp-input"
            style={{ flex: '2 1 220px' }}
            placeholder="https://example.com/feed"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            aria-label="feed url"
          />
          <button className="sp-mini" onClick={handleManualAdd} disabled={!manualUrl.trim()}>
            Add
          </button>
        </div>
      </div>
      <div className="sp-row">
        <button
          className="sp-btn"
          onClick={() => void handleSave()}
          disabled={saving || anyChecking || checkedCount === 0}
        >
          Save my sources
        </button>
        <button className="sp-btn ghost" onClick={() => void handleSuggestMore()} disabled={busy}>
          {busy && (
            <span className="sp-spin" aria-hidden="true">
              ◌{' '}
            </span>
          )}
          Suggest more
        </button>
        <button className="sp-btn ghost" onClick={() => setStep('brief')}>
          Back
        </button>
      </div>
      <div className="sp-row" style={{ marginTop: 6 }}>
        <button
          className="sp-chip"
          onClick={() =>
            void saveSources({ feeds: [], blogs: [], resources: [] }, context?.projects, area.trim())
          }
          disabled={saving}
        >
          continue without sources for now
        </button>
      </div>
    </div>
  );
}
