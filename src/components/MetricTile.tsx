import { Link } from 'react-router-dom';
import styles from './MetricTile.module.css';

export interface MetricTileProps {
  label: string;
  value: string;
  sub?: string;
  tone?: 'ink' | 'ok';
  to?: string;
}

export default function MetricTile({ label, value, sub, tone = 'ink', to }: MetricTileProps) {
  const valueClass = tone === 'ok' ? `${styles.value} ${styles.ok}` : styles.value;
  const inner = (
    <>
      <span className={styles.label}>{label}</span>
      <span className={valueClass}>{value}</span>
      {sub !== undefined && <span className={styles.sub}>{sub}</span>}
    </>
  );

  if (to !== undefined) {
    return (
      <Link to={to} className={`${styles.tile} ${styles.link}`}>
        {inner}
      </Link>
    );
  }
  return <div className={styles.tile}>{inner}</div>;
}
