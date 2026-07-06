import { Link } from 'react-router-dom';
import DemoControls from './DemoControls.tsx';
import Notifications from './Notifications.tsx';
import styles from './Topbar.module.css';

export interface TopbarProps {
  title: string;
  mode: 'demo' | 'http';
  killSwitch: boolean;
  onOpenPalette: () => void;
  onOpenNav: () => void;
}

// Show ⌘K on Apple platforms, Ctrl K elsewhere.
const isMac =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

// Hamburger button — only visible ≤768px (CSS-gated). Opens the nav drawer.
function Hamburger({ onOpenNav }: { onOpenNav: () => void }) {
  return (
    <button
      type="button"
      className={styles.hamburger}
      onClick={onOpenNav}
      aria-label="Open menu"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
      </svg>
    </button>
  );
}

export default function Topbar({ title, mode, killSwitch, onOpenPalette, onOpenNav }: TopbarProps) {
  if (killSwitch) {
    return (
      <header className={`${styles.topbar} ${styles.paused}`}>
        <div className={styles.left}>
          <Hamburger onOpenNav={onOpenNav} />
          <span className={`${styles.title} ${styles.pausedTitle}`}>{title}</span>
        </div>
        <div className={styles.pausedRight}>
          <span className={styles.pausedText}>All sending paused</span>
          <Link to="/settings" className={styles.resumeLink}>
            Resume in Settings
          </Link>
        </div>
      </header>
    );
  }

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <Hamburger onOpenNav={onOpenNav} />
        <span className={styles.wordmark}>Reloment</span>
        <span className={styles.title}>{title}</span>
      </div>
      <div className={styles.right}>
        <button
          type="button"
          className={styles.paletteHint}
          onClick={onOpenPalette}
          aria-label="Open command palette"
          aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
        >
          <span className={styles.paletteKbd}>{isMac ? '⌘' : 'Ctrl'}</span>
          <span className={styles.paletteKbd}>K</span>
        </button>
        <Notifications />
        {mode === 'demo' && <DemoControls />}
        <Link
          to="/settings"
          className={styles.sending}
          aria-label="Sending active — open Settings"
        >
          <span className={styles.dot} />
          Sending active
        </Link>
      </div>
    </header>
  );
}
