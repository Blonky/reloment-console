// ConversationBrief — the summary/memory overlay for a thread, rendered inside
// the shared Inspector (portal, Escape, scrim, mobile sheet). Three sections:
//   1. Brief — the deterministic summary paragraph.
//   2. Key moments — the timeline moments[] with tnum stamp times.
//   3. Ask about this conversation — an input + the three canned askSuggestions
//      as ghost chips; submitting appends a Q/A pair, each answer captioned
//      "Read-only · answered from this conversation" (the gate-honesty pattern).
// All content comes from client.conversationBrief / client.askThread — no
// hardcoded copy. A skeleton shimmer covers the initial brief load.

import { useEffect, useRef, useState } from 'react';
import { Skeleton } from '../../components/index.ts';
import type { ConversationBrief as ConversationBriefData } from '../../data/types.ts';
import { useClient } from '../../shell/ClientContext.tsx';
import { clockTime } from './inboxUtils.ts';
import styles from './InboxScreen.module.css';

export interface ConversationBriefProps {
  conversationId: string;
}

interface QAPair {
  id: number;
  question: string;
  answer: string | null; // null while the answer is in flight
}

function BriefSkeleton() {
  return (
    <div className={styles.briefSkeleton} aria-hidden="true">
      <Skeleton width="30%" height={11} />
      <Skeleton width="100%" height={13} />
      <Skeleton width="94%" height={13} />
      <Skeleton width="70%" height={13} />
      <Skeleton width="30%" height={11} radius="4px" />
      <Skeleton width="100%" height={40} radius="var(--radius)" />
      <Skeleton width="100%" height={40} radius="var(--radius)" />
    </div>
  );
}

export default function ConversationBrief({ conversationId }: ConversationBriefProps) {
  const client = useClient();
  const [brief, setBrief] = useState<ConversationBriefData | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [pairs, setPairs] = useState<QAPair[]>([]);
  const nextId = useRef(0);

  // Load the brief for this conversation. Reset when the conversation changes.
  useEffect(() => {
    let cancelled = false;
    setBrief(null);
    setPairs([]);
    setQuestion('');
    client
      .conversationBrief(conversationId)
      .then((b) => {
        if (!cancelled) setBrief(b);
      })
      .catch(() => {
        if (!cancelled) setBrief(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, conversationId]);

  async function ask(text: string) {
    const q = text.trim();
    if (q === '' || asking) return;
    const id = nextId.current++;
    setPairs((prev) => [...prev, { id, question: q, answer: null }]);
    setQuestion('');
    setAsking(true);
    try {
      const { answer } = await client.askThread(conversationId, q);
      setPairs((prev) => prev.map((p) => (p.id === id ? { ...p, answer } : p)));
    } finally {
      setAsking(false);
    }
  }

  if (brief === null) {
    return <BriefSkeleton />;
  }

  return (
    <div className={styles.brief}>
      {/* Brief — the summary paragraph. */}
      <section className={styles.briefSection}>
        <span className={styles.briefLabel}>Brief</span>
        <p className={styles.briefSummary}>{brief.summary}</p>
      </section>

      {/* Key moments. */}
      {brief.moments.length > 0 && (
        <section className={styles.briefSection}>
          <span className={styles.briefLabel}>Key moments</span>
          <ul className={styles.momentList}>
            {brief.moments.map((m, i) => (
              <li key={`${m.at}-${i}`} className={styles.momentItem}>
                <span className={`${styles.momentTime} tnum`}>{clockTime(m.at)}</span>
                <span className={styles.momentLabel}>{m.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Ask about this conversation. */}
      <section className={styles.briefSection}>
        <span className={styles.briefLabel}>Ask about this conversation</span>

        <div className={styles.askInputRow}>
          <input
            className={styles.askInput}
            type="text"
            value={question}
            placeholder="Ask a question…"
            aria-label="Ask about this conversation"
            disabled={asking}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void ask(question);
            }}
          />
        </div>

        <div className={styles.askChips}>
          {brief.askSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.askChip}
              disabled={asking}
              onClick={() => void ask(s)}
            >
              {s}
            </button>
          ))}
        </div>

        {pairs.length > 0 && (
          <div className={styles.qaList} aria-live="polite">
            {pairs.map((p) => (
              <div key={p.id} className={styles.qaPair}>
                <div className={styles.qaQuestion}>{p.question}</div>
                {p.answer === null ? (
                  <div className={styles.qaAnswer}>
                    <Skeleton width="80%" height={13} />
                  </div>
                ) : (
                  <>
                    <div className={styles.qaAnswer}>{p.answer}</div>
                    <div className={styles.qaCaption}>
                      Read-only · answered from this conversation
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
