// SuggestionSlot — the agent's next-best message, one compact quiet card sitting
// directly ABOVE the composer (messages-first v4). Refetched on conversation
// change and every 'suggestion.updated'. When the suggestion is null the slot
// renders nothing — silence is honored and the composer stands alone.
//
//   held   → "Approve & send" (approve(draftId)) + ghost "Edit" (loads composer)
//   assist → single ghost "Use" (loads composer; the human decides to send)
//
// The body crossfades when it changes (motion-safe). Rationale renders as a tiny
// dot-separated caption. No consent-chip strip — that lives in the rail.

import { useEffect, useRef, useState } from 'react';
import { Button, StatusPill } from '../../components/index.ts';
import type { ApproveResult, Suggestion } from '../../data/types.ts';
import { PencilIcon } from './icons.tsx';
import styles from './InboxScreen.module.css';

export interface SuggestionSlotProps {
  suggestion: Suggestion | null;
  // approve(draftId) — held suggestions only.
  onApprove: (draftId: string) => Promise<ApproveResult>;
  // Load the body into the composer and focus it (Edit / Use).
  onUse: (body: string) => void;
}

export default function SuggestionSlot({ suggestion, onApprove, onUse }: SuggestionSlotProps) {
  const [expanded, setExpanded] = useState(false);
  const [approving, setApproving] = useState(false);
  // Crossfade key: bump when the body changes so the card re-triggers its fade.
  const [fadeKey, setFadeKey] = useState(0);
  const prevBody = useRef<string | null>(null);

  const body = suggestion?.body ?? null;
  useEffect(() => {
    if (body !== null && body !== prevBody.current) {
      setFadeKey((k) => k + 1);
      setExpanded(false);
    }
    prevBody.current = body;
  }, [body]);

  if (suggestion === null) return null;

  const { held, playbookLabel, draftId, rationale } = suggestion;

  async function handleApprove() {
    if (approving || draftId === undefined) return;
    setApproving(true);
    try {
      await onApprove(draftId);
    } finally {
      setApproving(false);
    }
  }

  // Two-line clamp with expand-on-click when the body is long.
  const isLong = suggestion.body.length > 120;

  return (
    <div className={styles.suggestion} key={fadeKey}>
      <div className={styles.suggestionTop}>
        <span className={styles.suggestionLabel}>
          Suggested · <span className={styles.suggestionPlaybook}>{playbookLabel}</span>
        </span>
        {held && <StatusPill tone="hold">Held for your review</StatusPill>}
      </div>

      <button
        type="button"
        className={`${styles.suggestionBody} ${expanded || !isLong ? '' : styles.suggestionClamp}`}
        onClick={() => isLong && setExpanded((v) => !v)}
        aria-expanded={isLong ? expanded : undefined}
        title={isLong ? (expanded ? 'Collapse' : 'Expand') : undefined}
      >
        {suggestion.body}
      </button>

      {rationale.length > 0 && (
        <p className={styles.suggestionRationale}>{rationale.join(' · ')}</p>
      )}

      <div className={styles.suggestionActions}>
        {held ? (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleApprove()}
              disabled={approving}
            >
              Approve &amp; send
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onUse(suggestion.body)} disabled={approving}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <PencilIcon size={14} /> Edit
              </span>
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => onUse(suggestion.body)}>
            Use
          </Button>
        )}
      </div>
    </div>
  );
}
