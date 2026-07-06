import styles from './Avatar.module.css';

export interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.slice(0, 2).map((w) => w[0]);
  return letters.join('').toUpperCase();
}

function hueFor(name: string): number {
  let acc = 0;
  for (let i = 0; i < name.length; i += 1) {
    acc = (acc * 31 + name.charCodeAt(i)) >>> 0;
  }
  return acc % 360;
}

export default function Avatar({ name, size = 'md' }: AvatarProps) {
  const hue = hueFor(name);
  return (
    <span
      className={`${styles.avatar} ${styles[size]}`}
      style={{
        background: `hsl(${hue} 45% 88%)`,
        color: `hsl(${hue} 55% 30%)`,
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
