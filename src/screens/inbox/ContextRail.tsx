// Context rail — the right pane, restructured into the INTELLIGENCE panel (r9).
// In order:
//   (a) POLICY   — one compact fact line (LOB · status · renewal).
//   (b) CONSENT  — the consent chips + quiet-hours window.
//   (c) BRIEF    — the conversation summary folded IN (2 sentences from
//                  conversationBrief(), auto-refreshing on suggestion/message
//                  events) with a small "Ask" affordance opening the existing
//                  ConversationBrief Inspector for Q&A + key moments.
//   (d) MEMORY   — atoms as quiet bullets, capped at 3 with a "+N more" toggle.
//   (e) ASKS     — the agent's contact-scoped asks for THIS contact (ask + why),
//                  a quiet accent left border.
//   (f) DEMO     — a visually distinct inset block ("{First}'s phone · demo") to
//                  play the customer and watch the loop respond. Document-request
//                  chips have moved OUT to the composer ＋ menu.
//
// The whole rail must fit unscrolled at 1512×860 — Memory collapses behind the
// "+N more" toggle so the panel stays tight.

import { useEffect, useMemo, useState } from 'react';
import { ConsentChips, Skeleton } from '../../components/index.ts';
import type { AgentAsk, ConversationBrief, ThreadDetail } from '../../data/types.ts';
import { useClient } from '../../shell/ClientContext.tsx';
import { firstNameOf, shortDate } from './inboxUtils.ts';
import { SendIcon, SparkleIcon } from './icons.tsx';
import styles from './InboxScreen.module.css';

export interface ContextRailProps {
  detail: ThreadDetail | undefined;
  loading: boolean;
  onSimulate: (text: string) => Promise<void>;
  // Opens the shared ConversationBrief Inspector (Q&A + key moments).
  onOpenBrief: () => void;
  // A nonce that bumps after any mutation so the rail re-derives the brief +
  // asks (they evolve with the thread — new message, new suggestion, etc.).
  refreshKey: number;
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
  onOpenBrief,
  refreshKey,
  variant = 'docked',
  onClose,
}: ContextRailProps) {
  const client = useClient();
  const [draftReply, setDraftReply] = useState('');
  const [sending, setSending] = useState(false);
  const [memoryExpanded, setMemoryExpanded] = useState(false);
  const [brief, setBrief] = useState<ConversationBrief | null>(null);
  const [asks, setAsks] = useState<AgentAsk[]>([]);
  const conversationId = detail?.conversation.id;
  const contactId = detail?.conversation.contact_id;
  const isSheet = variant === 'sheet';

  // Clear the composer + collapse memory when the selected conversation changes.
  useEffect(() => {
    setDraftReply('');
    setMemoryExpanded(false);
  }, [conversationId]);

  // Fold the conversation summary INTO the rail — refetched when the thread
  // changes AND on every mutation (refreshKey bumps on suggestion.updated /
  // message events) so the 2-sentence recap stays current.
  useEffect(() => {
    if (conversationId === undefined) {
      setBrief(null);
      return;
    }
    let live = true;
    void client.conversationBrief(conversationId).then((b) => {
      if (live) setBrief(b);
    });
    return () => {
      live = false;
    };
  }, [client, conversationId, refreshKey]);

  // The agent's asks for THIS contact (contact-scoped). Recomputed on the same
  // cadence — cheap deterministic derive, never invented.
  useEffect(() => {
    if (contactId === undefined) {
      setAsks([]);
      return;
    }
    let live = true;
    void client.agentAsks().then((all) => {
      if (live) setAsks(all.filter((a) => a.scope === 'contact' && a.contactId === contactId));
    });
    return () => {
      live = false;
    };
  }, [client, contactId, refreshKey]);

  // Sheet mode: Escape closes.
  useEffect(() => {
    if (!isSheet || onClose === undefined) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose!();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSheet, onClose]);

  // Take the first two sentences of the summary for the folded rail brief.
  const shortSummary = useMemo(() => {
    if (brief === null) return null;
    const sentences = brief.summary.match(/[^.!?]+[.!?]+/g);
    if (sentences === null) return brief.summary;
    return sentences.slice(0, 2).join(' ').trim();
  }, [brief]);

  const paneClass = isSheet ? styles.sheetInner : `${styles.pane} ${styles.railPane}`;
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
  const facts = [
    conversation.lob,
    policyLabel(conversation.policy_status),
    renewal !== null ? `Renews ${renewal}` : null,
  ].filter((v): v is string => v !== null);
  // Memory capped at 3 unless expanded; the rest hide behind a "+N more" toggle
  // so the rail fits unscrolled at 1512×860.
  const memoryShown = memoryExpanded ? memory : memory.slice(0, 3);
  const memoryHidden = memory.length - memoryShown.length;

  return (
    <aside className={paneClass} aria-label="Context">
      {head}

      <div className={styles.railScroll}>
        {/* (a) POLICY — one quiet fact line. */}
        <div className={styles.railSectionTight}>
          <span className={styles.railSectionLabel}>Policy</span>
          <div className={styles.factLine}>
            {facts.map((f, i) => (
              <span key={i}>
                {i > 0 && <span className={styles.factSep}>·</span>}
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* (b) CONSENT — a tight single row under a smaller label. */}
        <div className={styles.railSectionTight}>
          <span className={styles.railSectionLabel}>Consent</span>
          <ConsentChips
            consents={consents.map((c) => c.scope)}
            timezone={conversation.timezone}
            optedOut={detail.optedOut}
          />
        </div>

        {/* (c) BRIEF — the conversation summary folded in, with an "Ask"
            affordance opening the ConversationBrief Inspector for depth. */}
        <div className={styles.railSectionTight}>
          <div className={styles.railBriefHead}>
            <span className={styles.railSectionLabel}>Brief</span>
            <button
              type="button"
              className={styles.railAskBtn}
              onClick={onOpenBrief}
              aria-label="Ask about this conversation"
            >
              <SparkleIcon size={13} />
              Ask
            </button>
          </div>
          {shortSummary === null ? (
            <Skeleton width="100%" height={13} />
          ) : (
            <p className={styles.railBriefSummary}>{shortSummary}</p>
          )}
        </div>

        {/* (d) MEMORY — capped at 3, quiet bullets, "+N more" toggle. */}
        <div className={styles.railSectionTight}>
          <span className={styles.railSectionLabel}>Memory</span>
          {memory.length === 0 ? (
            <span className={styles.simHint}>No memory atoms recorded yet.</span>
          ) : (
            <>
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
              {memoryHidden > 0 && (
                <button
                  type="button"
                  className={styles.railMoreBtn}
                  onClick={() => setMemoryExpanded(true)}
                >
                  +{memoryHidden} more
                </button>
              )}
              {memoryExpanded && memory.length > 3 && (
                <button
                  type="button"
                  className={styles.railMoreBtn}
                  onClick={() => setMemoryExpanded(false)}
                >
                  Show less
                </button>
              )}
            </>
          )}
        </div>

        {/* (e) AGENT ASKS — contact-scoped asks for this contact. Accent border. */}
        {asks.length > 0 && (
          <div className={styles.railSectionTight}>
            <span className={styles.railSectionLabel}>Agent asks</span>
            <ul className={styles.askList}>
              {asks.map((a) => (
                <li key={a.id} className={styles.askItem}>
                  <span className={styles.askItemAsk}>{a.ask}</span>
                  <span className={styles.askItemWhy}>{a.why}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* (f) DEMO — a distinct inset block: play the customer, watch the loop.
            The doc-request chips have moved to the composer ＋ menu. */}
        <div className={styles.railDemo}>
          <span className={styles.railDemoTitle}>{first}&rsquo;s phone · demo</span>
          <span className={styles.railDemoCaption}>
            Play the customer to watch the loop respond.
          </span>
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
            <button
              type="button"
              className={styles.railDemoSend}
              aria-label="Send simulated reply"
              disabled={sending || draftReply.trim() === ''}
              onClick={() => void send(draftReply)}
            >
              <SendIcon size={15} />
            </button>
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
