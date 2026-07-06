// Switch — the shared day/night toggle (extracted from the inbox AgentToggle).
// A 34×20 pill track with a knob: accent when ON, hairline neutral when OFF.
// role="switch"; the flip is OPTIMISTIC — onToggle fires immediately and the
// knob slides at once, reverting only if the toggle rejects. Used by the thread
// AgentToggle and the Agent tab's per-flow switches so both read identically.

import { useState } from 'react';
import styles from './Switch.module.css';

export interface SwitchProps {
  checked: boolean;
  onToggle: (next: boolean) => void | Promise<void>;
  // Accessible name for the control (e.g. "Agent on", "Renewal reminder flow").
  label: string;
  disabled?: boolean;
}

export default function Switch({ checked, onToggle, label, disabled = false }: SwitchProps) {
  // Optimistic local state so the knob slides instantly; reverts if the toggle
  // rejects. The parent owns the confirmed value and re-mounts on real change.
  const [optimistic, setOptimistic] = useState(checked);
  const on = optimistic;

  const flip = () => {
    if (disabled) return;
    const next = !on;
    setOptimistic(next);
    void Promise.resolve(onToggle(next)).catch(() => setOptimistic(!next));
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`${styles.track} ${on ? styles.trackOn : ''}`}
      onClick={flip}
    >
      <span className={styles.knob} aria-hidden="true" />
    </button>
  );
}
