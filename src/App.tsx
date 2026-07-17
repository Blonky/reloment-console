import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { createClient } from './data/client.ts';
import { ClientProvider } from './shell/ClientContext.tsx';
import AuthGate from './shell/AuthGate.tsx';
import AppShell from './shell/AppShell.tsx';
import { Skeleton } from './components/index.ts';

// Route-level code splitting: each screen is its own chunk, fetched on first
// navigation. Default exports are preserved, so lazy() consumes them directly.
const HomeScreen = lazy(() => import('./screens/home/HomeScreen.tsx'));
const InboxScreen = lazy(() => import('./screens/inbox/InboxScreen.tsx'));
const ContactsScreen = lazy(() => import('./screens/contacts/ContactsScreen.tsx'));
// Campaigns + Agents merged into ONE "Agent" surface (r10). /campaigns and
// /agents redirect to /agent below.
const AgentScreen = lazy(() => import('./screens/agent/AgentScreen.tsx'));
const InsightsScreen = lazy(() => import('./screens/insights/InsightsScreen.tsx'));
// Trust & Settings became "Settings" (r13) — admin, moved out of main nav into a
// quiet sidebar-bottom row. /trust redirects to /settings to keep old deep links.
const SettingsScreen = lazy(() => import('./screens/trust/TrustScreen.tsx'));

// Minimal centered fallback while a route chunk loads — one shimmering block,
// never a spinner (DESIGN.md §4).
function RouteFallback() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '40vh',
        width: '100%',
      }}
    >
      <Skeleton width={280} height={20} />
    </div>
  );
}

const TITLES: Record<string, string> = {
  '/': 'Home',
  '/inbox': 'Inbox',
  '/contacts': 'Contacts',
  '/agent': 'Agent',
  '/insights': 'Insights',
  '/settings': 'Settings',
};

export function App() {
  const client = useMemo(createClient, []);
  const [killSwitch, setKillSwitchState] = useState(false);
  // Bumped when a sign-in completes, so the reads below run again with a session
  // instead of staying stuck on whatever the anonymous attempt returned.
  const [authNonce, setAuthNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client
      .home()
      .then((pulse) => {
        if (!cancelled) setKillSwitchState(pulse.killSwitch);
      })
      .catch(() => {
        /* ignore — the shell tolerates an unreachable (or unauthenticated) read */
      });
    return () => {
      cancelled = true;
    };
  }, [client, authNonce]);

  const setKillSwitch = useCallback((on: boolean) => {
    setKillSwitchState(on);
  }, []);

  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? 'Home';

  return (
    <ClientProvider client={client} killSwitch={killSwitch} setKillSwitch={setKillSwitch}>
      {/* Nothing renders until the backend says who we are. A real install shows
          the sign-in screen here; a demo/dev one reports authRequired:false and
          falls straight through. */}
      <AuthGate onAuthed={() => setAuthNonce((n) => n + 1)}>
      <AppShell killSwitch={killSwitch} mode={client.mode} title={title}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/inbox" element={<InboxScreen />} />
            <Route path="/contacts" element={<ContactsScreen />} />
            <Route path="/agent" element={<AgentScreen />} />
            {/* Legacy routes redirect to the merged Agent surface (r10). */}
            <Route path="/campaigns" element={<Navigate to="/agent" replace />} />
            <Route path="/agents" element={<Navigate to="/agent" replace />} />
            <Route path="/insights" element={<InsightsScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
            {/* Trust & Settings → Settings (r13); keep old deep links working. */}
            <Route path="/trust" element={<Navigate to="/settings" replace />} />
          </Routes>
        </Suspense>
      </AppShell>
      </AuthGate>
    </ClientProvider>
  );
}
