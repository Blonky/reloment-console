import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Sidebar from './Sidebar.tsx';
import Topbar from './Topbar.tsx';
import CommandPalette from './CommandPalette.tsx';
import styles from './AppShell.module.css';

export interface AppShellProps {
  killSwitch: boolean;
  mode: 'demo' | 'http';
  title: string;
  children: ReactNode;
}

export default function AppShell({ killSwitch, mode, title, children }: AppShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  // Global ⌘K / Ctrl+K toggles the palette from anywhere in the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.column}>
        <Topbar title={title} mode={mode} killSwitch={killSwitch} onOpenPalette={openPalette} />
        <main className={styles.main}>
          <div className={styles.content}>{children}</div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}
