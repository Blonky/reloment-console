import { useState } from 'react';
import { Card, Button } from '../../components/index.ts';
import { useClient, useKillSwitch } from '../../shell/ClientContext.tsx';
import styles from './KillSwitchCard.module.css';

export default function KillSwitchCard() {
  const client = useClient();
  const { killSwitch, setKillSwitch } = useKillSwitch();

  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const nextOn = !killSwitch; // if paused now, next action resumes; else pauses
  const requiredWord = nextOn ? 'pause' : 'resume';
  const matches = typed.trim().toLowerCase() === requiredWord;

  function beginConfirm() {
    setConfirming(true);
    setTyped('');
  }

  function cancel() {
    setConfirming(false);
    setTyped('');
  }

  async function commit() {
    if (!matches || busy) return;
    setBusy(true);
    try {
      await client.setKillSwitch(nextOn);
      setKillSwitch(nextOn);
    } finally {
      setBusy(false);
      setConfirming(false);
      setTyped('');
    }
  }

  return (
    <Card title="Kill switch">
      <div className={`${styles.panel} ${killSwitch ? styles.panelPaused : styles.panelLive}`}>
        <div className={styles.status}>
          <span className={`${styles.dot} ${killSwitch ? styles.dotPaused : styles.dotLive}`} />
          <div className={styles.statusText}>
            <span className={styles.statusHead}>
              {killSwitch ? 'All sending paused' : 'Sending is live'}
            </span>
            <span className={styles.statusSub}>
              {killSwitch
                ? 'No outbound message will leave the line until you resume.'
                : 'The agent may send within its ceilings; every send still runs the gate.'}
            </span>
          </div>
        </div>

        {!confirming ? (
          <Button
            variant={nextOn ? 'danger' : 'primary'}
            size="md"
            onClick={beginConfirm}
          >
            {nextOn ? 'Pause all sending' : 'Resume sending'}
          </Button>
        ) : (
          <div className={styles.confirm}>
            <label className={styles.confirmLabel} htmlFor="killswitch-confirm">
              Type <span className={styles.word}>{requiredWord}</span> to confirm
            </label>
            <div className={styles.confirmRow}>
              <input
                id="killswitch-confirm"
                className={styles.input}
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={requiredWord}
                autoComplete="off"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commit();
                  if (e.key === 'Escape') cancel();
                }}
              />
              <Button
                variant={nextOn ? 'danger' : 'primary'}
                size="md"
                disabled={!matches || busy}
                onClick={() => void commit()}
              >
                {nextOn ? 'Pause' : 'Resume'}
              </Button>
              <Button variant="ghost" size="md" onClick={cancel} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      <p className={styles.microcopy}>
        The kill switch stops <strong>all</strong> outbound sending instantly. Inbound messages are
        still received, and a human can always take over any thread.
      </p>
    </Card>
  );
}
