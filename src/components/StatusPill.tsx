import type { ReactNode } from 'react';
import styles from './StatusPill.module.css';

export type StatusTone = 'ok' | 'hold' | 'block' | 'info' | 'neutral';

export interface StatusPillProps {
  tone: StatusTone;
  children: ReactNode;
}

export default function StatusPill({ tone, children }: StatusPillProps) {
  return <span className={`${styles.pill} ${styles[tone]}`}>{children}</span>;
}
