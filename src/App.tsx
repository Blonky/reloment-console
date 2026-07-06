import { useCallback, useEffect, useMemo, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { createClient } from './data/client.ts';
import { ClientProvider } from './shell/ClientContext.tsx';
import AppShell from './shell/AppShell.tsx';
import HomeScreen from './screens/home/HomeScreen.tsx';
import InboxScreen from './screens/inbox/InboxScreen.tsx';
import ContactsScreen from './screens/contacts/ContactsScreen.tsx';
import CampaignsScreen from './screens/campaigns/CampaignsScreen.tsx';
import AgentsScreen from './screens/agents/AgentsScreen.tsx';
import InsightsScreen from './screens/insights/InsightsScreen.tsx';
import TrustScreen from './screens/trust/TrustScreen.tsx';

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
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/inbox" element={<InboxScreen />} />
          <Route path="/contacts" element={<ContactsScreen />} />
          <Route path="/campaigns" element={<CampaignsScreen />} />
          <Route path="/agents" element={<AgentsScreen />} />
          <Route path="/insights" element={<InsightsScreen />} />
          <Route path="/trust" element={<TrustScreen />} />
        </Routes>
      </AppShell>
    </ClientProvider>
  );
}
