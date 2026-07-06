// Thread pane — day-grouped bubbles. Inbound left on --surface-2, outbound right
// on --accent-soft with ink text at 15px. Outbound bubbles carry a ChannelBadge
// + delivery status. System events (routed-to-human, holds, blocks, opt-out)
// render as centered hairline timeline entries with GateReason where applicable —
// never bubbles. Auto-scrolls to newest on load/change.
//
// Messages-first v4: the bottom anchor is the Composer (always available unless
// opted out) with the agent's next-best SuggestionSlot above it. A quiet Agent
// ON/OFF switch lives in the header. No DraftCard, no Take over, no consent strip.

import { useEffect, useRef } from 'react';
import { Avatar, ChannelBadge, GateReason, StatusPill, Skeleton } from '../../components/index.ts';
import type { BadgeChannel } from '../../components/index.ts';
import type { ApproveResult, Suggestion, ThreadDetail, ThreadMessage } from '../../data/types.ts';
import { useClient } from '../../shell/ClientContext.tsx';
import AgentToggle from './AgentToggle.tsx';
import Composer, { type ComposerHandle } from './Composer.tsx';
import SuggestionSlot from './SuggestionSlot.tsx';
import { SparkleIcon } from './icons.tsx';
import {
  blockedReason,
  clockTime,
  dayKey,
  dayLabel,
  firstNameOf,
  isSystemEvent,
  localTimeIn,
  systemEventLabel,
} from './inboxUtils.ts';
import styles from './InboxScreen.module.css';

// Who (if anyone) is currently typing in the selected conversation. null = idle.
export type TypingState = { who: 'customer' | 'agent' } | null;

export interface ThreadPaneProps {
  detail: ThreadDetail | undefined;
  loading: boolean;
  // The agent's next-best message for the suggestion slot (null = silence).
  suggestion: Suggestion | null;
  // Live typing indicator for the selected conversation (from the event feed).
  typing: TypingState;
  // Whether sending is globally active (kill switch off) — gates the "Live" dot.
  sendingActive: boolean;
  onApprove: (draftId: string) => Promise<ApproveResult>;
  // Send a free-text message as the business (sendManual). Resolves false if the
  // gate blocked it.
  onSend: (body: string) => Promise<boolean>;
  // Flip the per-conversation Agent ON/OFF switch.
  onToggleAgent: (enabled: boolean) => Promise<void>;
  // Opens the context sheet — the button is CSS-hidden above 1100px, where the
  // rail is docked in the grid instead.
  onOpenContext: () => void;
  // Opens the conversation-brief Inspector overlay.
  onOpenBrief: () => void;
  // Mobile back chevron: clears ?c= to return to the triage list. CSS-hidden
  // above 768px, where both panes are visible side by side.
  onBack: () => void;
}

// Small info glyph for the "Context" toggle button (shown <1100px).
const ContextIcon = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.5v3" />
    <path d="M8 5.2v0.2" />
  </svg>
);

// Back chevron for the mobile single-pane flow (shown ≤768px).
const BackIcon = (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4l-5 5 5 5" />
  </svg>
);

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
  // Opt-out / opt-back-in / missed-call — a single calm centered entry.
  const consentLabel = systemEventLabel(message);
  if (consentLabel !== null) {
    return (
      <div className={styles.systemEntry}>
        <div className={styles.systemInner}>
          <span className={styles.systemLabel}>{consentLabel}</span>
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
  return null;
}

// The live typing-indicator bubble. Customer types on the left (inbound style);
// the agent types on the right (outbound style) with a tiny "Agent · drafting"
// caption. Dots pulse (disabled under prefers-reduced-motion via the reset).
function TypingBubble({ who }: { who: 'customer' | 'agent' }) {
  const isAgent = who === 'agent';
  return (
    <div className={`${styles.bubbleRow} ${isAgent ? styles.outbound : styles.inbound}`}>
      <div className={styles.bubbleGroup}>
        <div
          className={`${styles.typingBubble} ${isAgent ? styles.bubbleOut : styles.bubbleIn}`}
          role="status"
          aria-label={isAgent ? 'Agent is drafting a reply' : 'Customer is typing'}
        >
          <span className={styles.typingDots} aria-hidden="true">
            <span className={styles.typingDot} />
            <span className={styles.typingDot} />
            <span className={styles.typingDot} />
          </span>
        </div>
        {isAgent && (
          <div className={styles.bubbleMeta}>
            <span className={styles.typingCaption}>Agent · drafting</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Format a byte count as a compact "1.2 MB" / "284 KB" size label.
function fileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

// A photo mime (heic/jpeg/png) gets a photo glyph; everything else a doc glyph.
function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

const DocGlyph = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 2h5l3 3v9H4z" />
    <path d="M9 2v3h3" />
  </svg>
);

const PhotoGlyph = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
    <circle cx="6" cy="6.5" r="1.1" />
    <path d="M3 12l3.5-3.5 2.5 2.5 2-2 2 2" />
  </svg>
);

// An inbound media part rendered as an attachment chip inside the bubble group.
function AttachmentChip({ filename, mime, bytes }: { filename: string; mime: string; bytes: number }) {
  const isImage = isImageMime(mime);
  return (
    <div className={styles.attachmentChip}>
      <span className={styles.attachmentGlyph}>{isImage ? PhotoGlyph : DocGlyph}</span>
      <span className={styles.attachmentMeta}>
        <span className={styles.attachmentName}>{filename}</span>
        <span className={styles.attachmentSize}>{fileSize(bytes)}</span>
      </span>
    </div>
  );
}

function Bubble({ message }: { message: ThreadMessage }) {
  const outbound = message.direction === 'outbound';
  const channel = message.channel_accepted;
  const media = (message.parts ?? []).filter((p) => p.type === 'media');
  return (
    <div className={`${styles.bubbleRow} ${outbound ? styles.outbound : styles.inbound}`}>
      <div className={styles.bubbleGroup}>
        <div className={`${styles.bubble} ${outbound ? styles.bubbleOut : styles.bubbleIn}`}>
          {message.body}
        </div>
        {media.map((p, i) => (
          <AttachmentChip
            key={`${p.filename}-${i}`}
            filename={p.filename}
            mime={p.mime_type}
            bytes={p.size_bytes}
          />
        ))}
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
  suggestion,
  typing,
  sendingActive,
  onApprove,
  onSend,
  onToggleAgent,
  onOpenContext,
  onOpenBrief,
  onBack,
}: ThreadPaneProps) {
  const client = useClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const conversationId = detail?.conversation.id;
  const messageCount = detail?.messages.length ?? 0;

  // Auto-scroll to newest on load/change (new conversation, new message, new
  // suggestion — and when the typing indicator appears, so it stays pinned).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversationId, messageCount, suggestion?.body, typing?.who]);

  if (loading || detail === undefined) {
    return (
      <section className={`${styles.pane} ${styles.threadPane}`} aria-label="Conversation">
        <div className={styles.threadHead}>
          <button
            type="button"
            className={styles.threadBack}
            onClick={onBack}
            aria-label="Back to inbox"
          >
            {BackIcon}
          </button>
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

  // Bubbles = all non-system messages. Held drafts (awaiting_approval) no longer
  // render as bubbles — the suggestion slot carries them; filter them out.
  const timeline = messages.filter((m) => m.status !== 'awaiting_approval');

  // The quiet "Live" presence signal: shown only when the agent is ON, the
  // thread isn't opted out, and sending is globally active.
  const showLive = conversation.agent_enabled && !detail.optedOut && sendingActive;

  const firstName = firstNameOf(conversation.display_name);

  let lastDay = '';

  return (
    <section className={`${styles.pane} ${styles.threadPane}`} aria-label="Conversation">
      <div className={styles.threadHead}>
        <button
          type="button"
          className={styles.threadBack}
          onClick={onBack}
          aria-label="Back to inbox"
        >
          {BackIcon}
        </button>
        <Avatar name={conversation.display_name} size="md" />
        <div className={styles.threadHeadMain}>
          <span className={styles.threadHeadName}>{conversation.display_name}</span>
          <span className={`${styles.threadHeadSub} tnum`}>
            {conversation.e164} · {localTimeIn(conversation.timezone, client.now())} local
          </span>
        </div>
        <span className={styles.threadHeadSpacer} />
        {showLive && (
          <span className={styles.livePresence} aria-label="Live — the agent is watching this thread">
            <span className={styles.liveDot} aria-hidden="true" />
            Live
          </span>
        )}
        {/* Opted-out is real state → keep its pill; otherwise the Agent switch is
            the only header status (no "Agent handling" / "You have this thread"). */}
        {detail.optedOut ? (
          <span className={styles.threadHeadPill}>
            <StatusPill tone="block">Opted out</StatusPill>
          </span>
        ) : (
          <AgentToggle
            key={conversation.id}
            enabled={conversation.agent_enabled}
            onToggle={onToggleAgent}
          />
        )}
        <button
          type="button"
          className={styles.briefButton}
          onClick={onOpenBrief}
          aria-label="Conversation brief"
        >
          <SparkleIcon />
        </button>
        <button
          type="button"
          className={styles.contextToggle}
          onClick={onOpenContext}
          aria-label="Open context panel"
        >
          {ContextIcon}
          Context
        </button>
      </div>

      <div className={styles.threadScroll} ref={scrollRef}>
        {timeline.map((m, i) => {
          const key = dayKey(m.created_at);
          const showDivider = key !== lastDay;
          lastDay = key;
          // The newest bubble animates in (fade + 6px rise); prior ones don't
          // re-animate on every render.
          const isNewest = i === timeline.length - 1;
          return (
            <div key={m.id} className={isNewest ? styles.animateIn : undefined}>
              {showDivider && (
                <div className={styles.dayDivider}>
                  <span className={styles.dayLabel}>{dayLabel(m.created_at, client.now())}</span>
                </div>
              )}
              {isSystemEvent(m) ? <SystemEntry message={m} /> : <Bubble message={m} />}
            </div>
          );
        })}

        {/* Live typing indicator — customer or agent, from the event feed. */}
        {typing !== null && (
          <div className={styles.animateIn}>
            <TypingBubble who={typing.who} />
          </div>
        )}
      </div>

      {/* Bottom anchor: opted out → the quiet compliance banner INSTEAD of the
          composer; otherwise the suggestion slot (above) + the composer. */}
      {detail.optedOut ? (
        <div className={styles.optOutBanner}>
          <span className={styles.optOutText}>
            <span className={styles.optOutLead}>{firstName} opted out.</span> Only they can opt
            back in — texting START restores transactional messages; marketing consent must be
            re-collected.
          </span>
        </div>
      ) : (
        <div className={styles.composerDock}>
          <SuggestionSlot
            suggestion={suggestion}
            onApprove={onApprove}
            onUse={(body) => composerRef.current?.loadDraft(body)}
          />
          <Composer ref={composerRef} firstName={firstName} onSend={onSend} />
        </div>
      )}
    </section>
  );
}
