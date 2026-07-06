import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { createClient } from './data/client.ts';
import { ClientProvider } from './shell/ClientContext.tsx';
import AppShell from './shell/AppShell.tsx';
import { Skeleton } from './components/index.ts';

// Route-level code splitting: each screen is its own chunk, fetched on first
// navigation. Default exports are preserved, so lazy() consumes them directly.
const HomeScreen = lazy(() => import('./screens/home/HomeScreen.tsx'));
const InboxScreen = lazy(() => import('./screens/inbox/InboxScreen.tsx'));
const ContactsScreen = lazy(() => import('./screens/contacts/ContactsScreen.tsx'));
const CampaignsScreen = lazy(() => import('./screens/campaigns/CampaignsScreen.tsx'));
const AgentsScreen = lazy(() => import('./screens/agents/AgentsScreen.tsx'));
const InsightsScreen = lazy(() => import('./screens/insights/InsightsScreen.tsx'));
const TrustScreen = lazy(() => import('./screens/trust/TrustScreen.tsx'));

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
  '/campaigns': 'Campaigns',
  '/agents': 'Agents',
  '/insights': 'Insights',
  '/trust': 'Trust & Settings',
};

export function App() {
  const client = useMemo(createClient, []);
  const [killSwitch, setKillSwitchState] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client
      .home()
      .then((pulse) => {
        if (!cancelled) setKillSwitchState(pulse.killSwitch);
      })
      .catch(() => {
        /* ignore — the shell tolerates an unreachable home read */
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const setKillSwitch = useCallback((on: boolean) => {
    setKillSwitchState(on);
  }, []);

  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? 'Home';

  return (
    <ClientProvider client={client} killSwitch={killSwitch} setKillSwitch={setKillSwitch}>
      <AppShell killSwitch={killSwitch} mode={client.mode} title={title}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/inbox" element={<InboxScreen />} />
            <Route path="/contacts" element={<ContactsScreen />} />
            <Route path="/campaigns" element={<CampaignsScreen />} />
            <Route path="/agents" element={<AgentsScreen />} />
            <Route path="/insights" element={<InsightsScreen />} />
            <Route path="/trust" element={<TrustScreen />} />
          </Routes>
        </Suspense>
      </AppShell>
    </ClientProvider>
  );
}
