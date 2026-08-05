import { useStore } from '../state/AppStore';
import type { ViewKey } from '../types';

const VIEWS: [ViewKey, string][] = [
  ['edition', 'Edition'],
  ['map', 'Theme map'],
  ['desk', 'Position desk'],
];

export function SegmentedNav({
  showOutbox,
  onToggleOutbox,
  onOpenSources,
}: {
  showOutbox: boolean;
  onToggleOutbox: () => void;
  onOpenSources: () => void;
}) {
  const { view, setView, outbox } = useStore();
  const queued = outbox.filter((o) => o.status === 'queued').length;

  return (
    <nav className="sp-nav" aria-label="Superlearn views">
      <div className="sp-seg" role="tablist">
        {VIEWS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={view === key}
            className={view === key ? 'on' : ''}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="sp-navside">
        <button className="sp-chip" onClick={onOpenSources}>
          sources
        </button>
        <button
          className="sp-chip"
          onClick={onToggleOutbox}
          aria-expanded={showOutbox}
          aria-label={`manifold outbox, ${queued} queued`}
        >
          <span className="sp-dot" /> manifold · {queued} queued
        </button>
      </div>
    </nav>
  );
}
