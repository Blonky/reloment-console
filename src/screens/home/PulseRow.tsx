// Home analytics band (DESIGN.md §5) — four stat cards + a wide Signals card.
//
// The stats read from client.home() and are refetched after any command that
// changes state, so they visibly react to a command (the demo moment). Signals
// are *derived and factual*, computed from the same governed reads the command
// surface uses — never invented. Each carries a quiet action that dispatches the
// corresponding command into the surface.

import { Link } from 'react-router-dom';
import { Card, Skeleton } from '../../components/index.ts';
import type { BookRow, Contact, HomePulse } from '../../data/types.ts';
import styles from './HomeScreen.module.css';

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export interface Signal {
  tone: 'hold' | 'info' | 'ok';
  text: string;
  action?: { label: string; command: string };
}

// Derive signals from the live book + lapsed read. Factual counts only.
export function deriveSignals(contacts: Contact[], lapsed: BookRow[]): Signal[] {
  const out: Signal[] = [];

  // 1) Aged win-back candidates — lapsed quotes past the win-back window,
  //    eligible (not opted out, marketing consent on file).
  const eligibleWinback = lapsed.filter((r) => {
    const c = contacts.find((x) => x.display_name === r.display_name);
    return c && !c.optedOut && c.consents.includes('marketing');
  });
  if (eligibleWinback.length > 0) {
    out.push({
      tone: 'hold',
      text: `${eligibleWinback.length} win-back ${
        eligibleWinback.length === 1 ? 'candidate is' : 'candidates are'
      } past the 60-day window and eligible to re-engage.`,
      action: { label: 'Enroll win-back', command: 'Enroll win-back' },
    });
  }

  // 2) Threads routed to a licensed human — advice-adjacent, awaiting a reply.
  //    In the Hartley book this is Marcus (coverage-limit question). We surface
  //    it factually without hard-coding the name by checking the queue-shaped
  //    "routed" contacts — the brief command opens the story.
  const routed = contacts.filter(
    (c) => c.lob !== null && c.policy_status === 'new_lead' && c.consents.length === 1,
  );
  if (routed.length > 0) {
    out.push({
      tone: 'info',
      text: `${routed.length} ${
        routed.length === 1 ? 'thread is' : 'threads are'
      } routed to a licensed human, awaiting a reply.`,
      action: { label: `Brief me on ${routed[0].display_name.split(' ')[0]}`, command: `Brief me on ${routed[0].display_name.split(' ')[0]}` },
    });
  }

  // 3) Opt-outs on file — the governance floor made visible.
  const optedOut = contacts.filter((c) => c.optedOut);
  if (optedOut.length > 0) {
    out.push({
      tone: 'ok',
      text: `${optedOut.length} ${
        optedOut.length === 1 ? 'contact has' : 'contacts have'
      } opted out — permanently excluded from every send.`,
    });
  }

  return out.slice(0, 3);
}

// A stat card — label (11px uppercase ink-2) / Fraunces value / 12px sub. `to`
// makes the whole card a hover-lift link; `valueOk` tints the value (Recovered
// only, the single colored number in the band).
function Stat({
  label,
  value,
  sub,
  to,
  valueOk,
}: {
  label: string;
  value: string;
  sub: string;
  to?: string;
  valueOk?: boolean;
}) {
  const inner = (
    <>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statValue}${valueOk ? ` ${styles.statValueOk}` : ''}`}>
        {value}
      </span>
      <span className={styles.statSub}>{sub}</span>
    </>
  );
  if (to !== undefined) {
    return (
      <Link to={to} className={`${styles.statCard} ${styles.statCardLink}`}>
        {inner}
      </Link>
    );
  }
  return <div className={styles.statCard}>{inner}</div>;
}

export function AnalyticsBand({
  pulse,
  signals,
  signalsLoading,
  onRun,
}: {
  pulse: HomePulse | undefined;
  signals: Signal[];
  signalsLoading: boolean;
  onRun: (command: string) => void;
}) {
  return (
    <div className={styles.band}>
      <div className={styles.statRow}>
        {!pulse ? (
          [0, 1, 2, 3].map((i) => (
            <div className={styles.statCard} key={i}>
              <Skeleton width={90} height={11} />
              <div style={{ height: 8 }} />
              <Skeleton width={64} height={30} />
            </div>
          ))
        ) : (
          <>
            <Stat
              label="Needs your eyes"
              value={String(pulse.needsYourEyes)}
              sub="drafts & routed threads"
              to="/inbox"
            />
            <Stat
              label="Conversations running"
              value={String(pulse.conversationsRunning)}
              sub="active threads"
            />
            <Stat
              label="Renewals next 30d"
              value={String(pulse.renewalsNext30d)}
              sub="up for renewal"
            />
            <Stat
              label="Recovered"
              value={dollars(pulse.wonBackCents)}
              sub="causally attributed"
              valueOk
            />
          </>
        )}
      </div>

      <Card title="Signals" className={styles.signalsCard}>
        {signalsLoading ? (
          <div className={styles.signals}>
            <Skeleton height={14} />
            <Skeleton height={14} width="80%" />
            <Skeleton height={14} width="60%" />
          </div>
        ) : signals.length === 0 ? (
          <p className={styles.muted}>Nothing needs your attention right now.</p>
        ) : (
          <div className={styles.signals}>
            {signals.map((s, i) => (
              <div className={styles.signalRow} key={i}>
                <span
                  className={`${styles.signalDot} ${
                    s.tone === 'info'
                      ? styles.signalDotInfo
                      : s.tone === 'ok'
                        ? styles.signalDotOk
                        : ''
                  }`}
                />
                <span className={styles.signalBody}>
                  <span className={styles.signalText}>{s.text}</span>
                  {s.action && (
                    <button
                      type="button"
                      className={styles.signalAction}
                      onClick={() => onRun(s.action!.command)}
                    >
                      {s.action.label} →
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
