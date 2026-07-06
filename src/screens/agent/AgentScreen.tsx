// Agent (r13) — the agent surface becomes an EDITABLE knowledge-base workspace.
// A quiet segmented control under the page title splits it into three one-viewport
// segments (each scrolls internally):
//
//   Overview  — the read-only identity card + flows + guardrails (r10 content,
//               unchanged). Compliance guardrails stay here: they are not
//               knowledge, they are immutable rules.
//   Voice     — editable name, traits (chips), and a "House style" instructions
//               textarea. Autosave on blur with a quiet "Saved" wisp. The tuned
//               example header reads "Your agent" and reflects live edits (name +
//               traits derive from the voice store via agentProfile()).
//   Knowledge — a Sauna-memory-style list of editable documents grouped by kind,
//               with an inline editor panel. Everything here is folded into the
//               agent's context.

import { useState } from 'react';
import { useClient } from '../../shell/ClientContext.tsx';
import { useData } from '../../data/useData.ts';
import { Skeleton, Switch } from '../../components/index.ts';
import type { PlaybookFlow } from '../../data/types.ts';
import VoiceSegment from './VoiceSegment.tsx';
import KnowledgeSegment from './KnowledgeSegment.tsx';
import styles from './AgentScreen.module.css';

type Segment = 'overview' | 'voice' | 'knowledge';

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'voice', label: 'Voice' },
  { id: 'knowledge', label: 'Knowledge' },
];

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

// ── Overview: Profile ───────────────────────────────────────────────────────
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
    </section>
  );
}

// ── Overview: Flows ─────────────────────────────────────────────────────────
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

// ── Overview segment (r10 content, unchanged) ───────────────────────────────
function OverviewSegment() {
  const client = useClient();
  const profile = useData(() => client.agentProfile(), [client]);
  const flows = useData(() => client.playbookFlows(), [client]);

  const onToggleFlow = (key: string, enabled: boolean) => {
    void client.setPlaybookEnabled(key, enabled).then(() => flows.refetch());
  };

  const p = profile.data;

  return (
    <div className={styles.overview}>
      {/* PROFILE — the agent's identity card. */}
      {p === undefined ? (
        <ProfileSkeleton />
      ) : (
        <section className={styles.profile}>
          <div className={styles.profileHead}>
            <span className={styles.profileAvatar} aria-hidden="true">
              <VoiceGlyph />
            </span>
            <div className={styles.profileIdentity}>
              <h2 className={styles.profileName}>{p.name}</h2>
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
        </section>
      )}

      {/* FLOWS — the heart. Hairline rows, one per playbook flow. */}
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

      {/* GUARDRAILS — one quiet trust strip. Immutable rules, NOT knowledge. */}
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

export default function AgentScreen() {
  const [segment, setSegment] = useState<Segment>('overview');

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <h1 className={styles.title}>Agent</h1>
        <div className={styles.segments} role="tablist" aria-label="Agent sections">
          {SEGMENTS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={segment === s.id}
              className={`${styles.segment} ${segment === s.id ? styles.segmentActive : ''}`}
              onClick={() => setSegment(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      <div className={styles.segmentBody}>
        {segment === 'overview' && <OverviewSegment />}
        {segment === 'voice' && <VoiceSegment />}
        {segment === 'knowledge' && <KnowledgeSegment />}
      </div>
    </div>
  );
}
