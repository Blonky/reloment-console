import StatusPill, { type StatusTone } from './StatusPill.tsx';
import styles from './GateReason.module.css';

export interface GateReasonProps {
  reason: string;
  variant?: 'chip' | 'row';
}

type Tone = 'ok' | 'hold' | 'block' | 'neutral';

interface Mapped {
  sentence: string;
  tone: Tone;
}

const MAP: Record<string, Mapped> = {
  allow: { sentence: 'Cleared to send', tone: 'ok' },
  carrier_reply: { sentence: 'Carrier-required reply — always allowed', tone: 'ok' },
  invalid_message: { sentence: 'Message failed validation', tone: 'block' },
  kill_switch: { sentence: 'All sending paused by kill switch', tone: 'block' },
  opted_out: { sentence: 'Opted out — will never be texted again', tone: 'block' },
  reassigned_number_unscrubbed: {
    sentence: 'Number may be reassigned — re-verifying before we text',
    tone: 'block',
  },
  reassigned_number: {
    sentence: 'Number may be reassigned — re-verifying before we text',
    tone: 'block',
  },
  no_marketing_consent: { sentence: 'No marketing consent on file — not eligible', tone: 'block' },
  no_consent: { sentence: 'No marketing consent on file — not eligible', tone: 'block' },
  no_transactional_basis: { sentence: 'No transactional basis on file', tone: 'block' },
  line_not_registered: { sentence: 'Line not yet registered (A2P 10DLC)', tone: 'block' },
  unregistered_line: { sentence: 'Line not yet registered (A2P 10DLC)', tone: 'block' },
  advice_never_auto: { sentence: 'Routed to a licensed human', tone: 'block' },
  advice_requires_licensed_human: { sentence: 'Routed to a licensed human', tone: 'block' },
  exceeds_autonomy_ceiling: {
    sentence: "Above this agent's autonomy ceiling — needs your approval",
    tone: 'block',
  },
  autonomy_ceiling: {
    sentence: "Above this agent's autonomy ceiling — needs your approval",
    tone: 'block',
  },
  line_quarantined: { sentence: 'Line quarantined — held until healthy', tone: 'hold' },
  quarantined: { sentence: 'Line quarantined — held until healthy', tone: 'hold' },
  quiet_hours: { sentence: 'Held for quiet hours — sends 8:00 AM their time', tone: 'hold' },
  gate_error: { sentence: 'Held: the send gate could not verify this', tone: 'block' },
};

function humanize(reason: string): string {
  const spaced = reason.replaceAll('_', ' ').trim();
  if (spaced.length === 0) return reason;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function resolve(reason: string): Mapped {
  return MAP[reason] ?? { sentence: humanize(reason), tone: 'neutral' };
}

const DOT_CLASS: Record<Tone, string> = {
  ok: styles.dotOk,
  hold: styles.dotHold,
  block: styles.dotBlock,
  neutral: styles.dotNeutral,
};

export default function GateReason({ reason, variant = 'chip' }: GateReasonProps) {
  const { sentence, tone } = resolve(reason);

  if (variant === 'row') {
    return (
      <span className={styles.row}>
        <span className={`${styles.dot} ${DOT_CLASS[tone]}`} />
        <span className={styles.sentence}>{sentence}</span>
      </span>
    );
  }

  const pillTone: StatusTone = tone;
  return <StatusPill tone={pillTone}>{sentence}</StatusPill>;
}
