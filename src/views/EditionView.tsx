import { useState } from 'react';
import { Citations } from '../components/Citations';
import { useStore } from '../state/AppStore';
import type { EditionEmerging, EditionLede, Project } from '../types';

// Static, honestly-labeled stand-in so the horizon lane is always present on
// the front page even when an edition carries no horizon cards (hard rule:
// horizon learning is first-class and never gated by projects).
const HORIZON_CARD: EditionEmerging = {
  themeId: null,
  tag: 'horizon',
  title: 'What is rising',
  note: 'manifold watches for early signal beyond your projects: new ideas gaining trajectory before they are loud.',
  meta: 'always on',
  lane: 'horizon',
  // A UI stand-in, not a manifold claim: no sources to cite, so its marker
  // stays in the honest disabled state.
  itemIds: [],
};

/** Guarantee a horizon card among the (max 3) displayed emerging cards. */
function emergingCards(emerging: EditionEmerging[]): EditionEmerging[] {
  const cards = emerging.slice(0, 3);
  if (!cards.some((e) => e.lane === 'horizon')) {
    const later = emerging.find((e) => e.lane === 'horizon') ?? HORIZON_CARD;
    if (cards.length === 3) cards[2] = later;
    else cards.push(later);
  }
  return cards;
}

/** The front page: welcome, lede, emerging themes, and where to start. */
export function EditionView() {
  const { edition, projectById, sendToManifold, markRead, openInFeeds } = useStore();
  const [applyOpen, setApplyOpen] = useState(false);

  if (!edition) {
    return (
      <div className="sp-empty">
        <h3>Your first edition is on its way</h3>
        <p>
          manifold reads across the sources you chose and shapes what it finds into a small daily
          edition — a lede worth your attention, what is emerging around it, and where to start.
          Nothing piles up in the meantime.
        </p>
        <button
          className="sp-btn"
          onClick={() =>
            void sendToManifold('request-edition', 'first edition requested from the cockpit')
          }
        >
          Ask manifold for an edition
        </button>
      </div>
    );
  }

  const lede = edition.lede;
  const applyProject = lede ? projectById(lede.applyProjectId) : undefined;
  const cards = emergingCards(edition.emerging);
  const startHere = edition.startHere;
  const totalMinutes = startHere.reduce((sum, r) => sum + r.minutes, 0);

  const startReading = (l: EditionLede) => {
    if (l.url) window.open(l.url, '_blank', 'noopener');
    void sendToManifold('start-reading', l.title, { itemIds: l.itemIds });
    const first = l.itemIds[0];
    if (first) markRead(first);
  };

  const sendToProject = (l: EditionLede, p: Project) => {
    void sendToManifold('send-to-project', `${l.title} → ${p.label}`, {
      projectId: p.id,
      itemIds: l.itemIds,
    });
    setApplyOpen(false);
  };

  return (
    <div>
      <p className="sp-welcome">{edition.welcome}</p>

      {lede && (
        <>
          <div className="sp-kicker">{lede.kicker}</div>
          <h1 className="sp-lede">
            {lede.title} <Citations ids={lede.itemIds} label="the lede" />
          </h1>
          <p className="sp-deck">{lede.deck}</p>
          <div className="sp-why">
            <b>why this leads</b>
            <p>
              {lede.why} <Citations ids={lede.itemIds} label="why this leads" />
            </p>
          </div>
          <div className="sp-row">
            {applyProject && (
              <button
                className="sp-apply"
                aria-expanded={applyOpen}
                onClick={() => setApplyOpen((s) => !s)}
              >
                apply to → {applyProject.label}
              </button>
            )}
            <button className="sp-btn" onClick={() => startReading(lede)}>
              Start the reading
            </button>
            <button
              className="sp-btn ghost"
              onClick={() => void sendToManifold('park', lede.title, { itemIds: lede.itemIds })}
            >
              Park for later
            </button>
          </div>
          {applyProject && applyOpen && (
            <div className="sp-applybox">
              <p>
                This maps onto {applyProject.label}. manifold tagged it because the lede&rsquo;s
                thread feeds that build.
              </p>
              <button className="sp-btn" onClick={() => sendToProject(lede, applyProject)}>
                Send to {applyProject.label} context
              </button>
            </div>
          )}
          <hr className="sp-hair" />
        </>
      )}

      <div className="sp-kicker">also emerging</div>
      <div className={cards.length === 3 ? 'sp-emerge three' : 'sp-emerge'}>
        {cards.map((e, i) => (
          <div className="sp-ecard" key={e.themeId ?? `${e.title}-${i}`}>
            <span className={e.lane === 'horizon' ? 'sp-etag horizon' : 'sp-etag'}>{e.tag}</span>
            <div className="sp-etitle">{e.title}</div>
            <p className="sp-enote">{e.note}</p>
            {/* Live citation: manifold persists emerging[].itemIds
                (manifold/src/editorial.ts; gate citation-ids-present). Older
                editions written before that carry none and fall back to the
                disabled marker. */}
            <Citations
              ids={e.itemIds}
              label={e.title}
              display={<span className="sp-emeta">{e.meta}</span>}
            />
          </div>
        ))}
      </div>

      {startHere.length > 0 && (
        <>
          <hr className="sp-hair" />
          <div className="sp-kicker">
            start here · {startHere.length} reads · ~{totalMinutes} min
          </div>
          {startHere.map((r, i) => (
            <div className="sp-sh" key={r.itemId ?? `${r.title}-${i}`}>
              <span className="sp-shmin">{r.minutes} min</span>
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    if (r.itemId) markRead(r.itemId);
                  }}
                >
                  <span className="sp-shtitle">{r.title}</span>{' '}
                  <span className="sp-shnote">— {r.note}</span>
                </a>
              ) : (
                <div>
                  <span className="sp-shtitle">{r.title}</span>{' '}
                  <span className="sp-shnote">— {r.note}</span>
                </div>
              )}
              {/* A Start Here row is a single article, so the row is its own
                  external link; this adds the internal deep link into Feeds so
                  the reader can park, mark read, or assign it without leaving. */}
              {r.itemId && (
                <button
                  type="button"
                  className="sp-cite-feeds"
                  onClick={() => openInFeeds(r.itemId as string)}
                  aria-label={`open ${r.title} in Feeds`}
                >
                  <span aria-hidden="true">⌃</span> Feeds
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
