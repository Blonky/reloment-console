import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar, {
  SidebarNav,
  SidebarSearch,
  SidebarChats,
  SettingsRow,
  TenantCard,
} from './Sidebar.tsx';
import Topbar from './Topbar.tsx';
import CommandPalette from './CommandPalette.tsx';
import { LiveDataProvider } from './LiveData.tsx';
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

  // Mobile nav drawer (≤768px). Opened from the topbar hamburger.
  const [navOpen, setNavOpen] = useState(false);
  const openNav = useCallback(() => setNavOpen(true), []);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const drawerRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

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

  // Close the drawer on route change (a nav pill was tapped) so it never lingers.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Drawer: Escape closes; focus moves into the drawer on open.
  useEffect(() => {
    if (!navOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setNavOpen(false);
    }
    window.addEventListener('keydown', onKey);
    // Move focus into the drawer for keyboard users.
    drawerRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <LiveDataProvider>
      <div className={styles.shell}>
        <Sidebar onOpenPalette={openPalette} onCloseNav={closeNav} />
        <div className={styles.column}>
          <Topbar
            title={title}
            mode={mode}
            killSwitch={killSwitch}
            onOpenPalette={openPalette}
            onOpenNav={openNav}
          />
          <main className={styles.main}>
            <div className={styles.content}>{children}</div>
          </main>
        </div>

        {/* Mobile nav drawer — a left slide-in with the same nav pills + tenant. */}
        {navOpen && (
          <>
            <div
              className={styles.drawerScrim}
              onMouseDown={closeNav}
              aria-hidden="true"
            />
            <nav
              className={styles.drawer}
              aria-label="Primary"
              ref={drawerRef}
              tabIndex={-1}
            >
              <div className={styles.drawerHead}>
                <span className={styles.drawerWordmark}>Reloment</span>
                <button
                  type="button"
                  className={styles.drawerClose}
                  onClick={closeNav}
                  aria-label="Close menu"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 18 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
                  </svg>
                </button>
              </div>
              <SidebarSearch
                onOpenPalette={() => {
                  closeNav();
                  openPalette();
                }}
              />
              <SidebarNav onNavigate={closeNav} />
              <SidebarChats onNavigate={closeNav} />
              <SettingsRow onNavigate={closeNav} />
              <TenantCard />
            </nav>
          </>
        )}

        <CommandPalette open={paletteOpen} onClose={closePalette} />
      </div>
    </LiveDataProvider>
  );
}
