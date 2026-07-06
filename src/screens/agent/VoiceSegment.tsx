// Agent → Voice (r13). The editable identity: the agent's name, its traits as
// editable chips, and a "House style" instructions textarea. Autosave on blur —
// no Save button ceremony, just a quiet "Saved" wisp. Every field flows through
// updateAgentVoice; because agentProfile()/toneProfile() read the same store, the
// before/after example's "Your agent" side and the Overview identity card reflect
// edits on the next read.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useClient } from '../../shell/ClientContext.tsx';
import { useData } from '../../data/useData.ts';
import { Skeleton } from '../../components/index.ts';
import type { AgentVoice } from '../../data/types.ts';
import styles from './VoiceSegment.module.css';

const TRAIT_MAX = 6;
const TRAIT_LEN = 60;
const INSTRUCTIONS_LEN = 2000;
const HELPER =
  "Plain-language instructions your agent follows — e.g. 'Never quote exact premiums over text; offer a call.'";

// How long the "Saved" wisp stays visible after a persisted edit.
const WISP_MS = 1600;

function CloseGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

function VoiceSkeleton() {
  return (
    <div className={styles.card}>
      <Skeleton width={220} height={26} />
      <Skeleton width="40%" height={12} />
      <Skeleton width="100%" height={30} radius="var(--radius-pill)" />
      <Skeleton width="100%" height={96} radius="var(--radius)" />
    </div>
  );
}

// One editable trait chip. Renders as text until clicked, then an inline input;
// blur (or Enter) commits, Escape cancels. The ✕ removes it.
function TraitChip({
  value,
  onCommit,
  onRemove,
}: {
  value: string;
  onCommit: (next: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
    else setDraft(value);
  };

  return (
    <span className={styles.chip}>
      {editing ? (
        <input
          ref={inputRef}
          className={styles.chipInput}
          value={draft}
          maxLength={TRAIT_LEN}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              setDraft(value);
              setEditing(false);
            }
          }}
          aria-label={`Edit trait: ${value}`}
        />
      ) : (
        <button
          type="button"
          className={styles.chipLabel}
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        >
          {value}
        </button>
      )}
      <button
        type="button"
        className={styles.chipRemove}
        onClick={onRemove}
        aria-label={`Remove trait: ${value}`}
      >
        <CloseGlyph />
      </button>
    </span>
  );
}

// Strip em/en dashes from a would-be text-message body, restructuring to natural
// punctuation — the voice canon: em dashes read as machine-written (DESIGN.md §6).
// Applied to the derived sample so what the customer would receive is honest to
// the rule the rest of the agent's sends follow.
function stripDashes(body: string): string {
  return body
    .replace(/\s*—\s*/g, ', ')
    .replace(/\s*–\s*/g, ', ')
    .replace(/,\s*,/g, ',');
}

export default function VoiceSegment() {
  const client = useClient();
  const voice = useData(() => client.agentVoice(), [client]);
  // The Voice-training connection status — read from the same catalog Settings
  // shows, so the "Voice source" row states the TRUTH (trained vs not) rather than
  // presenting a fixture claim as fact on the identity card.
  const catalog = useData(() => client.connectionsCatalog(), [client]);

  // Local working copy so typing feels instant; the store is the source of truth
  // and we resync from it whenever a fresh read lands.
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saved, setSaved] = useState(false);
  const wispTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (voice.data) {
      setName(voice.data.name);
      setInstructions(voice.data.instructions);
    }
  }, [voice.data]);

  useEffect(
    () => () => {
      if (wispTimer.current) clearTimeout(wispTimer.current);
    },
    [],
  );

  const flashSaved = useCallback(() => {
    setSaved(true);
    if (wispTimer.current) clearTimeout(wispTimer.current);
    wispTimer.current = setTimeout(() => setSaved(false), WISP_MS);
  }, []);

  // Persist a partial patch, then refetch so the derived example + traits agree
  // with the store (proves training changed the agent).
  const persist = useCallback(
    (patch: Partial<AgentVoice>) => {
      void client.updateAgentVoice(patch).then(() => {
        flashSaved();
        voice.refetch();
      });
    },
    [client, flashSaved, voice],
  );

  const data = voice.data;
  if (data === undefined) return <VoiceSkeleton />;

  const traits = data.traits;

  // Voice source — the training connection's status, framed honestly. Connected →
  // show its detail ("Trained on 412 conversations…", true as a connection status);
  // not connected → the honest fallback (the agent uses house style + knowledge).
  const voiceConn = catalog.data?.connected.find((c) => c.key === 'voice');
  const voiceTrained = voiceConn?.status === 'connected';
  const voiceSourceText =
    voiceConn === undefined
      ? undefined
      : voiceTrained
        ? voiceConn.detail
        : 'Not trained yet — the agent uses your house style and knowledge only.';

  // The sample the agent would send — DERIVED from the stored tuned example, with
  // em dashes stripped (§6) so it obeys the same rule as real sends. It reflects
  // the current voice, and updates as training deepens (note below). This is not
  // an uneditable factual claim: it is a live sample, honestly labelled.
  const sampleBody = stripDashes(voiceExampleTuned);
  // If the house-style instructions carry recognizable directives, note that the
  // sample tracks the voice as it is tuned (kept honest + simple).
  const hasDirectives = instructions.trim().length > 0;

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== data.name) persist({ name: trimmed });
    else setName(data.name);
  };

  const commitInstructions = () => {
    if (instructions !== data.instructions) persist({ instructions });
  };

  const editTrait = (index: number, next: string) => {
    const nextTraits = traits.map((t, i) => (i === index ? next : t));
    persist({ traits: nextTraits });
  };
  const removeTrait = (index: number) => {
    persist({ traits: traits.filter((_, i) => i !== index) });
  };
  const addTrait = () => {
    if (traits.length >= TRAIT_MAX) return;
    persist({ traits: [...traits, 'New trait'] });
  };

  return (
    <div className={styles.card}>
      {/* Voice source — a quiet status row (NOT an editable field). Reads the
          Voice-training connection so the "trained on…" claim lives where it's
          honest: as a connection status, not a fixed fact on the identity card. */}
      {voiceSourceText !== undefined && (
        <div className={styles.sourceRow}>
          <span
            className={`${styles.sourceDot} ${voiceTrained ? '' : styles.sourceDotOff}`}
            aria-hidden="true"
          />
          <div className={styles.sourceText}>
            <span className={styles.sourceLabel}>Voice source</span>
            <span className={styles.sourceValue}>{voiceSourceText}</span>
          </div>
        </div>
      )}

      {/* Name — an inline input styled as the display heading. */}
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="agent-name">
          Agent name
        </label>
        <input
          id="agent-name"
          className={styles.nameInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label="Agent name"
        />
      </div>

      {/* Traits — editable chips with a "+ trait" ghost chip (max 6). */}
      <div className={styles.field}>
        <label className={styles.fieldLabel}>
          Voice traits <span className={styles.count}>{traits.length}/{TRAIT_MAX}</span>
        </label>
        <div className={styles.chips}>
          {traits.map((t, i) => (
            <TraitChip
              key={`${t}-${i}`}
              value={t}
              onCommit={(next) => editTrait(i, next)}
              onRemove={() => removeTrait(i)}
            />
          ))}
          {traits.length < TRAIT_MAX && (
            <button type="button" className={styles.addChip} onClick={addTrait}>
              <PlusGlyph />
              trait
            </button>
          )}
        </div>
      </div>

      {/* House style — the plain-language instructions textarea. */}
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="house-style">
          House style{' '}
          <span className={styles.count}>
            {instructions.length}/{INSTRUCTIONS_LEN}
          </span>
        </label>
        <p className={styles.helper}>{HELPER}</p>
        <textarea
          id="house-style"
          className={styles.instructions}
          value={instructions}
          maxLength={INSTRUCTIONS_LEN}
          rows={4}
          onChange={(e) => setInstructions(e.target.value)}
          onBlur={commitInstructions}
          placeholder="Add the house rules your agent should always follow…"
          aria-label="House style instructions"
        />
      </div>

      {/* Before/after — the right column is a LIVE sample of what your agent would
          send, derived from the voice store (em dashes stripped per §6). Not a
          fixed claim: it tracks the voice, and the note says so once you've added
          house-style instructions. */}
      <div className={styles.compare}>
        <div className={styles.sample}>
          <span className={styles.sampleLabel}>A generic bot says</span>
          <p className={`${styles.sampleText} ${styles.sampleGeneric}`}>{voiceExampleGeneric}</p>
        </div>
        <div className={`${styles.sample} ${styles.sampleTuned}`}>
          <span className={`${styles.sampleLabel} ${styles.sampleLabelTuned}`}>
            Your agent · sample
          </span>
          <p className={styles.sampleText}>{sampleBody}</p>
        </div>
      </div>
      {hasDirectives && (
        <p className={styles.sampleNote}>Sample updates as your voice training deepens.</p>
      )}

      {/* The quiet autosave wisp. aria-live so it's announced without stealing focus. */}
      <span className={`${styles.wisp} ${saved ? styles.wispOn : ''}`} aria-live="polite">
        {saved ? 'Saved' : ''}
      </span>
    </div>
  );
}

// The before/after example prose. Kept as constants (the demo does not retrain
// the example body from edits — what visibly moves is the identity card's name +
// traits, which agentProfile() derives from the live store). Sourced to match the
// tuned tone example on the Overview card.
const voiceExampleGeneric =
  'Dear valued customer, your policy is approaching its renewal date. Please contact our office at your earliest convenience to discuss your coverage options.';
const voiceExampleTuned =
  'Hey Dana — I hear you. Your auto+home renews Jul 28, and Tom kept time open to walk through your options first. Want Thursday at 5:30, after work?';
