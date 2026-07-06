// Triage list — the left pane. Rows sorted needs-you-first: awaiting-approval
// conversations float to the top, opted-out settle to the bottom. Selection is
// URL-driven (?c=<conversationId>) so threads deep-link. Loading skeletons and a
// designed empty state per DESIGN.md §5.

import { Avatar, EmptyState, StatusPill, Skeleton } from '../../components/index.ts';
import type { TriageTag } from './inboxUtils.ts';
import { relativeTime } from './inboxUtils.ts';
import { useClient } from '../../shell/ClientContext.tsx';
import styles from './InboxScreen.module.css';

export interface TriageRowModel {
  conversationId: string;
  contactId: string;
  name: string;
  preview: string;
  lastAt: string;
  unread: boolean;
  tag: TriageTag;
  weight: number;
}

export interface TriagePaneProps {
  rows: TriageRowModel[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (conversationId: string) => void;
}

function RowSkeleton() {
  return (
    <div className={styles.skeletonRow}>
      <Skeleton width={32} height={32} radius="999px" />
      <div className={styles.skeletonRowMain}>
        <Skeleton height={12} width="55%" />
        <Skeleton height={11} width="90%" />
        <Skeleton height={16} width="40%" radius="999px" />
      </div>
    </div>
  );
}

export default function TriagePane({
  rows,
  loading,
  selectedId,
  onSelect,
}: TriagePaneProps) {
  const client = useClient();
  return (
    <section className={`${styles.pane} ${styles.triagePane}`} aria-label="Triage">
      {/* Slim header — the topbar already says "Inbox"; here we only quantify.
          Demo affordances moved to the topbar "Demo controls" popover (r10). */}
      <div className={styles.triageHead}>
        {!loading && (
          <span className={styles.triageHeadCount}>
            {rows.length} {rows.length === 1 ? 'conversation' : 'conversations'}
          </span>
        )}
      </div>
      <div className={styles.scroll}>
        {loading ? (
          <div className={styles.triageList} aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className={styles.centerFill}>
            <EmptyState message="No conversations yet. Enroll a playbook from Home and drafts land here for your approval." />
          </div>
        ) : (
          <ul className={styles.triageList} style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {rows.map((row) => {
              const selected = row.conversationId === selectedId;
              return (
                <li key={row.conversationId}>
                  <button
                    type="button"
                    className={`${styles.triageRow} ${selected ? styles.selected : ''}`}
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => onSelect(row.conversationId)}
                  >
                    <Avatar name={row.name} size="md" />
                    <span className={styles.triageMain}>
                      <span className={styles.triageTopLine}>
                        <span
                          className={`${styles.triageName} ${row.unread ? styles.unread : ''}`}
                        >
                          {row.name}
                        </span>
                        <span className={`${styles.triageTime} tnum`}>
                          {relativeTime(row.lastAt, client.now())}
                        </span>
                      </span>
                      <span className={styles.triagePreview}>{row.preview}</span>
                      <span className={styles.triageTagRow}>
                        <StatusPill tone={row.tag.tone}>{row.tag.label}</StatusPill>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
