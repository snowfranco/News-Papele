// The citation atom: a quiet, footnote-style marker next to any
// manifold-authored text, and a source sheet that opens on tap or Enter.
// Designed once, reused on the Edition, Theme map, and Position desk so the
// reader learns it once (build prompt: Surface citations across Superlearn).
//
// Groundedness is legible: every cited source is one tap away, with two ways
// to act on it, "Open article" (external) and "Open in Feeds" (internal deep
// link, so the reader never has to leave Superlearn). When a surface has no
// cited ids recorded, the marker renders in a disabled state with an honest
// tooltip rather than hiding, so the gap is visible (never invented sources).
//
// Structural elements are spans styled as blocks on purpose: a marker sits
// inside <p>/<h1>, where a <div> descendant is invalid nesting.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { shortDate } from '../lib/format';
import { useStore } from '../state/AppStore';

export function Citations({
  ids,
  label,
  display,
}: {
  /** Cited reading_items ids. Empty renders the disabled "no sources" marker. */
  ids: string[];
  /** Human name of the claim, for the accessible label ("sources for {label}"). */
  label: string;
  /** Optional marker content (e.g. an emerging card's meta line); defaults to
   * a small chevron in the meta type. */
  display?: ReactNode;
}) {
  const { resolveCitations, openInFeeds } = useStore();
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const markerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLSpanElement>(null);
  const sheetId = useId();

  const sources = ids.length > 0 ? resolveCitations(ids) : [];
  const disabled = sources.length === 0;

  // Click-away closes; Esc and focus loss are handled on the wrapper below.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Flip the popover to right-align when a marker near the right edge would
  // otherwise clip the sheet off-screen (the desktop case; the mobile bottom
  // sheet is full width). Measured before paint so there is no visible jump.
  useLayoutEffect(() => {
    if (!open) {
      setAlignRight(false);
      return;
    }
    const el = sheetRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) setAlignRight(true);
  }, [open]);

  const marker = display ?? <span className="sp-cite-mark" aria-hidden="true">⌃</span>;

  if (disabled) {
    return (
      <span
        className="sp-cite disabled"
        aria-disabled="true"
        title="no sources recorded"
        aria-label={`no sources recorded for ${label}`}
      >
        {marker}
      </span>
    );
  }

  const close = () => {
    setOpen(false);
    markerRef.current?.focus();
  };

  return (
    <span
      className="sp-cite"
      ref={wrapRef}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={markerRef}
        type="button"
        className="sp-cite-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? sheetId : undefined}
        aria-label={`sources for ${label}`}
        onClick={() => setOpen((s) => !s)}
      >
        {marker}
      </button>

      {open && (
        <>
          {/* Mobile-only dim behind the bottom sheet; a no-op layer on desktop. */}
          <span className="sp-cite-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
          <span
            ref={sheetRef}
            className={alignRight ? 'sp-citesheet align-right' : 'sp-citesheet'}
            id={sheetId}
            role="dialog"
            aria-label={`sources for ${label}`}
          >
            <span className="sp-citehead">
              {sources.length} source{sources.length === 1 ? '' : 's'}
            </span>
            {sources.map((s) => (
              <span className="sp-citerow" key={s.itemId}>
                <span className="sp-citemain">
                  <span className="sp-citetitle">{s.title}</span>
                  <span className="sp-citemeta">
                    <span className="sp-citesrc">
                      <span
                        className="sp-citechip"
                        style={{ background: s.sourceColor ?? 'var(--muted)' }}
                        aria-hidden="true"
                      />
                      {s.source ?? (s.resolved ? 'unknown source' : 'not in the loaded window')}
                    </span>
                    {s.publishedAt && <span className="sp-citedate">{shortDate(s.publishedAt)}</span>}
                    {s.read && <span className="sp-citeread">read</span>}
                  </span>
                </span>
                <span className="sp-citeacts">
                  {s.url && (
                    <a
                      className="sp-citeact"
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open article
                    </a>
                  )}
                  <button
                    className="sp-citeact"
                    type="button"
                    onClick={() => {
                      openInFeeds(s.itemId);
                      setOpen(false);
                    }}
                  >
                    Open in Feeds
                  </button>
                </span>
              </span>
            ))}
          </span>
        </>
      )}
    </span>
  );
}
