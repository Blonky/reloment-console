// Agent (r10) — Campaigns + Agents merged into ONE surface (DESIGN.md §6).
// There is ONE agent per business that switches roles across flows (Intercom-Fin
// shape), not a roster of bots. Three zones, all warm and plain-language, and
// the whole thing holds one viewport at ≥720px tall:
//
//   (a) PROFILE   — the agent's identity: name, line, what it was trained on, the
//                   3 traits as inline chips, and the generic-vs-tuned voice
//                   example (adapted from the old VoiceCard content).
//   (b) FLOWS     — the heart: one hairline row per playbook flow — name + the
//                   plain "When … → texts …" sentence + what it does, the
//                   autonomy as a quiet pill, compact inline stats, and the
//                   on/off Switch (setPlaybookEnabled, optimistic).
//   (c) GUARDRAILS— one quiet strip: the 4 fixed rules as short lines with a
//                   shield glyph. Trust statements, not settings.

import { useClient } from '../../shell/ClientContext.tsx';
import { useData } from '../../data/useData.ts';
import { Skeleton, Switch } from '../../components/index.ts';
import type { PlaybookFlow } from '../../data/types.ts';
import styles from './AgentScreen.module.css';

// ── glyphs ──────────────────────────────────────────────────────────────────
function VoiceGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="1.5" width="4" height="8" rx="2" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" />
      <path d="M8 12v2.5M6 14.5h4" />
    </svg>
  );
}

function ShieldGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={styles.guardIcon}>
      <path d="M8 2 13 4v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" />
      <path d="M6 8l1.5 1.5L10.5 6.5" />
    </svg>
  );
}

// ── Profile ─────────────────────────────────────────────────────────────────
function ProfileSkeleton() {
  return (
    <section className={styles.profile}>
      <div className={styles.profileHead}>
        <Skeleton width={44} height={44} radius="var(--radius)" />
        <div className={styles.profileIdentity}>
          <Skeleton width={180} height={18} />
          <Skeleton width={260} height={12} />
        </div>
      </div>
      <Skeleton width="70%" height={12} />
      <Skeleton width="100%" height={72} radius="var(--radius)" />
    </section>
  );
}

// ── Flows ───────────────────────────────────────────────────────────────────
function FlowRow({
  flow,
  onToggle,
}: {
  flow: PlaybookFlow;
  onToggle: (key: string, enabled: boolean) => void;
}) {
  const { stats } = flow;
  return (
    <div className={`${styles.flowRow} ${flow.enabled ? '' : styles.flowRowOff}`}>
      <div className={styles.flowMain}>
        <span className={styles.flowName}>{flow.name}</span>
        <span className={styles.flowWhen}>
          When {flow.when.charAt(0).toLowerCase() + flow.when.slice(1)} &rarr; texts {flow.who.charAt(0).toLowerCase() + flow.who.slice(1)}
        </span>
        <span className={styles.flowWhat}>{flow.what}</span>
      </div>

      <div className={styles.flowAutonomy}>
        <span
          className={`${styles.autonomyPill} ${
            flow.autonomy === 'auto' ? styles.autonomyAuto : styles.autonomyReview
          }`}
        >
          {flow.autonomyLabel}
        </span>
      </div>

      <div className={styles.flowRight}>
        <span className={`${styles.flowStats} tnum`}>
          {stats.enrolled} enrolled <span className={styles.statSep}>·</span> {stats.sent} sent{' '}
          <span className={styles.statSep}>·</span> {stats.replied} replied
          {stats.heldBack > 0 && (
            <>
              {' '}
              <span className={styles.statSep}>·</span>{' '}
              <span className={styles.statHeld}>{stats.heldBack} held back</span>
            </>
          )}
        </span>
        <Switch
          checked={flow.enabled}
          onToggle={(next) => onToggle(flow.key, next)}
          label={`${flow.name} flow ${flow.enabled ? 'on' : 'off'}`}
        />
      </div>
    </div>
  );
}

function FlowsSkeleton() {
  return (
    <div className={styles.flows}>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={styles.flowRow}>
          <div className={styles.flowMain}>
            <Skeleton width={160} height={14} />
            <Skeleton width="80%" height={12} />
          </div>
          <Skeleton width={150} height={22} radius="999px" />
          <Skeleton width={40} height={20} radius="999px" />
        </div>
      ))}
    </div>
  );
}

export default function AgentScreen() {
  const client = useClient();
  const profile = useData(() => client.agentProfile(), [client]);
  // discoveryNonce-free: flows carry `enabled` from session state; a toggle
  // mutates that state, so refetch after each flip to keep stats honest.
  const flows = useData(() => client.playbookFlows(), [client]);

  const onToggleFlow = (key: string, enabled: boolean) => {
    void client.setPlaybookEnabled(key, enabled).then(() => flows.refetch());
  };

  const p = profile.data;

  return (
    <div className={styles.page}>
      {/* (a) PROFILE — the agent's identity card. */}
      {p === undefined ? (
        <ProfileSkeleton />
      ) : (
        <section className={styles.profile}>
          <div className={styles.profileHead}>
            <span className={styles.profileAvatar} aria-hidden="true">
              <VoiceGlyph />
            </span>
            <div className={styles.profileIdentity}>
              <h1 className={styles.profileName}>{p.name}</h1>
              <span className={styles.profileLine}>
                One agent for the whole business · sends on {p.line}
              </span>
            </div>
            <div className={styles.profileTraits}>
              {p.traits.map((t) => (
                <span key={t} className={styles.traitChip}>
                  {t}
                </span>
              ))}
            </div>
          </div>

          <p className={styles.trainedOn}>Trained on {p.trainedOn}.</p>

          <div className={styles.voiceCompare}>
            <div className={styles.voiceSample}>
              <span className={styles.voiceLabel}>A generic bot says</span>
              <p className={`${styles.voiceText} ${styles.voiceGeneric}`}>{p.example.generic}</p>
            </div>
            <div className={`${styles.voiceSample} ${styles.voiceTuned}`}>
              <span className={`${styles.voiceLabel} ${styles.voiceLabelTuned}`}>Your agent says</span>
              <p className={styles.voiceText}>{p.example.tuned}</p>
            </div>
          </div>
        </section>
      )}

      {/* (b) FLOWS — the heart. Hairline rows, one per playbook flow. */}
      <section className={styles.flowsSection}>
        <div className={styles.flowsHead}>
          <h2 className={styles.sectionTitle}>Flows</h2>
          <span className={styles.sectionHint}>What the agent does, and how far it goes on its own.</span>
        </div>
        {flows.data === undefined ? (
          <FlowsSkeleton />
        ) : (
          <div className={styles.flows}>
            {flows.data.map((flow) => (
              <FlowRow key={flow.key} flow={flow} onToggle={onToggleFlow} />
            ))}
          </div>
        )}
      </section>

      {/* (c) GUARDRAILS — one quiet trust strip at the bottom. */}
      {p !== undefined && (
        <section className={styles.guardrails}>
          <span className={styles.guardrailsLabel}>Guardrails · what it will never do without you</span>
          <ul className={styles.guardList}>
            {p.guardrails.map((g) => (
              <li key={g} className={styles.guardItem}>
                <ShieldGlyph />
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
