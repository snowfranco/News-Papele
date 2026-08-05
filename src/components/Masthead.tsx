import { useStore } from '../state/AppStore';
import { mastheadMeta } from '../lib/format';

export function Masthead() {
  const { edition } = useStore();
  return (
    <header>
      <div className="sp-mast">
        <span className="sp-paper">the superlearn dispatch</span>
        <span className="sp-meta">
          {mastheadMeta(edition?.editionNo ?? null, edition?.beat ?? null)}
        </span>
      </div>
      <hr className="sp-rule" />
    </header>
  );
}
