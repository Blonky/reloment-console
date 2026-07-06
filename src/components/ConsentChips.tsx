import StatusPill from './StatusPill.tsx';
import styles from './ConsentChips.module.css';

export interface ConsentChipsProps {
  consents: string[];
  timezone?: string;
  optedOut?: boolean;
}

function shortTz(tz: string): string {
  const segment = tz.split('/').pop() ?? tz;
  return segment.replaceAll('_', ' ');
}

export default function ConsentChips({ consents, timezone, optedOut }: ConsentChipsProps) {
  return (
    <div className={styles.chips}>
      {optedOut ? (
        <StatusPill tone="block">Opted out</StatusPill>
      ) : (
        <>
          {consents.includes('transactional') && (
            <StatusPill tone="info">Transactional</StatusPill>
          )}
          {consents.includes('marketing') && <StatusPill tone="ok">Marketing</StatusPill>}
        </>
      )}
      {timezone !== undefined && (
        <StatusPill tone="neutral">Quiet hours 9pm–8am {shortTz(timezone)}</StatusPill>
      )}
    </div>
  );
}
