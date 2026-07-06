import styles from './ChannelBadge.module.css';

export type BadgeChannel = 'imessage' | 'rcs' | 'sms';

export interface ChannelBadgeProps {
  channel: BadgeChannel;
}

const LABELS: Record<BadgeChannel, string> = {
  imessage: 'iMessage',
  rcs: 'RCS',
  sms: 'SMS',
};

export default function ChannelBadge({ channel }: ChannelBadgeProps) {
  return (
    <span className={styles.badge}>
      <span className={`${styles.dot} ${styles[channel]}`} />
      {LABELS[channel]}
    </span>
  );
}
