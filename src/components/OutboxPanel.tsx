import { useStore } from '../state/AppStore';

/** Everything queued for manifold, newest first. */
export function OutboxPanel() {
  const { outbox } = useStore();
  const queued = outbox.filter((o) => o.status === 'queued');

  return (
    <div className="sp-out" aria-label="manifold outbox">
      {queued.length === 0 && (
        <div className="sp-dhint">
          Nothing queued yet. Park a theme, add a note, or ask manifold to take an action.
        </div>
      )}
      {queued.map((o) => (
        <div className="sp-outi" key={o.id}>
          <span className="sp-outk">{o.kind}</span> — {o.label}
        </div>
      ))}
    </div>
  );
}
