// Gate disclosure — the quiet collapsed row that sits above each reply body
// (DESIGN.md §5). Collapsed it reads "Ran the send gate · N checks · 0.3s" (or,
// honestly, "Read-only · no sends attempted" / "Control action") with a chevron;
// expanding lists the deterministic checks in gate order with a pass/hold/block
// dot and a short factual note per check. It never invents per-check timing —
// the single run duration comes from a real performance.now() delta.

import { useState } from 'react';
import type { GateDisclosure as Disclosure } from './gateChecks.ts';
import { formatDuration } from './gateChecks.ts';
import styles from './HomeScreen.module.css';

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={`${styles.gateChevron} ${open ? styles.gateChevronOpen : ''}`}
  >
    <path d="M4.5 3l3 3-3 3" />
  </svg>
);

export default function GateDisclosure({
  disclosure,
  durationMs,
}: {
  disclosure: Disclosure;
  durationMs: number;
}) {
  const [open, setOpen] = useState(false);

  // Read-only and control runs have no gated checks to expand — render a single
  // quiet, non-interactive line so the transcript stays honest.
  if (disclosure.kind !== 'gated') {
    const label =
      disclosure.kind === 'read_only'
        ? 'Read-only · no sends attempted'
        : 'Control action · toggles the gate, no send';
    return (
      <div className={`${styles.gateRow} ${styles.gateRowStatic}`}>
        <span className={styles.gateDotNeutral} />
        <span className={styles.gateSummary}>{label}</span>
      </div>
    );
  }

  const n = disclosure.checks.length;
  return (
    <div className={styles.gate}>
      <button
        type="button"
        className={styles.gateRow}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Chevron open={open} />
        <span className={styles.gateSummary}>
          Ran the send gate · {n} {n === 1 ? 'check' : 'checks'} ·{' '}
          <span className="tnum">{formatDuration(durationMs)}</span>
        </span>
      </button>
      {open && (
        <ul className={styles.gateChecks}>
          {disclosure.checks.map((c) => (
            <li className={styles.gateCheck} key={c.key}>
              <span
                className={`${styles.gateCheckDot} ${
                  c.outcome === 'pass'
                    ? styles.gateDotOk
                    : c.outcome === 'hold'
                      ? styles.gateDotHold
                      : styles.gateDotBlock
                }`}
              />
              <span className={styles.gateCheckLabel}>{c.label}</span>
              {c.note && <span className={styles.gateCheckNote}>{c.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
