// The ONE demo affordance. Deleting this component (and its drawer row) removes
// every demo control from the product — the "Demo data" chip is deliberately the
// leftmost, self-contained item in the topbar right cluster (and a single row in
// the mobile drawer footer) so an install-time cut is one clean deletion. The
// "Sending active" status pill stays rightmost as the persistent system-state
// anchor: status is the always-true card, demo is the removable one.
//
// DemoControls (r10) — the topbar "Demo data" pill, now a button that opens a
// small anchored popover so the demo stays fully drivable while the product
// surfaces read production-grade (the rail's demo box + the triage "Simulate
// missed call" chip were removed).
//
// The popover (hairline card, shadow-float, Escape / outside-click closes) has:
//   (a) "Reply as {contact}" input + send — plays the customer on the OPEN inbox
//       thread (reads ?c=). Disabled with a hint when no thread is selected.
//   (b) STOP / START quick chips — same enablement (START only when opted out).
//   (c) "Simulate a missed call" — always available; mints a new text-back thread.
//
// It calls the DataClient directly (simulateInbound / simulateMissedCall). The
// live event feed drives the Inbox to refetch + auto-select, so no extra wiring
// is needed — the operator watches the loop respond in place.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useClient } from './ClientContext.tsx';
import type { ThreadDetail } from '../data/types.ts';
import styles from './DemoControls.module.css';

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export default function DemoControls() {
  const client = useClient();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ThreadDetail | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The open inbox thread is URL state (?c=<conversationId>) on /inbox. Read it
  // live so the popover always plays the customer on the CURRENT conversation.
  const conversationId = useMemo(() => {
    if (!location.pathname.startsWith('/inbox')) return null;
    return new URLSearchParams(location.search).get('c');
  }, [location.pathname, location.search]);

  // Fetch the selected thread's contact (for "Reply as {name}") + opted-out
  // state (gates START). Refetched whenever the popover opens on a new thread.
  useEffect(() => {
    if (!open || conversationId === null) {
      setDetail(undefined);
      return;
    }
    let live = true;
    void client.thread(conversationId).then((d) => {
      if (live) setDetail(d);
    });
    return () => {
      live = false;
    };
  }, [client, conversationId, open]);

  // Escape closes; outside-click (mousedown outside the root) closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    // Focus the reply input if a thread is available.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      cancelAnimationFrame(id);
    };
  }, [open]);

  const hasThread = conversationId !== null;
  const optedOut = detail?.optedOut ?? false;
  const contactName = detail?.conversation.display_name;

  const sendReply = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (body === '' || conversationId === null || busy) return;
      setBusy(true);
      try {
        await client.simulateInbound(conversationId, body);
        setReply('');
      } finally {
        setBusy(false);
      }
    },
    [client, conversationId, busy],
  );

  const missedCall = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await client.simulateMissedCall();
      // The call.missed feed event auto-selects the new thread in the Inbox.
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }, [client, busy]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.triggerDot} aria-hidden="true" />
        Demo data
      </button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label="Demo controls">
          <span className={styles.popTitle}>Demo controls</span>

          {/* (a) Reply as the selected contact — plays the customer on the thread. */}
          <div className={styles.section}>
            <span className={styles.sectionLabel}>
              {hasThread && contactName
                ? `Reply as ${firstNameOf(contactName)}`
                : 'Play the customer'}
            </span>
            {hasThread ? (
              <>
                <div className={styles.replyRow}>
                  <input
                    ref={inputRef}
                    className={styles.replyInput}
                    type="text"
                    value={reply}
                    placeholder="Type a reply as the customer…"
                    aria-label="Simulated customer message"
                    disabled={busy}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void sendReply(reply);
                    }}
                  />
                  <button
                    type="button"
                    className={styles.replySend}
                    disabled={busy || reply.trim() === ''}
                    onClick={() => void sendReply(reply)}
                  >
                    Send
                  </button>
                </div>
                <div className={styles.chips}>
                  <button
                    type="button"
                    className={styles.chip}
                    disabled={busy}
                    onClick={() => void sendReply('STOP')}
                  >
                    STOP
                  </button>
                  {optedOut && (
                    <button
                      type="button"
                      className={styles.chip}
                      disabled={busy}
                      onClick={() => void sendReply('START')}
                    >
                      START
                    </button>
                  )}
                </div>
                <span className={styles.hint}>
                  {optedOut ? 'Only the customer can opt back in.' : 'STOP records an opt-out.'}
                </span>
              </>
            ) : (
              <span className={styles.hint}>Open a conversation to play the customer.</span>
            )}
          </div>

          {/* (c) Missed call — always available. */}
          <div className={styles.section}>
            <button
              type="button"
              className={styles.missedCall}
              disabled={busy}
              onClick={() => void missedCall()}
            >
              Simulate a missed call
            </button>
          </div>

          {/* The honesty note about demo vs platform lives here — its correct home
              now that Home's footer line is gone (r12). */}
          <p className={styles.note}>
            Demo mode — deterministic agent. The platform connection runs the live
            planner.
          </p>
        </div>
      )}
    </div>
  );
}
