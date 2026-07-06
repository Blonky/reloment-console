import { Link } from 'react-router-dom';
import { StatusPill } from '../components/index.ts';
import styles from './Topbar.module.css';

export interface TopbarProps {
  title: string;
  mode: 'demo' | 'http';
  killSwitch: boolean;
}

export default function Topbar({ title, mode, killSwitch }: TopbarProps) {
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
        {mode === 'demo' && <StatusPill tone="info">Demo data</StatusPill>}
        <span className={styles.sending}>
          <span className={styles.dot} />
          Sending active
        </span>
      </div>
    </header>
  );
}
