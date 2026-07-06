// DraftCard — the money component. Sits at the thread's foot when a draft awaits
// approval. Editable well styled like an outbound bubble in review, the playbook
// it came from, pre-flight consent + quiet-hours chips, and honest inline
// results (sent → ok with the real channel; held/blocked → calm GateReason).
// The result region is aria-live="polite" — never a toast (DESIGN.md §5).

import { useEffect, useRef, useState } from 'react';
import {
  Button,
  ChannelBadge,
  ConsentChips,
  GateReason,
  StatusPill,
} from '../../components/index.ts';
import type { BadgeChannel } from '../../components/index.ts';
import type { ApproveResult } from '../../data/types.ts';
import { CheckIcon, HandIcon, PencilIcon } from './icons.tsx';
import styles from './InboxScreen.module.css';

export interface DraftCardProps {
  draftId: string;
  body: string;
  playbookLabel: string;
  consents: string[];
  timezone: string;
  optedOut: boolean;
  onApprove: (draftId: string) => Promise<ApproveResult>;
  onEdit: (draftId: string, body: string) => Promise<void>;
  onTakeover: () => Promise<void>;
}

type Phase = 'idle' | 'busy';

export default function DraftCard({
  draftId,
  body,
  playbookLabel,
  consents,
  timezone,
  optedOut,
  onApprove,
  onEdit,
  onTakeover,
}: DraftCardProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(body);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<ApproveResult | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // A new draft (id change) resets the whole card — clean slate per conversation.
  useEffect(() => {
    setEditing(false);
    setValue(body);
    setPhase('idle');
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  const busy = phase === 'busy';

  async function handleApprove() {
    if (busy) return;
    setPhase('busy');
    setResult(null);
    try {
      const res = await onApprove(draftId);
      setResult(res);
    } finally {
      setPhase('idle');
    }
  }

  function beginEdit() {
    setEditing(true);
    setResult(null);
    // Focus + cursor to end on the next paint.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  async function saveEdit() {
    if (busy) return;
    setPhase('busy');
    try {
      await onEdit(draftId, value);
      setEditing(false);
    } finally {
      setPhase('idle');
    }
  }

  async function handleTakeover() {
    if (busy) return;
    setPhase('busy');
    try {
      await onTakeover();
    } finally {
      setPhase('idle');
    }
  }

  const channelLabel: Record<BadgeChannel, string> = {
    imessage: 'iMessage',
    rcs: 'RCS',
    sms: 'SMS',
  };

  return (
    <div className={styles.draftFoot}>
      <div className={styles.draftHead}>
        <div className={styles.draftHeadLeft}>
          <span className={styles.draftKicker}>Draft · awaiting approval</span>
          <span className={styles.draftPlaybook}>from {playbookLabel}</span>
        </div>
        <StatusPill tone="hold">Held for your review</StatusPill>
      </div>

      <textarea
        ref={textareaRef}
        className={`${styles.draftWell} ${editing ? styles.editing : ''}`}
        value={value}
        readOnly={!editing}
        aria-label="Draft message body"
        onChange={(e) => setValue(e.target.value)}
        rows={2}
      />

      <div className={styles.draftChips}>
        <ConsentChips consents={consents} timezone={timezone} optedOut={optedOut} />
      </div>

      <div className={styles.draftActions}>
        <Button
          variant="primary"
          onClick={() => void handleApprove()}
          disabled={busy || editing}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CheckIcon /> Approve &amp; send
          </span>
        </Button>

        {editing ? (
          <Button variant="secondary" onClick={() => void saveEdit()} disabled={busy}>
            Save draft
          </Button>
        ) : (
          <Button variant="secondary" onClick={beginEdit} disabled={busy}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <PencilIcon /> Edit
            </span>
          </Button>
        )}

        <span className={styles.draftActionsSpacer} />

        <Button variant="ghost" onClick={() => void handleTakeover()} disabled={busy}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <HandIcon /> Take over
          </span>
        </Button>
      </div>

      <div className={styles.resultRegion} aria-live="polite">
        {result !== null &&
          (result.sent && result.deliveredAs !== undefined ? (
            <div className={`${styles.resultRow} ${styles.resultOk}`}>
              <span className={styles.resultDot} />
              <span className={styles.resultOkText}>
                Sent as {channelLabel[result.deliveredAs]}
              </span>
              <ChannelBadge channel={result.deliveredAs} />
            </div>
          ) : (
            <div className={styles.resultRow}>
              <GateReason reason={String(result.decision.auditReason)} variant="row" />
            </div>
          ))}
      </div>
    </div>
  );
}
