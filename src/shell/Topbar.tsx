import { Link } from 'react-router-dom';
import DemoControls from './DemoControls.tsx';
import Notifications from './Notifications.tsx';
import styles from './Topbar.module.css';

export interface TopbarProps {
  title: string;
  mode: 'demo' | 'http';
  killSwitch: boolean;
  onOpenNav: () => void;
}

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

export default function Topbar({ title, mode, killSwitch, onOpenNav }: TopbarProps) {
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

  // Desktop right, left→right: the removable "Demo data" chip · notifications bell
  // · the persistent "Sending active" status pill. The status pill is the
  // always-true system-state anchor (rightmost); the demo chip is the ONE
  // removable affordance (leftmost, self-contained). On mobile only the bell
  // stays here — the demo chip + status row move into the nav drawer footer.
  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <Hamburger onOpenNav={onOpenNav} />
        <span className={styles.wordmark}>Reloment</span>
        <span className={styles.title}>{title}</span>
      </div>
      <div className={styles.right}>
        {mode === 'demo' && (
          <span className={styles.mobileHidden}>
            <DemoControls />
          </span>
        )}
        <Notifications />
        <Link
          to="/settings"
          className={`${styles.sending} ${styles.mobileHidden}`}
          aria-label="Sending active — open Settings"
        >
          <span className={styles.dot} />
          Sending active
        </Link>
      </div>
    </header>
  );
}
