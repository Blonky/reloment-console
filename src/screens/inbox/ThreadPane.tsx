// Thread pane — day-grouped bubbles. Inbound left on --surface-2, outbound right
// on --accent-soft with ink text at 15px. Outbound bubbles carry a ChannelBadge
// + delivery status. System events (routed-to-human, holds, blocks, takeover,
// opt-out) render as centered hairline timeline entries with GateReason where
// applicable — never bubbles. Auto-scrolls to newest on load/change.

import { useEffect, useRef } from 'react';
import { Avatar, ChannelBadge, GateReason, StatusPill, Skeleton } from '../../components/index.ts';
import type { BadgeChannel } from '../../components/index.ts';
import type { ApproveResult, ThreadDetail, ThreadMessage } from '../../data/types.ts';
import { useClient } from '../../shell/ClientContext.tsx';
import DraftCard from './DraftCard.tsx';
import {
  blockedReason,
  clockTime,
  dayKey,
  dayLabel,
  isSystemEvent,
  localTimeIn,
} from './inboxUtils.ts';
import styles from './InboxScreen.module.css';

export interface ThreadPaneProps {
  detail: ThreadDetail | undefined;
  loading: boolean;
  pendingDraft: ThreadMessage | undefined;
  playbookLabel: string;
  onApprove: (draftId: string) => Promise<ApproveResult>;
  onEdit: (draftId: string, body: string) => Promise<void>;
  onTakeover: () => Promise<void>;
}

// System timeline entry text — plain-English, calm.
function SystemEntry({ message }: { message: ThreadMessage }) {
  const reason = blockedReason(message.status);
  if (reason !== null) {
    return (
      <div className={styles.systemEntry}>
        <div className={styles.systemInner}>
          <GateReason reason={reason} variant="row" />
        </div>
      </div>
    );
  }
  if (message.status === 'routed_to_human') {
    return (
      <div className={styles.systemEntry}>
        <div className={styles.systemInner}>
          <span className={styles.systemLabel}>Routed to a licensed human</span>
          <span>· agent stood down on this thread</span>
        </div>
      </div>
    );
  }
  if (message.status === 'held') {
    return (
      <div className={styles.systemEntry}>
        <div className={styles.systemInner}>
          <span className={styles.systemLabel}>You took over</span>
          <span>· the agent stood down; this thread is yours</span>
        </div>
      </div>
    );
  }
  return null;
}

function Bubble({ message }: { message: ThreadMessage }) {
  const outbound = message.direction === 'outbound';
  const channel = message.channel_accepted;
  return (
    <div className={`${styles.bubbleRow} ${outbound ? styles.outbound : styles.inbound}`}>
      <div className={styles.bubbleGroup}>
        <div className={`${styles.bubble} ${outbound ? styles.bubbleOut : styles.bubbleIn}`}>
          {message.body}
        </div>
        <div className={`${styles.bubbleMeta} ${outbound ? '' : styles.inMeta}`}>
          {outbound && channel !== null && (
            <ChannelBadge channel={channel as BadgeChannel} />
          )}
          {outbound && message.status === 'sent' && channel !== null && (
            <span className={styles.deliveryDot}>Delivered</span>
          )}
          <span className={`${styles.bubbleTime} tnum`}>{clockTime(message.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className={styles.threadSkeleton} aria-hidden="true">
      <div className={styles.bubbleRow}>
        <Skeleton width="52%" height={44} radius="14px" />
      </div>
      <div className={`${styles.bubbleRow} ${styles.outbound}`}>
        <Skeleton width="60%" height={64} radius="14px" />
      </div>
      <div className={styles.bubbleRow}>
        <Skeleton width="40%" height={36} radius="14px" />
      </div>
    </div>
  );
}

export default function ThreadPane({
  detail,
  loading,
  pendingDraft,
  playbookLabel,
  onApprove,
  onEdit,
  onTakeover,
}: ThreadPaneProps) {
  const client = useClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const conversationId = detail?.conversation.id;
  const messageCount = detail?.messages.length ?? 0;

  // Auto-scroll to newest on load/change (new conversation, new message, new draft).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversationId, messageCount, pendingDraft?.id, pendingDraft?.body]);

  if (loading || detail === undefined) {
    return (
      <section className={`${styles.pane} ${styles.threadPane}`} aria-label="Conversation">
        <div className={styles.threadHead}>
          <Skeleton width={32} height={32} radius="999px" />
          <div className={styles.threadHeadMain}>
            <Skeleton width={140} height={13} />
          </div>
        </div>
        <div className={styles.threadScroll}>
          <ThreadSkeleton />
        </div>
      </section>
    );
  }

  const { conversation, messages } = detail;

  // Bubbles = non-system, non-pending-draft messages. The pending draft renders
  // in the DraftCard, not as a bubble. Group the rest by day.
  const timeline = messages.filter((m) => m.id !== pendingDraft?.id);

  let lastDay = '';

  return (
    <section className={`${styles.pane} ${styles.threadPane}`} aria-label="Conversation">
      <div className={styles.threadHead}>
        <Avatar name={conversation.display_name} size="md" />
        <div className={styles.threadHeadMain}>
          <span className={styles.threadHeadName}>{conversation.display_name}</span>
          <span className={`${styles.threadHeadSub} tnum`}>
            {conversation.e164} · {localTimeIn(conversation.timezone, client.now())} local
          </span>
        </div>
        <span className={styles.threadHeadSpacer} />
        {detail.optedOut ? (
          <StatusPill tone="block">Opted out</StatusPill>
        ) : conversation.controller === 'human' ? (
          <StatusPill tone="info">You have this thread</StatusPill>
        ) : (
          <StatusPill tone="neutral">Agent handling</StatusPill>
        )}
      </div>

      <div className={styles.threadScroll} ref={scrollRef}>
        {timeline.map((m) => {
          const key = dayKey(m.created_at);
          const showDivider = key !== lastDay;
          lastDay = key;
          return (
            <div key={m.id}>
              {showDivider && (
                <div className={styles.dayDivider}>
                  <span className={styles.dayLabel}>{dayLabel(m.created_at, client.now())}</span>
                </div>
              )}
              {isSystemEvent(m) ? <SystemEntry message={m} /> : <Bubble message={m} />}
            </div>
          );
        })}

        {detail.optedOut && (
          <div className={styles.systemEntry}>
            <div className={styles.systemInner}>
              <GateReason reason="opted_out" variant="row" />
            </div>
          </div>
        )}
      </div>

      {pendingDraft !== undefined && (
        <DraftCard
          draftId={pendingDraft.id}
          body={pendingDraft.body}
          playbookLabel={playbookLabel}
          consents={detail.consents.map((c) => c.scope)}
          timezone={conversation.timezone}
          optedOut={detail.optedOut}
          onApprove={onApprove}
          onEdit={onEdit}
          onTakeover={onTakeover}
        />
      )}
    </section>
  );
}
