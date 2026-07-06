// AgentToggle — the quiet day/night switch in the thread header (messages-first
// v4). Word "Agent" (12px --ink-2) + a 34×20 pill track with a knob. Accent track
// when ON, hairline neutral when OFF. role="switch"; the flip is optimistic —
// setAgentEnabled fires immediately and the parent reconciles on agent.toggled.
// A human message never disables the agent; only this switch does.

import { useState } from 'react';
import styles from './InboxScreen.module.css';

export interface AgentToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
}

export default function AgentToggle({ enabled, onToggle }: AgentToggleProps) {
  // Optimistic local state so the knob slides instantly; reconciled by the
  // enabled prop once the store confirms via agent.toggled.
  const [optimistic, setOptimistic] = useState(enabled);
  const on = optimistic;

  const flip = () => {
    const next = !on;
    setOptimistic(next);
    void onToggle(next).catch(() => setOptimistic(!next));
  };

  return (
    <span className={styles.agentToggle}>
      <span className={styles.agentToggleLabel}>Agent</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Agent ${on ? 'on' : 'off'}`}
        className={`${styles.agentTrack} ${on ? styles.agentTrackOn : ''}`}
        onClick={flip}
      >
        <span className={styles.agentKnob} aria-hidden="true" />
      </button>
    </span>
  );
}
