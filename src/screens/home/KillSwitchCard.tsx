// Kill-switch confirm card — an inline typed-confirm affordance in the
// transcript. Governance is a feature: pausing all sending is never a one-tap
// accident. The operator types the exact word to confirm; the card resolves to
// a calm done-state. On confirm we flip the client AND sync the shell context
// so the red topbar band appears instantly (App.tsx owns the band).

import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/index.ts';
import styles from './HomeScreen.module.css';
import { IconPause, IconResume } from './icons.tsx';

export type KillSwitchMode = 'pause' | 'resume';

interface KillSwitchCardProps {
  mode: KillSwitchMode;
  // Runs the actual mutation (client.setKillSwitch) + shell sync + pulse refetch.
  onConfirm: () => Promise<void>;
}

export default function KillSwitchCard({ mode, onConfirm }: KillSwitchCardProps) {
  const word = mode === 'pause' ? 'pause' : 'resume';
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'done'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the confirm input when the card mounts — the confirm is the next step.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const matches = value.trim().toLowerCase() === word;

  async function confirm() {
    if (!matches || status !== 'idle') return;
    setStatus('working');
    await onConfirm();
    setStatus('done');
  }

  if (status === 'done') {
    return (
      <div className={styles.reply}>
        <div className={styles.replyHead}>
          <span className={styles.replyHeadIcon}>
            {mode === 'pause' ? <IconPause /> : <IconResume />}
          </span>
          <span className={styles.replyTitle}>
            {mode === 'pause' ? 'All sending paused' : 'Sending resumed'}
          </span>
        </div>
        <div className={styles.replyBody}>
          <span
            className={`${styles.confirmDone} ${
              mode === 'pause' ? styles.confirmDonePaused : styles.confirmDoneResumed
            }`}
          >
            {mode === 'pause'
              ? 'The kill switch is on. Every outbound send is blocked at the gate until you resume.'
              : 'The kill switch is off. The agent can send again, subject to the usual gate.'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.reply}>
      <div className={styles.replyHead}>
        <span className={styles.replyHeadIcon}>
          {mode === 'pause' ? <IconPause /> : <IconResume />}
        </span>
        <span className={styles.replyTitle}>
          {mode === 'pause' ? 'Confirm — pause all sending' : 'Confirm — resume sending'}
        </span>
      </div>
      <div className={styles.replyBody}>
        <div className={styles.confirm}>
          <span className={styles.replyLede}>
            {mode === 'pause' ? (
              <>
                This flips the kill switch and blocks every outbound message across
                the fleet. Type{' '}
                <span className={styles.confirmWord}>pause</span> to confirm.
              </>
            ) : (
              <>
                This lifts the kill switch and lets the agent send again. Type{' '}
                <span className={`${styles.confirmWord} ${styles.confirmWordResume}`}>
                  resume
                </span>{' '}
                to confirm.
              </>
            )}
          </span>
          <div className={styles.confirmRow}>
            <input
              ref={inputRef}
              className={styles.confirmInput}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void confirm();
                }
              }}
              placeholder={`Type “${word}”`}
              aria-label={`Type ${word} to confirm`}
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              variant={mode === 'pause' ? 'danger' : 'primary'}
              disabled={!matches || status !== 'idle'}
              onClick={() => void confirm()}
            >
              {status === 'working'
                ? 'Working…'
                : mode === 'pause'
                  ? 'Pause everything'
                  : 'Resume'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
