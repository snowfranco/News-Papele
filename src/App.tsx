import { useState } from 'react';
import { CommandBar } from './components/CommandBar';
import { Masthead } from './components/Masthead';
import { Onboarding } from './components/Onboarding';
import { OutboxPanel } from './components/OutboxPanel';
import { SegmentedNav } from './components/SegmentedNav';
import { SourceManager } from './components/SourceManager';
import { Toast } from './components/Toast';
import { useStore } from './state/AppStore';
import { EditionView } from './views/EditionView';
import { PositionDeskView } from './views/PositionDeskView';
import { ThemeMapView } from './views/ThemeMapView';

export default function App() {
  const { loading, view, needsOnboarding, degraded, unreachable } = useStore();
  const [showOutbox, setShowOutbox] = useState(false);
  const [showSources, setShowSources] = useState(false);

  return (
    <div className="sp-root">
      <div className="sp-wrap">
        <Masthead />

        {loading && (
          <p className="sp-welcome" style={{ marginTop: 22 }}>
            Opening the cockpit…
          </p>
        )}

        {!loading && needsOnboarding && <Onboarding />}

        {!loading && !needsOnboarding && (
          <>
            <SegmentedNav
              showOutbox={showOutbox}
              onToggleOutbox={() => setShowOutbox((s) => !s)}
              onOpenSources={() => setShowSources((s) => !s)}
            />

            {unreachable.length > 0 && (
              <p className="sp-degraded">
                the backend is unreachable right now · showing what the cockpit
                can gather on its own · nothing is lost
              </p>
            )}
            {unreachable.length === 0 && degraded.length > 0 && (
              <p className="sp-degraded">
                some desks are not wired up yet ({degraded.join(', ')}) · run
                supabase/migrations to enable them · everything else works
              </p>
            )}

            {showOutbox && <OutboxPanel />}
            {showSources && <SourceManager onClose={() => setShowSources(false)} />}

            {view === 'edition' && <EditionView />}
            {view === 'map' && <ThemeMapView />}
            {view === 'desk' && <PositionDeskView />}
          </>
        )}
      </div>

      <Toast />
      {!loading && !needsOnboarding && <CommandBar />}
    </div>
  );
}
