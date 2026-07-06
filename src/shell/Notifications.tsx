// Notifications (round 12) — the topbar inbox bell.
//
// A live-derived notification center replacing the old "status soup". A bell
// button with a small unread-count badge (approvals waiting + agent asks — a
// live derived count, NOT a read-state, so it clears nothing) opens a popover in
// the same idiom as DemoControls / ⌘K (hairline card, shadow-float, Escape /
// outside-click closes). Two quiet groups:
//   Needs you — approvals waiting (→ /inbox) + the top agent asks (contact asks
//               route to their thread via resolveNavigate; tenant asks → /inbox)
//   Recent    — the last 2–3 overnight recap lines
// All of it reads the shared LiveData context, so the badge + rows refresh on
// the same single feed subscription that drives Home.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClient } from './ClientContext.tsx';
import { useLiveData } from './LiveData.tsx';
import type { AgentAsk } from '../data/types.ts';
import styles from './Notifications.module.css';

const BellGlyph = (
  <svg
    width="18"
    height="18"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3-1.2 4.2-1.7 4.8-.2.2 0 .7.3.7h11.8c.3 0 .5-.5.3-.7-.5-.6-1.7-1.8-1.7-4.8A4.5 4.5 0 0 0 10 3z" />
    <path d="M8.5 16a1.5 1.5 0 0 0 3 0" />
  </svg>
);

export default function Notifications() {
  const client = useClient();
  const navigate = useNavigate();
  const { briefing, asks, unread } = useLiveData();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const go = useCallback(
    (href: string) => {
      navigate(href);
      setOpen(false);
    },
    [navigate],
  );

  // Contact asks route to their thread; tenant asks to the inbox queue. The
  // thread resolution reuses the deterministic navigation seam (no server hop in
  // demo). Falls back to /inbox on a miss.
  const goToAsk = useCallback(
    async (ask: AgentAsk) => {
      if (ask.scope === 'contact' && ask.contactName) {
        const target = await client.resolveNavigate(ask.contactName);
        navigate(target?.href ?? '/inbox');
      } else {
        navigate('/inbox');
      }
      setOpen(false);
    },
    [client, navigate],
  );

  const approvals =
    briefing?.needsYou.filter((n) => n.label === 'Approvals waiting') ?? [];
  const topAsks = asks.slice(0, 3);
  const recent = (briefing?.overnight ?? []).slice(0, 3);
  const hasNeedsYou = approvals.length > 0 || topAsks.length > 0;

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.bell}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          unread > 0 ? `Notifications, ${unread} needing attention` : 'Notifications'
        }
        onClick={() => setOpen((v) => !v)}
      >
        {BellGlyph}
        {unread > 0 && (
          <span className={`${styles.badge} tnum`} aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label="Notifications">
          {hasNeedsYou && (
            <div className={styles.group}>
              <span className={styles.groupLabel}>Needs you</span>
              {approvals.map((n) => (
                <button
                  key={n.label}
                  type="button"
                  className={styles.row}
                  onClick={() => go(n.href)}
                >
                  <span className={`${styles.rowCount} tnum`}>{n.count}</span>
                  <span className={styles.rowText}>{n.label}</span>
                </button>
              ))}
              {topAsks.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={styles.row}
                  onClick={() => void goToAsk(a)}
                  title={a.why}
                >
                  <span className={styles.rowDot} aria-hidden="true" />
                  <span className={styles.rowText}>{a.ask}</span>
                </button>
              ))}
            </div>
          )}

          {recent.length > 0 && (
            <div className={styles.group}>
              <span className={styles.groupLabel}>Recent</span>
              {recent.map((line, i) => (
                <div key={i} className={styles.recentLine}>
                  {line}
                </div>
              ))}
            </div>
          )}

          {!hasNeedsYou && recent.length === 0 && (
            <p className={styles.empty}>You're all caught up.</p>
          )}
        </div>
      )}
    </div>
  );
}
