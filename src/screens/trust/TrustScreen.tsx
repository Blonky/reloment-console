import { useState } from 'react';
import { useClient } from '../../shell/ClientContext.tsx';
import { useData } from '../../data/useData.ts';
import type {
  AuditRow,
  ConnectionsCatalog,
  Contact,
} from '../../data/types.ts';
import {
  Card,
  EmptyState,
  Skeleton,
  StatusPill,
  Avatar,
  GateReason,
  Button,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from '../../components/index.ts';
import KillSwitchCard from './KillSwitchCard.tsx';
import styles from './TrustScreen.module.css';

// Audit actions whose `reason` is a governance gate decision (route through
// GateReason for the plain-English sentence + tone dot). Everything else is a
// plain lifecycle event and shows humanized text.
const GATE_ACTIONS = new Set(['send.blocked', 'send.allow', 'route.human']);

function humanizeAction(action: string): string {
  const map: Record<string, string> = {
    'message.received': 'Message received',
    'draft.created': 'Draft created',
    'route.human': 'Routed to human',
    'send.blocked': 'Send blocked',
    'send.allow': 'Send allowed',
    'outcome.recorded': 'Outcome recorded',
    kill_switch: 'Kill switch',
  };
  if (map[action] !== undefined) return map[action];
  const spaced = action.replaceAll('.', ' ').replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function humanizeReason(reason: string): string {
  const spaced = reason.replaceAll('_', ' ').trim();
  if (spaced.length === 0) return '—';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date}, ${time}`;
}

// ── Opt-out ledger ───────────────────────────────────────────────
function OptOutLedger({
  loading,
  error,
  rows,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  rows: Contact[] | undefined;
  onRetry: () => void;
}) {
  return (
    <Card title="Opt-out ledger" padded={false}>
      <p className={styles.cardIntro}>
        These people asked us to stop. They will never be texted again — the gate blocks every send
        to them.
      </p>
      {loading ? (
        <div className={styles.pad}>
          <Skeleton width="100%" height={20} />
          <Skeleton width="100%" height={20} />
        </div>
      ) : error ? (
        <div className={styles.pad}>
          <EmptyState
            message="We couldn't load the opt-out ledger."
            action={
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Try again
              </Button>
            }
          />
        </div>
      ) : rows === undefined || rows.length === 0 ? (
        <div className={styles.pad}>
          <EmptyState message="No opt-outs recorded. Everyone in the book is still reachable within their consent scopes." />
        </div>
      ) : (
        <div className={styles.tableScroll}>
        <Table>
          <THead>
            <TR>
              <TH>Contact</TH>
              <TH>Phone</TH>
              <TH>Line of business</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD>
                  <span className={styles.contactCell}>
                    <Avatar name={c.display_name} size="sm" />
                    <span>{c.display_name}</span>
                  </span>
                </TD>
                <TD num>{c.e164}</TD>
                <TD>{c.lob ?? '—'}</TD>
                <TD>
                  <StatusPill tone="block">Opted out</StatusPill>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        </div>
      )}
    </Card>
  );
}

// ── Audit trail ──────────────────────────────────────────────────
function AuditTrail({
  loading,
  error,
  rows,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  rows: AuditRow[] | undefined;
  onRetry: () => void;
}) {
  return (
    <Card title="Audit trail" padded={false}>
      <p className={styles.cardIntro}>
        Entries are hash-chained — each row&rsquo;s digest folds in the one before it, so tampering
        is detectable.
      </p>
      {loading ? (
        <div className={styles.pad}>
          <Skeleton width="100%" height={20} />
          <Skeleton width="100%" height={20} />
          <Skeleton width="100%" height={20} />
        </div>
      ) : error ? (
        <div className={styles.pad}>
          <EmptyState
            message="We couldn't load the audit trail."
            action={
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Try again
              </Button>
            }
          />
        </div>
      ) : rows === undefined || rows.length === 0 ? (
        <div className={styles.pad}>
          <EmptyState message="No audit entries yet." />
        </div>
      ) : (
        <div className={styles.tableScroll}>
        <Table>
          <THead>
            <TR>
              <TH>Time</TH>
              <TH>Action</TH>
              <TH>Reason</TH>
              <TH>Digest</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.hash}>
                <TD num>{formatTime(r.time)}</TD>
                <TD>
                  <span className={styles.actionCell}>{humanizeAction(r.action)}</span>
                </TD>
                <TD>
                  {GATE_ACTIONS.has(r.action) ? (
                    <GateReason reason={r.reason} variant="row" />
                  ) : (
                    <span className={styles.plainReason}>{humanizeReason(r.reason)}</span>
                  )}
                </TD>
                <TD>
                  <code className={styles.hash}>{r.hash}</code>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        </div>
      )}
    </Card>
  );
}

// ── Data & compliance ────────────────────────────────────────────
const COMPLIANCE: { term: string; detail: string }[] = [
  {
    term: 'Quiet hours honored',
    detail: 'We only send 8:00 AM–9:00 PM in each recipient’s local time.',
  },
  {
    term: 'Consent enforced per message',
    detail: 'Transactional and marketing scopes are gated separately on every send.',
  },
  {
    term: 'Human takeover is always available',
    detail: 'An owner can seize any thread and the agent stands down immediately.',
  },
];

function DataCompliance() {
  return (
    <Card title="Data & compliance">
      <dl className={styles.compliance}>
        {COMPLIANCE.map((item) => (
          <div key={item.term} className={styles.complianceItem}>
            <dt className={styles.complianceTerm}>{item.term}</dt>
            <dd className={styles.complianceDetail}>{item.detail}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

// ── Connections marketplace (r13) ────────────────────────────────────────────
// Two groups in one section: "Connected" (the wires already wired — the existing
// idiom: status dot, name, detail, what it powers) and "Available" (the native
// surfaces the business can request). Each available row has a ghost Request
// button → an optimistic quiet "Requested — wired during onboarding" state. The
// Custom row opens a one-line note input first. No fake OAuth ceremony — honest
// FDE framing: requests are recorded and wired during onboarding.

// One available-integration row. `custom` opens a note input before requesting.
function AvailableRow({
  item,
  onRequest,
}: {
  item: ConnectionsCatalog['available'][number];
  onRequest: (key: string, note?: string) => void;
}) {
  const isCustom = item.key === 'custom';
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  if (item.requested) {
    return (
      <div className={`${styles.availRow} ${styles.availRequested}`}>
        <div className={styles.availText}>
          <span className={styles.availName}>{item.name}</span>
          <span className={styles.availBlurb}>{item.blurb}</span>
        </div>
        <span className={styles.requestedTag}>Requested — wired during onboarding</span>
      </div>
    );
  }

  return (
    <div className={styles.availRow}>
      <div className={styles.availText}>
        <span className={styles.availName}>{item.name}</span>
        <span className={styles.availBlurb}>{item.blurb}</span>
      </div>
      {isCustom && noteOpen ? (
        <div className={styles.noteRow}>
          <input
            className={styles.noteInput}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What would you like to connect?"
            autoFocus
            aria-label="Describe the connection you want"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRequest(item.key, note.trim() || undefined);
              if (e.key === 'Escape') setNoteOpen(false);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onRequest(item.key, note.trim() || undefined)}
          >
            Request
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (isCustom ? setNoteOpen(true) : onRequest(item.key))}
        >
          Request
        </Button>
      )}
    </div>
  );
}

function Connections({
  loading,
  error,
  catalog,
  onRetry,
  onRequest,
}: {
  loading: boolean;
  error: boolean;
  catalog: ConnectionsCatalog | undefined;
  onRetry: () => void;
  onRequest: (key: string, note?: string) => void;
}) {
  return (
    <Card title="Connections" padded={false}>
      {loading ? (
        <div className={styles.connGrid}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.connRow}>
              <Skeleton width="60%" height={14} />
              <Skeleton width="90%" height={12} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className={styles.pad}>
          <EmptyState
            message="We couldn't load your connections."
            action={
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Try again
              </Button>
            }
          />
        </div>
      ) : catalog === undefined || catalog.connected.length === 0 ? (
        <div className={styles.pad}>
          <EmptyState message="No connections wired yet." />
        </div>
      ) : (
        <>
          <div className={styles.groupLabelRow}>
            <span className={styles.groupLabel}>Connected</span>
          </div>
          <div className={styles.connGrid}>
            {catalog.connected.map((c) => {
              const connected = c.status === 'connected';
              return (
                <div key={c.key} className={styles.connRow}>
                  <div className={styles.connHead}>
                    <span className={styles.connTitle}>{c.name}</span>
                    <span
                      className={connected ? styles.connStatus : styles.connStatusAction}
                    >
                      <span className={connected ? styles.connDot : styles.connDotAction} />
                      {connected ? 'Connected' : 'Action needed'}
                    </span>
                  </div>
                  <p className={styles.connDetail}>{c.detail}</p>
                  <p className={styles.connPowers}>{c.powers}</p>
                </div>
              );
            })}
          </div>

          {catalog.available.length > 0 && (
            <>
              <div className={styles.groupLabelRow}>
                <span className={styles.groupLabel}>Available</span>
                <span className={styles.groupHint}>Request one and we wire it during onboarding.</span>
              </div>
              <div className={styles.availGrid}>
                {catalog.available.map((a) => (
                  <AvailableRow key={a.key} item={a} onRequest={onRequest} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}

export default function TrustScreen() {
  const client = useClient();
  const optOuts = useData(() => client.optOuts(), [client]);
  const audit = useData(() => client.auditSample(), [client]);
  const catalog = useData(() => client.connectionsCatalog(), [client]);

  // Optimistic request: swap the row to its "Requested" state immediately, then
  // persist. A refetch confirms the state survives (and reloads honestly).
  const [pending, setPending] = useState<Set<string>>(new Set());
  const onRequest = (key: string, note?: string) => {
    setPending((prev) => new Set(prev).add(key));
    void client.requestConnection(key, note).then(() => catalog.refetch());
  };

  // Fold the optimistic pending set into the catalog so a just-clicked row reads
  // "Requested" before the refetch lands.
  const catalogData =
    catalog.data === undefined
      ? undefined
      : {
          ...catalog.data,
          available: catalog.data.available.map((a) =>
            pending.has(a.key) ? { ...a, requested: true } : a,
          ),
        };

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.sub}>Your connections, the safety controls, and the compliance record.</p>
      </header>

      {/* (1) Compact safety strip — the kill switch, no big card frame. */}
      <KillSwitchCard compact />

      {/* (2) Connections marketplace — the dominant section. */}
      <Connections
        loading={catalog.loading}
        error={catalog.error !== undefined}
        catalog={catalogData}
        onRetry={catalog.refetch}
        onRequest={onRequest}
      />

      {/* (3) Ledgers — opt-out, audit, compliance. */}
      <OptOutLedger
        loading={optOuts.loading}
        error={optOuts.error !== undefined}
        rows={optOuts.data}
        onRetry={optOuts.refetch}
      />

      <AuditTrail
        loading={audit.loading}
        error={audit.error !== undefined}
        rows={audit.data}
        onRetry={audit.refetch}
      />

      <DataCompliance />
    </div>
  );
}
