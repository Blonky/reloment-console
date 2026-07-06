import type { ReactNode } from 'react';
import styles from './Card.module.css';

export interface CardProps {
  title?: string;
  action?: ReactNode;
  padded?: boolean;
  className?: string;
  children: ReactNode;
}

export default function Card({
  title,
  action,
  padded = true,
  className,
  children,
}: CardProps) {
  const hasHeader = title !== undefined || action !== undefined;
  const classes = className ? `${styles.card} ${className}` : styles.card;
  return (
    <div className={classes}>
      {hasHeader && (
        <div className={styles.header}>
          {title !== undefined ? <span className={styles.title}>{title}</span> : <span />}
          {action !== undefined && <span className={styles.action}>{action}</span>}
        </div>
      )}
      <div className={padded ? styles.body : styles.bodyFlush}>{children}</div>
    </div>
  );
}
