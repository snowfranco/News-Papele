import { useStore } from '../state/AppStore';

export function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return (
    <div className="sp-toast" role="status" aria-live="polite">
      <div>{toast}</div>
    </div>
  );
}
