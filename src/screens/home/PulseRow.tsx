// Home pulse surfaces (DESIGN.md §5).
//
// Idle: the BriefingBand — the "Today" daily briefing (Needs you / Overnight /
// Worth a call) from homeBriefing(), plus a slim strip of the top agent asks.
// Active: the PulseStrip — one quiet line of inline pill stats above the
// transcript, live-updating after enroll/kill commands. No dashboard clutter.
//
// Every field is *derived and factual*, composed from the same governed reads
// the command surface uses (see DemoClient.homeBriefing / agentAsks) — never
// invented, no hardcoded stats.

import { Link } from 'react-router-dom';
import { Skeleton } from '../../components/index.ts';
import type { AgentAsk, HomeBriefing, HomePulse } from '../../data/types.ts';
import styles from './HomeScreen.module.css';

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

// Replaces the analytics stat band + signals rows with ONE cohesive briefing
// from homeBriefing(): a 3-column card (Needs you / Overnight / Worth a call),
// then a slim strip of the top agent asks. The pulse numbers live compactly
// INSIDE this band — no separate stat row. Every field is derived, never
// hardcoded (see DemoClient.homeBriefing / agentAsks).
export function BriefingBand({
  briefing,
  pulse,
  loading,
  onRun,
}: {
  briefing: HomeBriefing | undefined;
  pulse: HomePulse | undefined;
  loading: boolean;
  onRun: (command: string) => void;
}) {
  if (loading || briefing === undefined) {
    return (
      <div className={styles.briefingBand}>
        <div className={styles.briefingGrid}>
          {[0, 1, 2].map((i) => (
            <div className={styles.briefingCol} key={i}>
              <Skeleton width={90} height={11} />
              <div style={{ height: 8 }} />
              <Skeleton width="100%" height={13} />
              <Skeleton width="80%" height={13} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const recovered = pulse ? dollars(pulse.wonBackCents) : null;
  const running = pulse?.conversationsRunning ?? null;
  // Top 2 asks (tenant + contact mixed) for the slim strip beneath the grid.
  const topAsks: AgentAsk[] = briefing.asks.slice(0, 2);

  return (
    <div className={styles.briefingBand}>
      <div className={styles.briefingGrid}>
        {/* Needs you — approvals + asks, each a link into the work. */}
        <section className={styles.briefingCol}>
          <span className={styles.briefingLabel}>Needs you</span>
          {briefing.needsYou.length === 0 ? (
            <p className={styles.briefingEmpty}>Nothing waiting on you.</p>
          ) : (
            <ul className={styles.briefingList}>
              {briefing.needsYou.map((n) => (
                <li key={n.label}>
                  <Link to={n.href} className={styles.briefingLink}>
                    <span className={`${styles.briefingCount} tnum`}>{n.count}</span>
                    <span>{n.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Overnight — plain-English recap; running count folded in compactly. */}
        <section className={styles.briefingCol}>
          <span className={styles.briefingLabel}>Overnight</span>
          <ul className={styles.briefingList}>
            {briefing.overnight.map((line, i) => (
              <li key={i} className={styles.briefingLine}>
                {line}
              </li>
            ))}
            {running !== null && running > 0 && (
              <li className={styles.briefingLineMuted}>
                <span className="tnum">{running}</span>{' '}
                {running === 1 ? 'conversation' : 'conversations'} running now
                {recovered !== null && (
                  <>
                    {' · '}
                    <span className={styles.briefingOk}>{recovered}</span> recovered
                  </>
                )}
              </li>
            )}
          </ul>
        </section>

        {/* Worth a call — the top of the call list, each with one reason. */}
        <section className={styles.briefingCol}>
          <span className={styles.briefingLabel}>Worth a call</span>
          {briefing.callOut.length === 0 ? (
            <p className={styles.briefingEmpty}>No calls ranked today.</p>
          ) : (
            <ul className={styles.briefingList}>
              {briefing.callOut.map((c) => (
                <li key={c.name} className={styles.briefingCall}>
                  <Link to="/contacts" className={styles.briefingCallName}>
                    {c.name}
                  </Link>
                  <span className={styles.briefingCallReason}>{c.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Slim strip — the top agent asks (tenant + contact mixed), max 2. */}
      {topAsks.length > 0 && (
        <div className={styles.briefingAsks}>
          {topAsks.map((a) => (
            <button
              key={a.id}
              type="button"
              className={styles.briefingAskRow}
              onClick={() => onRun(a.contactName ? `Brief me on ${a.contactName.split(' ')[0]}` : 'call list')}
              title={a.why}
            >
              <span className={styles.briefingAskDot} />
              <span className={styles.briefingAskText}>{a.ask}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Active: the slim pulse strip ──────────────────────────────────────────────
// One quiet line of inline pill stats above the transcript. Live-updates after
// enroll/kill commands (the demo moment) without any dashboard chrome.
export function PulseStrip({ pulse }: { pulse: HomePulse | undefined }) {
  if (pulse === undefined) {
    return (
      <div className={styles.pulseStrip} aria-hidden="true">
        <Skeleton width={280} height={16} radius="999px" />
      </div>
    );
  }
  return (
    <div className={styles.pulseStrip}>
      <Link to="/inbox" className={`${styles.pulsePill} ${styles.pulsePillLink}`}>
        Needs your eyes <b className="tnum">{pulse.needsYourEyes}</b>
      </Link>
      <span className={styles.pulseDivider} />
      <span className={styles.pulsePill}>
        Running <b className="tnum">{pulse.conversationsRunning}</b>
      </span>
      <span className={styles.pulseDivider} />
      <span className={styles.pulsePill}>
        Recovered <b className={`${styles.pulseOk} tnum`}>{dollars(pulse.wonBackCents)}</b>
      </span>
    </div>
  );
}
