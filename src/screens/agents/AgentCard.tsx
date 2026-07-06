import type { LineAgent } from '../../data/types.ts';
import { StatusPill, Button } from '../../components/index.ts';
import AutonomyLadder from './AutonomyLadder.tsx';
import styles from './AgentCard.module.css';

export interface AgentCardProps {
  agent: LineAgent;
}

function formatE164(e164: string): string {
  // +15125550100 → +1 512 555 0100
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (m === null) return e164;
  return `+1 ${m[1]} ${m[2]} ${m[3]}`;
}

function registration(agent: LineAgent) {
  if (agent.quarantined) return { tone: 'hold' as const, label: 'Quarantined' };
  if (agent.registered) return { tone: 'ok' as const, label: 'Registered' };
  return { tone: 'block' as const, label: 'Unregistered' };
}

// The read-only segmented control mirrors the ladder rungs so it reads as the
// live setting — but it is inert (no owner + counsel sign-off in the console).
const SEGMENTS: { key: LineAgent['autonomyCeiling']; label: string }[] = [
  { key: 'draft', label: 'Draft only' },
  { key: 'approved_send', label: 'Approved send' },
  { key: 'auto', label: 'Bounded auto' },
];

export default function AgentCard({ agent }: AgentCardProps) {
  const reg = registration(agent);

  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <div className={styles.identity}>
          <h2 className={styles.name}>{agent.name}</h2>
          <span className={`${styles.line} tnum`}>{formatE164(agent.e164)}</span>
        </div>
        <StatusPill tone={reg.tone}>{reg.label}</StatusPill>
      </header>

      <div className={styles.playbooks}>
        <span className={styles.sectionLabel}>Playbooks</span>
        <div className={styles.pillRow}>
          {agent.playbooks.length === 0 ? (
            <span className={styles.noneChip}>None attached</span>
          ) : (
            agent.playbooks.map((p) => (
              <span key={p} className={styles.playbookChip}>
                {p}
              </span>
            ))
          )}
        </div>
      </div>

      <div className={styles.ladderBlock}>
        <span className={styles.sectionLabel}>Autonomy ceiling</span>
        <AutonomyLadder ceiling={agent.autonomyCeiling} />
      </div>

      <div className={styles.controlBlock}>
        <div className={styles.segmented} role="group" aria-label="Autonomy ceiling (read-only)">
          {SEGMENTS.map((seg) => {
            const active = seg.key === agent.autonomyCeiling;
            return (
              <span
                key={seg.key}
                className={`${styles.segment} ${active ? styles.segmentActive : ''}`}
                aria-current={active ? 'true' : undefined}
              >
                {seg.label}
              </span>
            );
          })}
        </div>
        <div className={styles.controlAside}>
          <Button variant="secondary" size="sm" disabled>
            Change ceiling
          </Button>
        </div>
      </div>
      <p className={styles.microcopy}>Changes require an owner + counsel sign-off.</p>
    </article>
  );
}
