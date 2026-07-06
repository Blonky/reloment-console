// ArtifactCard — the compact reply artifact (DESIGN.md §5, "Artifacts, not
// dumps"). A command's table/detail never dumps into the transcript; instead the
// reply shows a compact card — icon, title, count, one-line summary, and a
// "View table →" affordance — that opens the shared Inspector with the full
// content. This is the modern AI-workspace pattern: a chat reply is a card that
// opens a side panel, not a wall of rows.

import { useState, type ReactNode } from 'react';
import Inspector from '../../shell/Inspector.tsx';
import styles from './HomeScreen.module.css';

export interface ArtifactCardProps {
  icon: ReactNode;
  title: string;
  // A compact count chip (e.g. "5 contacts", "3 playbooks"). Optional.
  count?: string;
  // One-line summary under the title.
  summary: string;
  // The affordance label; defaults to "View table →".
  action?: string;
  // The Inspector's header title; defaults to `title`.
  inspectorTitle?: string;
  // Desktop Inspector width (§5 default 520).
  inspectorWidth?: number;
  // The full content rendered inside the Inspector.
  children: ReactNode;
}

export default function ArtifactCard({
  icon,
  title,
  count,
  summary,
  action = 'View table',
  inspectorTitle,
  inspectorWidth,
  children,
}: ArtifactCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={styles.artifact}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span className={styles.artifactIcon}>{icon}</span>
        <span className={styles.artifactMain}>
          <span className={styles.artifactTitleRow}>
            <span className={styles.artifactTitle}>{title}</span>
            {count && <span className={styles.artifactCount}>{count}</span>}
          </span>
          <span className={styles.artifactSummary}>{summary}</span>
        </span>
        <span className={styles.artifactAction}>
          {action}
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 7h8M7.5 3.5L11 7l-3.5 3.5" />
          </svg>
        </span>
      </button>
      <Inspector
        open={open}
        onClose={() => setOpen(false)}
        title={inspectorTitle ?? title}
        width={inspectorWidth}
      >
        {children}
      </Inspector>
    </>
  );
}
