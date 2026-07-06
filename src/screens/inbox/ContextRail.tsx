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
import { useClient } from '../../shell/ClientContext.tsx';
import { firstNameOf, localTimeIn, shortDate } from './inboxUtils.ts';
import { SendIcon } from './icons.tsx';
import styles from './InboxScreen.module.css';

export interface ContextRailProps {
  detail: ThreadDetail | undefined;
  loading: boolean;
  onSimulate: (text: string) => Promise<void>;
  // 'docked' (default): the right pane of the cockpit grid. 'sheet': the
  // slide-over shown below 1100px; renders a close button, Escape closes.
  variant?: 'docked' | 'sheet';
  onClose?: () => void;
}

// Small ✕ glyph for the sheet header close button.
const CloseIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

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

export default function ContextRail({
  detail,
  loading,
  onSimulate,
  variant = 'docked',
  onClose,
}: ContextRailProps) {
  const client = useClient();
  const [draftReply, setDraftReply] = useState('');
  const [sending, setSending] = useState(false);
  const conversationId = detail?.conversation.id;
  const isSheet = variant === 'sheet';

  // Clear the composer when the selected conversation changes.
  useEffect(() => {
    setDraftReply('');
  }, [conversationId]);

  // Sheet mode: Escape closes.
  useEffect(() => {
    if (!isSheet || onClose === undefined) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose!();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSheet, onClose]);

  const paneClass = isSheet ? styles.sheetInner : `${styles.pane} ${styles.railPane}`;
  // Docked mode drops the "Context" pane title (§ decluttered — the rail's
  // contact card already names what this is). Sheet mode keeps a slim header
  // only to carry the close button.
  const head = isSheet ? (
    <div className={styles.paneHead}>
      <span className={styles.paneTitle}>Context</span>
      {onClose !== undefined && (
        <button
          type="button"
          className={styles.sheetClose}
          onClick={onClose}
          aria-label="Close context"
        >
          {CloseIcon}
        </button>
      )}
    </div>
  ) : null;

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
      <aside className={paneClass} aria-label="Context">
        {head}
        <div className={styles.scroll}>
          <RailSkeleton />
        </div>
      </aside>
    );
  }

  const { conversation, memory, consents } = detail;
  const renewal = shortDate(conversation.x_date);
  const first = firstNameOf(conversation.display_name);
  const ianaZone = conversation.timezone.split('/').pop()?.replaceAll('_', ' ') ?? conversation.timezone;
  // ONE compact fact line: policy status · renewal · local time (IANA zone in a
  // title tooltip on the time). Drops the 4-row grid + the Timezone row.
  const facts = [
    policyLabel(conversation.policy_status),
    renewal !== null ? `Renews ${renewal}` : null,
  ].filter((v): v is string => v !== null);
  // Memory capped at 3 (§ debloat — the rail must fit unscrolled).
  const memoryShown = memory.slice(0, 3);

  return (
    <aside className={paneClass} aria-label="Context">
      {head}

      <div className={styles.railScroll}>
        {/* Contact block: avatar + name + LOB, then ONE compact fact line. */}
        <div className={styles.railSection}>
          <div className={styles.railContactHead}>
            <Avatar name={conversation.display_name} size="lg" />
            <div className={styles.railContactId}>
              <div className={styles.railContactName}>{conversation.display_name}</div>
              <div className={styles.railContactSub}>{conversation.lob ?? 'No line of business'}</div>
            </div>
          </div>
          <div className={styles.factLine}>
            {facts.map((f, i) => (
              <span key={i}>
                {i > 0 && <span className={styles.factSep}>·</span>}
                {f}
              </span>
            ))}
            <span className={styles.factSep}>·</span>
            <span className="tnum" title={`Timezone: ${conversation.timezone}`}>
              {localTimeIn(conversation.timezone, client.now())} {ianaZone} time
            </span>
          </div>
        </div>

        {/* Consent — a tight single row under a smaller label. */}
        <div className={styles.railSectionTight}>
          <span className={styles.railSectionLabel}>Consent</span>
          <ConsentChips
            consents={consents.map((c) => c.scope)}
            timezone={conversation.timezone}
            optedOut={detail.optedOut}
          />
        </div>

        {/* Memory — capped at 3, quiet bullets. */}
        <div className={styles.railSectionTight}>
          <span className={styles.railSectionLabel}>Memory</span>
          {memoryShown.length === 0 ? (
            <span className={styles.simHint}>No memory atoms recorded yet.</span>
          ) : (
            <ul className={styles.memoryList}>
              {memoryShown.map((atom, i) => (
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

        {/* Simulate — a micro-label, an input row, and ghost chips. No boxed
            card, no 3-line explainer (§ debloat). START shows only while opted
            out; the compliance boundary is customer-only. */}
        <div className={styles.railSectionTight}>
          <span className={styles.railSectionLabel}>Simulate {first} · demo</span>
          <div className={styles.simInputRow}>
            <input
              className={styles.simInput}
              type="text"
              value={draftReply}
              placeholder="Type a reply as the customer…"
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
          <div className={styles.simChips}>
            <button
              type="button"
              className={styles.simGhostChip}
              disabled={sending}
              onClick={() => void send('STOP')}
            >
              STOP
            </button>
            {detail.optedOut && (
              <button
                type="button"
                className={styles.simGhostChip}
                disabled={sending}
                onClick={() => void send('START')}
              >
                START
                <span className={styles.simChipCaption}>opts back in</span>
              </button>
            )}
          </div>
          <span className={styles.simHint}>
            {detail.optedOut ? 'Only the customer can opt back in.' : 'STOP records an opt-out.'}
          </span>
        </div>
      </div>
    </aside>
  );
}
