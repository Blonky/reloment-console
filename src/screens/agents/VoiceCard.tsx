// Voice card (round 7) — how the line agents were tuned to the agency's voice.
// Fits the Agents grid as one more card: title, trainedOn line, three traits as
// quiet bullets, then a compact before/after (generic muted vs Hartley voice in
// an accent-soft card) from toneProfile(). Read-only.

import type { ToneProfile } from '../../data/types.ts';
import { Skeleton } from '../../components/index.ts';
import styles from './VoiceCard.module.css';

function VoiceGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="1.5" width="4" height="8" rx="2" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" />
      <path d="M8 12v2.5M6 14.5h4" />
    </svg>
  );
}

export function VoiceCardSkeleton() {
  return (
    <article className={styles.card}>
      <div className={styles.head}>
        <Skeleton width={160} height={16} />
      </div>
      <Skeleton width="90%" height={12} />
      <div className={styles.traits}>
        <Skeleton width="70%" height={12} />
        <Skeleton width="60%" height={12} />
        <Skeleton width="65%" height={12} />
      </div>
      <Skeleton width="100%" height={96} />
    </article>
  );
}

export default function VoiceCard({ profile }: { profile: ToneProfile }) {
  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <span className={styles.headIcon}>
          <VoiceGlyph />
        </span>
        <div className={styles.headText}>
          <h2 className={styles.title}>Voice · learned from your team</h2>
          <span className={styles.trainedOn}>Trained on {profile.trainedOn}</span>
        </div>
      </header>

      <ul className={styles.traits}>
        {profile.traits.map((t) => (
          <li key={t} className={styles.trait}>
            <span className={styles.traitBullet} />
            <span>{t}</span>
          </li>
        ))}
      </ul>

      <div className={styles.compare}>
        <div className={styles.sample}>
          <span className={styles.sampleLabel}>Generic</span>
          <p className={`${styles.sampleText} ${styles.sampleGeneric}`}>
            {profile.example.generic}
          </p>
        </div>
        <div className={`${styles.sample} ${styles.sampleTuned}`}>
          <span className={`${styles.sampleLabel} ${styles.sampleLabelTuned}`}>
            Hartley voice
          </span>
          <p className={styles.sampleText}>{profile.example.tuned}</p>
        </div>
      </div>
    </article>
  );
}
