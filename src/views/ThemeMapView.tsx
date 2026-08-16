// The theme map: the constellation plus a detail panel for the focused star.
// Projects are a lens on themes, never a filter; horizon themes stand alone.
import { useState } from 'react';
import { Citations } from '../components/Citations';
import { useStore } from '../state/AppStore';
import type { Theme } from '../types';
import { Constellation, HORIZON_STAR_PATH } from './Constellation';
import type { ConstellationSelection } from './Constellation';

export function ThemeMapView() {
  const {
    themes,
    themeLinks,
    context,
    sendToManifold,
    setView,
    setFocusThemeId,
    resolveCitations,
    openInFeeds,
    markRead,
    say,
  } = useStore();
  const projects = context?.projects ?? [];

  const [selected, setSelected] = useState<ConstellationSelection | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');

  const handleSelect = (sel: ConstellationSelection) => {
    setSelected(sel);
    setNoteOpen(false);
    setNoteText('');
  };

  const requestChart = () => {
    void sendToManifold('request-edition', 'chart my theme map');
  };

  /** "Read next" on a theme: open a real article the theme is built on, and
   * file the read-next signal so manifold still weights this theme higher in
   * the next edition. The button's label promises action, so it must do
   * something visible; the signal alone is a note, not a read (the queue
   * exists for asynchronous editorial work, not for interactive clicks).
   *
   * Uses the theme's persisted item_ids (themes gained an item_ids column in
   * supabase/migrations/20260816000000_theme_item_ids.sql). Pre-migration
   * themes carry none and gracefully degrade to the queue-only behavior with
   * an honest toast; every branch also fires the outbox signal so the intent
   * still flows to manifold. */
  const readNext = (t: Theme) => {
    // The signal always goes out, whether or not we can open an article now.
    void sendToManifold('read-next', t.label, { themeId: t.id });

    if (t.itemIds.length === 0) {
      say('no reads recorded on this theme yet · filed for the next edition');
      return;
    }

    const sources = resolveCitations(t.itemIds);
    const withUrl = sources
      .filter((s) => s.resolved && s.url)
      .sort(
        (a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0),
      );

    if (withUrl.length === 0) {
      // Ids resolve to items with no url (unusual), or none resolve in the
      // loaded window: send the reader to the Feeds bench focused on the
      // first known id, so there is always somewhere useful to land.
      const fallback = sources.find((s) => s.resolved) ?? sources[0];
      if (fallback) openInFeeds(fallback.itemId);
      say('opening the reads in Feeds · filed for the next edition');
      return;
    }

    // Prefer the freshest unread piece; if the reader has already read all of
    // them, open the freshest anyway (rereading is a legitimate move) and
    // toast the truth.
    const unread = withUrl.find((s) => !s.read);
    const target = unread ?? withUrl[0]!;
    window.open(target.url as string, '_blank', 'noopener,noreferrer');
    markRead(target.itemId);
    say(
      unread
        ? 'opened the next read · filed for manifold'
        : 'you have read them all · opened the freshest, filed for the next edition',
    );
  };

  if (themes.length === 0 && projects.length === 0) {
    return (
      <div>
        <div className="sp-kicker">the theme map · your beat, charted</div>
        <div className="sp-empty">
          <h3>Your beat has not been charted yet</h3>
          <p>
            manifold reads your sources and charts what keeps coming up: themes as stars, your
            projects as anchors, connections as constellations. The first chart appears after its
            first pass.
          </p>
          <button className="sp-btn" onClick={requestChart}>
            Ask manifold to chart it
          </button>
        </div>
      </div>
    );
  }

  const theme = selected?.kind === 'theme' ? selected.theme : null;
  const project = selected?.kind === 'project' ? selected.project : null;
  const selectedId = theme?.id ?? project?.id ?? null;

  const feedLabels = (t: Theme): string[] =>
    themeLinks
      .filter((l) => l.kind === 'project' && l.sourceId === t.id)
      .map((l) => projects.find((p) => p.id === l.targetId)?.label)
      .filter((label): label is string => label !== undefined);
  const feeds = theme ? feedLabels(theme) : [];

  const draftPosition = (t: Theme) => {
    void sendToManifold('draft-position', t.label, { themeId: t.id });
    setFocusThemeId(t.id);
    setView('desk');
  };

  const saveNote = (t: Theme) => {
    const note = noteText.trim();
    if (!note) return;
    void sendToManifold('add-note', `note on ${t.label}`, { themeId: t.id, note });
    setNoteText('');
    setNoteOpen(false);
  };

  return (
    <div>
      <div className="sp-kicker">the theme map · your beat, charted</div>
      <div className="sp-maprow">
        <div>
          <div className="sp-mapcard">
            <Constellation
              themes={themes}
              projects={projects}
              links={themeLinks}
              selectedId={selectedId}
              onSelect={handleSelect}
            />
            <div className="sp-legend">
              <span>
                <svg width="14" height="14" aria-hidden="true">
                  <circle cx="7" cy="7" r="5" fill="none" stroke="#8a8794" strokeDasharray="2 2" />
                </svg>
                unread
              </span>
              <span>
                <svg width="14" height="14" aria-hidden="true">
                  <circle cx="7" cy="7" r="5" fill="#0e9e90" fillOpacity="0.9" />
                </svg>
                in progress
              </span>
              <span>
                <svg width="16" height="14" aria-hidden="true">
                  <circle cx="8" cy="7" r="4" fill="#0e9e90" />
                  <circle cx="8" cy="7" r="6.5" fill="none" stroke="#e0356b" strokeWidth="1.5" />
                </svg>
                position formed
              </span>
              <span>
                <svg width="16" height="14" aria-hidden="true">
                  <rect x="2" y="3" width="12" height="8" rx="1" fill="#33302a" />
                </svg>
                your project
              </span>
              <span>
                <svg width="14" height="14" aria-hidden="true">
                  <path d={HORIZON_STAR_PATH} transform="translate(7 7) scale(1.2)" fill="#7a3ff0" />
                </svg>
                horizon
              </span>
            </div>
          </div>
          {themes.length === 0 && (
            <div style={{ marginTop: 12 }}>
              <p className="sp-dhint" style={{ margin: '0 0 8px' }}>
                Your projects are anchored. manifold charts themes around them as it reads.
              </p>
              <button className="sp-btn" onClick={requestChart}>
                Ask manifold to chart it
              </button>
            </div>
          )}
        </div>

        <div className="sp-detail">
          {selected === null && (
            <p className="sp-dhint">
              Tap a star to focus it. You will see how far you have taken the idea, what it
              connects to, and which project it feeds.
            </p>
          )}

          {project && (
            <div>
              <div className="sp-dtitle">{project.label}</div>
              <div className="sp-dmeta">your project</div>
              <p className="sp-dwhy">
                Themes wired to this bet appear as connected stars. manifold routes reading here
                when it applies.
              </p>
            </div>
          )}

          {theme && (
            <div>
              <div className="sp-dtitle">{theme.label}</div>
              <div className="sp-dmeta">
                {theme.discipline} · {theme.mastery} · {theme.reads} reads · {theme.lane}
              </div>
              {/* Live citation: manifold persists themes.item_ids
                  (manifold/src/editorial.ts; gate citation-ids-present). Themes
                  written before that carry none and show the disabled marker. */}
              <p className="sp-dwhy">
                {theme.why} <Citations ids={theme.itemIds} label={`why ${theme.label} matters`} />
              </p>
              {feeds.length > 0 && (
                <p className="sp-dwhy" style={{ color: 'var(--ink2)', fontSize: 14 }}>
                  Feeds: {feeds.join(', ')}
                </p>
              )}
              {feeds.length === 0 && theme.lane === 'horizon' && (
                <p
                  className="sp-dwhy"
                  style={{ color: 'var(--ink2)', fontSize: 14, fontStyle: 'italic' }}
                >
                  Free-floating: horizon signal, tied to no project yet. That is the point.
                </p>
              )}
              <div className="sp-acts">
                <button className="sp-mini" onClick={() => readNext(theme)}>
                  Read next
                </button>
                <button className="sp-mini" onClick={() => draftPosition(theme)}>
                  Draft a position
                </button>
                <button
                  className="sp-mini"
                  onClick={() => void sendToManifold('park', theme.label, { themeId: theme.id })}
                >
                  Park
                </button>
                <button className="sp-mini" onClick={() => setNoteOpen((s) => !s)}>
                  Add note
                </button>
              </div>
              {noteOpen && (
                <div style={{ marginTop: 10 }}>
                  <textarea
                    className="sp-textarea"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder={`A note on ${theme.label} for manifold to file.`}
                    aria-label={`note on ${theme.label}`}
                  />
                  <div className="sp-acts" style={{ marginTop: 7 }}>
                    <button className="sp-mini" onClick={() => saveNote(theme)}>
                      Save note
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
