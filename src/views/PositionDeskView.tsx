// The position desk: where reading becomes a defensible take. Everything
// recorded here lands in positions and is announced to manifold through the
// outbox; the desk works with or without themes because learning is never
// gated by what manifold has charted so far.
import { useMemo, useState } from 'react';
import { POSITION_READY_READS } from '../config';
import { shortDate } from '../lib/format';
import { useStore } from '../state/AppStore';
import type { PositionKind, Theme } from '../types';

const CHALLENGES: { kind: PositionKind; title: string; blurb: string }[] = [
  {
    kind: 'explain_back',
    title: 'Explain it back',
    blurb: 'Explain the idea in your own words, to someone sharp outside the field.',
  },
  {
    kind: 'contrarian',
    title: 'Defend the contrarian view',
    blurb: 'Argue the strongest opposite case like you mean it.',
  },
  {
    kind: 'hot_take',
    title: 'Hot take',
    blurb: 'One spicy, defensible sentence. Then back it up.',
  },
];

/** The theme the desk focuses when none is chosen: in progress beats
 * everything, then read count breaks ties. */
function mostPositionReady(themes: Theme[]): Theme | null {
  let best: Theme | null = null;
  let bestScore = -1;
  for (const t of themes) {
    const score = (t.mastery === 'progress' ? 1000 : 0) + t.reads;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

function deskHeadline(theme: Theme | null): string {
  if (!theme) return 'You can still take positions before manifold charts your beat.';
  if (theme.reads >= POSITION_READY_READS) return `You can defend a take on “${theme.label}”.`;
  const left = POSITION_READY_READS - theme.reads;
  return `You are ${left} ${left === 1 ? 'read' : 'reads'} from a take on “${theme.label}”.`;
}

export function PositionDeskView() {
  const {
    themes,
    positions,
    focusThemeId,
    setFocusThemeId,
    recordPosition,
    publishPosition,
    sendToManifold,
    say,
  } = useStore();

  const theme = useMemo(() => {
    if (themes.length === 0) return null;
    return (
      themes.find((t) => t.id === focusThemeId) ?? mostPositionReady(themes) ?? themes[0] ?? null
    );
  }, [themes, focusThemeId]);

  const [colTitle, setColTitle] = useState('');
  const [colBody, setColBody] = useState('');
  const [rebuttal, setRebuttal] = useState('');
  const [advocateOpen, setAdvocateOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const columnDrafts = useMemo(
    () =>
      positions
        .filter((p) => p.kind === 'column' && p.status === 'draft')
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)),
    [positions],
  );

  const published = useMemo(
    () =>
      positions
        .filter((p) => p.kind === 'column' && p.status === 'published')
        .sort((a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0)),
    [positions],
  );

  const canPublish = colTitle.trim() !== '' && colBody.trim() !== '';

  const clearColumn = () => {
    setColTitle('');
    setColBody('');
    setRebuttal('');
    setAdvocateOpen(false);
  };

  const sendForChallenge = async () => {
    const title = colTitle.trim();
    const body = colBody.trim();
    if (!title || !body || publishing) return;
    setPublishing(true);
    const saved = await recordPosition({
      themeId: theme?.id ?? null,
      kind: 'column',
      title,
      body,
      status: 'draft',
    });
    if (saved) {
      const counter = rebuttal.trim();
      if (counter) {
        await recordPosition({
          themeId: theme?.id ?? null,
          kind: 'contrarian',
          title: `self-challenge · ${title}`,
          body: counter,
          status: 'draft',
        });
      }
      void sendToManifold('publish-column', title, { themeId: theme?.id ?? null, challenged: false });
      say('at the challenge desk · manifold will push back');
      clearColumn();
    }
    setPublishing(false);
  };

  const publishNow = async () => {
    const title = colTitle.trim();
    const body = colBody.trim();
    if (!title || !body || publishing) return;
    setPublishing(true);
    const saved = await recordPosition({
      themeId: theme?.id ?? null,
      kind: 'column',
      title,
      body,
      status: 'published',
    });
    if (saved) {
      void sendToManifold('publish-column', title, { themeId: theme?.id ?? null, published: true });
      say('published');
      clearColumn();
    }
    setPublishing(false);
  };

  const promoteDraft = async (id: string) => {
    if (await publishPosition(id)) say('published');
  };

  return (
    <div>
      <div className="sp-kicker">position desk · prove you understood it</div>

      {theme && (
        <div style={{ margin: '0 0 14px' }}>
          <select
            className="sp-select"
            aria-label="theme in focus"
            value={theme.id}
            onChange={(e) => setFocusThemeId(e.target.value)}
          >
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <h1 className="sp-lede" style={{ fontSize: 26, marginBottom: 6 }}>
        {deskHeadline(theme)}
      </h1>
      {theme && (
        <div
          className="sp-prog"
          role="img"
          aria-label={`${Math.min(theme.reads, POSITION_READY_READS)} of ${POSITION_READY_READS} reads toward a position`}
        >
          {Array.from({ length: POSITION_READY_READS }, (_, i) => (
            <i key={i} className={i < theme.reads ? 'on' : ''} />
          ))}
        </div>
      )}

      <hr className="sp-hair" />

      <div className="sp-kicker">challenge desk · thinking that gets recorded</div>
      {CHALLENGES.map((c) => (
        <ChallengeCard key={c.kind} kind={c.kind} title={c.title} blurb={c.blurb} theme={theme} />
      ))}

      <hr className="sp-hair" />

      <div className="sp-kicker">publish your column · manifold plays devil's advocate first</div>
      <label className="sp-fieldlabel" htmlFor="sp-column-title">
        column title
      </label>
      <input
        id="sp-column-title"
        className="sp-input"
        value={colTitle}
        onChange={(e) => setColTitle(e.target.value)}
        placeholder="Say it in one strong line…"
        style={{ marginBottom: 10 }}
      />
      <label className="sp-fieldlabel" htmlFor="sp-column-body">
        the argument
      </label>
      <textarea
        id="sp-column-body"
        className="sp-textarea"
        value={colBody}
        onChange={(e) => setColBody(e.target.value)}
        placeholder="Make the case as you would to a sharp colleague…"
        style={{ marginBottom: 10 }}
      />
      <div className="sp-row">
        <button className="sp-btn red" disabled={!canPublish} onClick={() => setAdvocateOpen(true)}>
          Publish your column
        </button>
        <span className="sp-emeta">manifold plays devil's advocate first</span>
      </div>
      {advocateOpen && (
        <div className="sp-applybox">
          <p>
            Before this goes out: what is the strongest case against it? manifold will push back
            on its next run. You can answer now or let it come to you.
          </p>
          <textarea
            className="sp-textarea"
            aria-label="the strongest case against your column"
            value={rebuttal}
            onChange={(e) => setRebuttal(e.target.value)}
            placeholder="Optional: steelman the other side…"
            style={{ marginBottom: 10 }}
          />
          <div className="sp-row" style={{ marginBottom: 0 }}>
            <button className="sp-btn" disabled={publishing} onClick={() => void sendForChallenge()}>
              Send for challenge
            </button>
            <button className="sp-btn ghost" disabled={publishing} onClick={() => void publishNow()}>
              Publish now
            </button>
          </div>
        </div>
      )}

      {columnDrafts.length > 0 && (
        <>
          <hr className="sp-hair" />
          <div className="sp-kicker">drafts at the challenge desk</div>
          <div className="sp-pubs">
            {columnDrafts.map((p) => (
              <div className="sp-pub" key={p.id}>
                <span className="sp-pubt">{p.title}</span>
                <span
                  style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexShrink: 0 }}
                >
                  <span className="sp-pubd">awaiting devil's advocate</span>
                  <button className="sp-mini" onClick={() => void promoteDraft(p.id)}>
                    Publish now
                  </button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <hr className="sp-hair" />

      {published.length > 0 ? (
        <>
          <div className="sp-kicker">
            published · {published.length} {published.length === 1 ? 'column' : 'columns'}
          </div>
          <div className="sp-pubs">
            {published.map((p) => (
              <div className="sp-pub" key={p.id}>
                <span className="sp-pubt">{p.title}</span>
                <span className="sp-pubd">{shortDate(p.publishedAt)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="sp-dhint">
          Nothing published yet. The first column is the hardest and the best.
        </div>
      )}
    </div>
  );
}

function ChallengeCard({
  kind,
  title,
  blurb,
  theme,
}: {
  kind: PositionKind;
  title: string;
  blurb: string;
  theme: Theme | null;
}) {
  const { recordPosition, sendToManifold, say } = useStore();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const record = async () => {
    const text = body.trim();
    if (!text || saving) return;
    setSaving(true);
    const fullTitle = `${title} · ${theme?.label ?? 'general'}`;
    const saved = await recordPosition({
      themeId: theme?.id ?? null,
      kind,
      title: fullTitle,
      body: text,
      status: 'draft',
    });
    setSaving(false);
    if (saved) {
      void sendToManifold('challenge-response', fullTitle, { themeId: theme?.id ?? null, kind });
      say('recorded at the desk');
      setBody('');
      setOpen(false);
    }
  };

  const empty = body.trim() === '';

  return (
    <div className="sp-challenge">
      <h3>{title}</h3>
      <p>{blurb}</p>
      <button className="sp-mini" aria-expanded={open} onClick={() => setOpen((s) => !s)}>
        {open ? 'Close' : 'Take it on'}
      </button>
      {open && (
        <>
          <textarea
            className="sp-textarea"
            aria-label={title}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write it the way you would say it…"
            style={{ margin: '10px 0' }}
          />
          <div className="sp-row" style={{ marginBottom: 0 }}>
            <button
              className="sp-mini"
              disabled={empty || saving}
              style={empty || saving ? { opacity: 0.45, cursor: 'default' } : undefined}
              onClick={() => void record()}
            >
              Record it
            </button>
          </div>
        </>
      )}
    </div>
  );
}
