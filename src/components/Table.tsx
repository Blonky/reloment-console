import type { ReactNode } from 'react';
import styles from './Table.module.css';

interface WithChildren {
  className?: string;
  children: ReactNode;
}

export function Table({ className, children }: WithChildren) {
  const classes = className ? `${styles.table} ${className}` : styles.table;
  return <table className={classes}>{children}</table>;
}

export function THead({ className, children }: WithChildren) {
  return <thead className={className}>{children}</thead>;
}

export function TBody({ className, children }: WithChildren) {
  const classes = className ? `${styles.tbody} ${className}` : styles.tbody;
  return <tbody className={classes}>{children}</tbody>;
}

export interface TRProps extends WithChildren {
  onClick?: () => void;
  clickable?: boolean;
}

export function TR({ className, children, onClick, clickable }: TRProps) {
  const classes = [styles.tr, clickable ? styles.clickable : undefined, className]
    .filter(Boolean)
    .join(' ');
  return (
    <tr className={classes} onClick={onClick}>
      {children}
    </tr>
  );
}

export interface THProps extends WithChildren {
  scope?: string;
}

export function TH({ className, children, scope = 'col' }: THProps) {
  const classes = className ? `${styles.th} ${className}` : styles.th;
  return (
    <th scope={scope} className={classes}>
      {children}
    </th>
  );
}

export interface TDProps extends WithChildren {
  num?: boolean;
}

export function TD({ className, children, num }: TDProps) {
  const classes = [styles.td, num ? styles.num : undefined, className].filter(Boolean).join(' ');
  return <td className={classes}>{children}</td>;
}
