import type { Autonomy } from '../../data/types.ts';
import styles from './AutonomyLadder.module.css';

export interface AutonomyLadderProps {
  ceiling: Autonomy;
}

interface Rung {
  key: Autonomy;
  label: string;
  detail: string;
}

// Ordered low → high. The ceiling is the MAXIMUM rung this agent may reach.
const RUNGS: Rung[] = [
  {
    key: 'draft',
    label: 'Draft only',
    detail: 'Agent drafts every message; a human approves before anything sends.',
  },
  {
    key: 'approved_send',
    label: 'Approved send',
    detail:
      'Agent sends within the ceiling after you approve the draft; the gate still runs on every send.',
  },
  {
    key: 'auto',
    label: 'Bounded auto',
    detail:
      'Agent sends low-risk, in-policy messages on its own, inside strict bounds; advice always routes to a human.',
  },
];

const ORDER: Record<Autonomy, number> = { draft: 0, approved_send: 1, auto: 2 };

export default function AutonomyLadder({ ceiling }: AutonomyLadderProps) {
  const ceilingIndex = ORDER[ceiling];

  return (
    <ol className={styles.ladder} aria-label="Autonomy ceiling">
      {RUNGS.map((rung, i) => {
        const isCeiling = i === ceilingIndex;
        const reached = i <= ceilingIndex;
        const state = isCeiling ? 'ceiling' : reached ? 'reached' : 'above';
        return (
          <li key={rung.key} className={`${styles.rung} ${styles[state]}`}>
            <span className={styles.marker} aria-hidden="true">
              <span className={styles.dot} />
            </span>
            <span className={styles.content}>
              <span className={styles.rungHead}>
                <span className={styles.rungLabel}>{rung.label}</span>
                {isCeiling && <span className={styles.ceilingTag}>Ceiling</span>}
              </span>
              <span className={styles.rungDetail}>
                {state === 'above' ? 'Not permitted for this agent.' : rung.detail}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
