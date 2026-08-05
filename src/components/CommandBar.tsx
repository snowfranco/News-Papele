import { useState } from 'react';
import { useStore } from '../state/AppStore';

/** The sticky manifold command bar. Free text goes to the outbox as a note;
 * manifold reads the queue on its next run. */
export function CommandBar() {
  const { sendToManifold } = useStore();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    const ok = await sendToManifold('note', trimmed, { source: 'command-bar' });
    if (ok) setText('');
    setSending(false);
  }

  return (
    <div className="sp-barwrap">
      <div className="sp-bar">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
          placeholder="Tell manifold something: a note, a park, an action to take…"
          aria-label="Message to manifold"
        />
        <button className="sp-btn" onClick={() => void send()} disabled={sending || !text.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
