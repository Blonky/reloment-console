import { Link } from 'react-router-dom';
import { StatusPill } from '../components/index.ts';
import styles from './Topbar.module.css';

export interface TopbarProps {
  title: string;
  mode: 'demo' | 'http';
  killSwitch: boolean;
  onOpenPalette: () => void;
}

// Show ⌘K on Apple platforms, Ctrl K elsewhere.
const isMac =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export default function Topbar({ title, mode, killSwitch, onOpenPalette }: TopbarProps) {
  if (killSwitch) {
    return (
      <header className={`${styles.topbar} ${styles.paused}`}>
        <span className={`${styles.title} ${styles.pausedTitle}`}>{title}</span>
        <div className={styles.pausedRight}>
          <span className={styles.pausedText}>All sending paused</span>
          <Link to="/trust" className={styles.resumeLink}>
            Resume in Trust &amp; Settings
          </Link>
        </div>
      </header>
    );
  }

  return (
    <header className={styles.topbar}>
      <span className={styles.title}>{title}</span>
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
        {mode === 'demo' && <StatusPill tone="info">Demo data</StatusPill>}
        <span className={styles.sending}>
          <span className={styles.dot} />
          Sending active
        </span>
      </div>
    </header>
  );
}
