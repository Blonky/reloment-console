import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { DataClient } from '../data/client.ts';

export interface ClientContextValue {
  client: DataClient;
  killSwitch: boolean;
  setKillSwitch: (on: boolean) => void;
}

export const ClientContext = createContext<ClientContextValue | null>(null);

export interface ClientProviderProps {
  client: DataClient;
  killSwitch: boolean;
  setKillSwitch: (on: boolean) => void;
  children: ReactNode;
}

export function ClientProvider({
  client,
  killSwitch,
  setKillSwitch,
  children,
}: ClientProviderProps) {
  return (
    <ClientContext.Provider value={{ client, killSwitch, setKillSwitch }}>
      {children}
    </ClientContext.Provider>
  );
}

export function useClient(): DataClient {
  const ctx = useContext(ClientContext);
  if (ctx === null) {
    throw new Error('useClient must be used within a ClientProvider');
  }
  return ctx.client;
}

export function useKillSwitch(): {
  killSwitch: boolean;
  setKillSwitch: (on: boolean) => void;
} {
  const ctx = useContext(ClientContext);
  if (ctx === null) {
    throw new Error('useKillSwitch must be used within a ClientProvider');
  }
  return { killSwitch: ctx.killSwitch, setKillSwitch: ctx.setKillSwitch };
}
