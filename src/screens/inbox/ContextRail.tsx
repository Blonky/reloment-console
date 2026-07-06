// Context rail — the right pane. Contact card (LOB, policy status, renewal date,
// timezone + computed local time), Memory (atoms as quiet bullets with
// provenance), consent chips, and a demo-only "Simulate customer reply" input
// with a one-click STOP quick-chip. On send it calls simulateInbound and the
// screen refetches — an opt-out visibly flips the thread state (DESIGN.md §5).

import { useEffect, useState } from 'react';
import {
  Avatar,
  Button,
  ConsentChips,
  Skeleton,
} from '../../components/index.ts';
import type { ThreadDetail } from '../../data/types.ts';
import { localTimeIn, shortDate } from './inboxUtils.ts';
import { SendIcon } from './icons.tsx';
import styles from './InboxScreen.module.css';

export interface ContextRailProps {
  detail: ThreadDetail | undefined;
  loading: boolean;
  onSimulate: (text: string) => Promise<void>;
}

function policyLabel(status: string | null): string {
  if (status === null) return '—';
  const map: Record<string, string> = {
    active: 'Active',
    new_lead: 'New lead',
    lapsed_quote: 'Lapsed quote',
  };
  return map[status] ?? status;
}

function RailSkeleton() {
  return (
    <div className={styles.railBlock} aria-hidden="true">
      <Skeleton width={120} height={14} />
      <Skeleton width="100%" height={12} />
      <Skeleton width="80%" height={12} />
      <Skeleton width="100%" height={64} radius="var(--radius)" />
    </div>
  );
}

export default function ContextRail({ detail, loading, onSimulate }: ContextRailProps) {
  const [draftReply, setDraftReply] = useState('');
  const [sending, setSending] = useState(false);
  const conversationId = detail?.conversation.id;

  // Clear the composer when the selected conversation changes.
  useEffect(() => {
    setDraftReply('');
  }, [conversationId]);

  async function send(text: string) {
    const body = text.trim();
    if (body === '' || sending) return;
    setSending(true);
    try {
      await onSimulate(body);
      setDraftReply('');
    } finally {
      setSending(false);
    }
  }

  if (loading || detail === undefined) {
    return (
      <aside className={`${styles.pane} ${styles.railPane}`} aria-label="Context">
        <div className={styles.paneHead}>
          <span className={styles.paneTitle}>Context</span>
        </div>
        <div className={styles.scroll}>
          <RailSkeleton />
        </div>
      </aside>
    );
  }

  const { conversation, memory, consents } = detail;
  const renewal = shortDate(conversation.x_date);

  return (
    <aside className={`${styles.pane} ${styles.railPane}`} aria-label="Context">
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>Context</span>
      </div>

      <div className={styles.railScroll}>
        {/* Contact card */}
        <div className={styles.railSection}>
          <div className={styles.railContactHead}>
            <Avatar name={conversation.display_name} size="lg" />
            <div>
              <div className={styles.railContactName}>{conversation.display_name}</div>
              <div className={styles.railContactSub}>{conversation.lob ?? 'No line of business'}</div>
            </div>
          </div>
          <div className={styles.factGrid}>
            <span className={styles.factKey}>Policy</span>
            <span className={styles.factVal}>{policyLabel(conversation.policy_status)}</span>
            <span className={styles.factKey}>Renewal</span>
            <span className={`${styles.factVal} tnum`}>{renewal ?? '—'}</span>
            <span className={styles.factKey}>Timezone</span>
            <span className={styles.factVal}>{conversation.timezone.split('/').pop()?.replaceAll('_', ' ')}</span>
            <span className={styles.factKey}>Local time</span>
            <span className={`${styles.factVal} tnum`}>{localTimeIn(conversation.timezone)}</span>
          </div>
        </div>

        {/* Consent */}
        <div className={styles.railSection}>
          <span className={styles.railSectionTitle}>Consent</span>
          <ConsentChips
            consents={consents.map((c) => c.scope)}
            timezone={conversation.timezone}
            optedOut={detail.optedOut}
          />
        </div>

        {/* Memory */}
        <div className={styles.railSection}>
          <span className={styles.railSectionTitle}>Memory</span>
          {memory.length === 0 ? (
            <span className={styles.simHint}>No memory atoms recorded for this contact yet.</span>
          ) : (
            <ul className={styles.memoryList}>
              {memory.map((atom, i) => (
                <li key={`${atom.source}-${i}`} className={styles.memoryItem}>
                  <span className={styles.memoryBullet} />
                  <span className={styles.memoryBody}>
                    <span>{atom.value}</span>
                    <span className={styles.memoryProvenance}>
                      {atom.source.replaceAll('_', ' ')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Simulate customer reply — demo affordance */}
        <div className={styles.railSection}>
          <span className={styles.railSectionTitle}>Simulate customer reply</span>
          <div className={styles.simCard}>
            <p className={styles.simNote}>
              Demo only — send a message as {conversation.display_name.split(' ')[0]} to watch the
              governed loop respond in real time.
            </p>
            <div className={styles.simInputRow}>
              <input
                className={styles.simInput}
                type="text"
                value={draftReply}
                placeholder="Type a reply…"
                aria-label="Simulated customer message"
                disabled={sending}
                onChange={(e) => setDraftReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void send(draftReply);
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                aria-label="Send simulated reply"
                disabled={sending || draftReply.trim() === ''}
                onClick={() => void send(draftReply)}
              >
                <SendIcon />
              </Button>
            </div>
            <div className={styles.simQuick}>
              <button
                type="button"
                className={styles.stopChip}
                disabled={sending}
                onClick={() => void send('STOP')}
              >
                Send “STOP”
              </button>
              <span className={styles.simHint}>records an opt-out</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
