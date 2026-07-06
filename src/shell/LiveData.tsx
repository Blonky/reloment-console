// LiveData — the single shared subscription for the live-recursive workspace
// (round 12). ONE client.subscribe() at the shell level feeds a small context
// consumed by BOTH the topbar notifications (badge + popover) and Home (Today
// band, asks strip, pulse strip). This is the simplest correct architecture:
// instead of two independent subscriptions racing the same feed, a single
// debounced (~400ms) refetch of homeBriefing() + agentAsks() + home() updates
// every live surface at once — approving Dana's draft in another tab decrements
// the badge and Home's "Approvals waiting" together.
//
// Sessions (the sidebar Chats list + Home's transcript) also live here: they
// mutate only from Home actions and sidebar deletes (both local), so a shared
// list with an explicit refresh keeps the sidebar and Home in agreement without
// a second subscription.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useClient } from './ClientContext.tsx';
import type { AgentAsk, AgentSession, HomeBriefing, HomePulse } from '../data/types.ts';

interface LiveDataValue {
  pulse: HomePulse | undefined;
  briefing: HomeBriefing | undefined;
  asks: AgentAsk[];
  // The topbar badge count — approvals waiting + agent asks (live derived, not a
  // read-state; clearing nothing, per the brief).
  unread: number;
  sessions: AgentSession[];
  // Force an immediate refetch of the live reads (called after a mutating Home
  // command so the numbers react without waiting for the feed debounce).
  refreshLive: () => void;
  // Refetch the session list (after create / delete / rename).
  refreshSessions: () => void;
}

const LiveDataContext = createContext<LiveDataValue | null>(null);

export function LiveDataProvider({ children }: { children: ReactNode }) {
  const client = useClient();

  const [pulse, setPulse] = useState<HomePulse | undefined>(undefined);
  const [briefing, setBriefing] = useState<HomeBriefing | undefined>(undefined);
  const [asks, setAsks] = useState<AgentAsk[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);

  // Refetch the three live reads together. Guarded so a late resolve after
  // unmount never sets state.
  const aliveRef = useRef(true);
  const refreshLive = useCallback(() => {
    void Promise.all([client.home(), client.homeBriefing(), client.agentAsks()]).then(
      ([p, b, a]) => {
        if (!aliveRef.current) return;
        setPulse(p);
        setBriefing(b);
        setAsks(a);
      },
    );
  }, [client]);

  const refreshSessions = useCallback(() => {
    void client.agentSessions().then((list) => {
      if (aliveRef.current) setSessions(list);
    });
  }, [client]);

  // Initial load + one subscription for the whole app. Any feed event schedules
  // a single debounced (~400ms) refetch so a burst of events coalesces.
  useEffect(() => {
    aliveRef.current = true;
    refreshLive();
    refreshSessions();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = client.subscribe(() => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refreshLive();
      }, 400);
    });

    return () => {
      aliveRef.current = false;
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [client, refreshLive, refreshSessions]);

  const approvals =
    briefing?.needsYou
      .filter((n) => n.label === 'Approvals waiting')
      .reduce((s, n) => s + n.count, 0) ?? 0;
  const unread = approvals + asks.length;

  const value: LiveDataValue = {
    pulse,
    briefing,
    asks,
    unread,
    sessions,
    refreshLive,
    refreshSessions,
  };

  return <LiveDataContext.Provider value={value}>{children}</LiveDataContext.Provider>;
}

export function useLiveData(): LiveDataValue {
  const ctx = useContext(LiveDataContext);
  if (ctx === null) {
    throw new Error('useLiveData must be used within a LiveDataProvider');
  }
  return ctx;
}
