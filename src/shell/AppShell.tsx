import type { ReactNode } from 'react';
import Sidebar from './Sidebar.tsx';
import Topbar from './Topbar.tsx';
import styles from './AppShell.module.css';

export interface AppShellProps {
  killSwitch: boolean;
  mode: 'demo' | 'http';
  title: string;
  children: ReactNode;
}

export default function AppShell({ killSwitch, mode, title, children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.column}>
        <Topbar title={title} mode={mode} killSwitch={killSwitch} />
        <main className={styles.main}>
          <div className={styles.content}>{children}</div>
        </main>
      </div>
    </div>
  );
}
