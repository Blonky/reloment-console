// AgentToggle — the quiet day/night switch in the thread header (messages-first
// v4). Word "Agent" (12px --ink-2) + the shared Switch: accent track when ON,
// hairline neutral when OFF. The flip is optimistic (Switch owns that); the
// parent reconciles on agent.toggled. A human message never disables the agent;
// only this switch does.

import { Switch } from '../../components/index.ts';
import styles from './InboxScreen.module.css';

export interface AgentToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
}

export default function AgentToggle({ enabled, onToggle }: AgentToggleProps) {
  return (
    <span className={styles.agentToggle}>
      <span className={styles.agentToggleLabel}>Agent</span>
      <Switch
        checked={enabled}
        onToggle={onToggle}
        label={`Agent ${enabled ? 'on' : 'off'}`}
      />
    </span>
  );
}
