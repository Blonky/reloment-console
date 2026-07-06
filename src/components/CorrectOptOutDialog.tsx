// CorrectOptOutDialog — the shared centered modal for correcting an opt-out
// record made in error (r16). Used from BOTH the Settings opt-out ledger and the
// gated composer's "Correct the record…" link, so it lives in components/ and is
// wired by each caller with the same DataClient.correctOptOut.
//
// The gate is the law: this dialog does NOT toggle a per-contact off-switch. It
// corrects a RECORD made in error, with friction (a required reason + a required
// confirmation checkbox) and an audit trail. If the customer texted STOP
// themselves, the copy insists the record must stand.
//
// A portal-rendered, aria-modal centered dialog: scrim, Escape/scrim/✕ close,
// focus moves in on open, page scroll locked while up. Motion is a 160ms fade +
// small rise, suppressed under prefers-reduced-motion by the global reset.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button.tsx';
import styles from './CorrectOptOutDialog.module.css';

export interface CorrectOptOutDialogProps {
  open: boolean;
  // The contact whose opt-out record is being corrected.
  contactId: string;
  name: string;
  onClose: () => void;
  // Runs client.correctOptOut(contactId, reason). Resolves on success so the
  // caller can flash its "Record corrected and logged." wisp and refetch.
  onConfirm: (contactId: string, reason: string) => Promise<void>;
}

const CloseIcon = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export default function CorrectOptOutDialog({
  open,
  contactId,
  name,
  onClose,
  onConfirm,
}: CorrectOptOutDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reset the form each time the dialog opens for a (possibly different) contact.
  useEffect(() => {
    if (open) {
      setReason('');
      setConfirmed(false);
      setSubmitting(false);
    }
  }, [open, contactId]);

  // Escape closes; move focus to the reason input on open; lock body scroll.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    // Focus the reason field so the operator can type immediately.
    requestAnimationFrame(() => reasonRef.current?.focus());
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const canConfirm = reason.trim() !== '' && confirmed && !submitting;

  async function handleConfirm() {
    if (!canConfirm) return;
    setSubmitting(true);
    try {
      await onConfirm(contactId, reason.trim());
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className={styles.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Correct an opt-out record"
        tabIndex={-1}
      >
        <header className={styles.head}>
          <h2 className={styles.title}>Correct an opt-out record</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            {CloseIcon}
          </button>
        </header>

        <div className={styles.body}>
          <p className={styles.copy}>
            Only for records made in error, a wrong number, an internal test, or a mistaken entry. If{' '}
            <span className={styles.name}>{name}</span> texted STOP themselves, this record must stand.
          </p>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Reason</span>
            <input
              ref={reasonRef}
              className={styles.input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Internal test from our own device"
              aria-label="Reason for correcting the record"
              disabled={submitting}
            />
          </label>

          <label className={styles.confirm}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={submitting}
            />
            <span>I confirm {name} did not ask us to stop.</span>
          </label>
        </div>

        <footer className={styles.footer}>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleConfirm()}
            disabled={!canConfirm}
          >
            Correct record
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
