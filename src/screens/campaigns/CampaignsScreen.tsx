import {
  Card,
  StatusPill,
  GateReason,
  EmptyState,
  Skeleton,
} from '../../components/index.ts';
import { useClient } from '../../shell/ClientContext.tsx';
import { useData } from '../../data/useData.ts';
import type { CampaignRow } from '../../data/types.ts';
import {
  metaFor,
  classificationTone,
  classificationLabel,
  type RunStats,
} from './playbooks.ts';
import styles from './CampaignsScreen.module.css';

export default function CampaignsScreen() {
  const client = useClient();
  const { data, loading, error } = useData(() => client.campaignStatus(), [client]);

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <h1 className={styles.pageTitle}>Campaigns</h1>
        <p className={styles.pageSub}>
          {data === undefined
            ? 'Playbook runs · exclusions shown in full'
            : `${data.length} ${data.length === 1 ? 'playbook' : 'playbooks'} · exclusions shown in full`}
        </p>
      </header>

      {loading ? (
        <PlaybookSkeletons />
      ) : error !== undefined ? (
        <Card>
          <EmptyState message="Couldn't load campaign status. The connection to the platform dropped — refresh to try again." />
        </Card>
      ) : data === undefined || data.length === 0 ? (
        <Card>
          <EmptyState message="No playbooks configured yet. Playbooks appear here once counsel signs off on the message and its audience." />
        </Card>
      ) : (
        <div className={styles.grid}>
          {data.map((row) => (
            <PlaybookCard key={row.key} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlaybookCard({ row }: { row: CampaignRow }) {
  const meta = metaFor(row.key);
  const stats = resolveStats(row, meta.stats);

  // Split the template around {first_name} so the token can be styled as a
  // placeholder without any dangerouslySetInnerHTML.
  const parts = meta.template.split('{first_name}');

  return (
    <Card padded={false} className={styles.card}>
      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <div className={styles.headText}>
            <h2 className={styles.name}>{row.name}</h2>
            {meta.counselSigned && (
              <span className={styles.counsel}>
                <CheckIcon />
                Counsel-signed
              </span>
            )}
          </div>
          <StatusPill tone={classificationTone(row.classification)}>
            {classificationLabel(row.classification)}
          </StatusPill>
        </div>

        <div className={styles.well}>
          {parts.map((part, i) => (
            <span key={i}>
              {part}
              {i < parts.length - 1 && <span className={styles.token}>{'{first_name}'}</span>}
            </span>
          ))}
        </div>

        <div className={styles.figures}>
          <Figure label="Enrolled" value={stats.enrolled} />
          <Figure label="Excluded" value={stats.excluded} tone="excluded" />
          <Figure label="Sent" value={stats.sent} />
          <Figure label="Replied" value={stats.replied} />
        </div>

        <div className={styles.exclusions}>
          {meta.exclusions.length === 0 ? (
            <p className={styles.cleared}>
              No one excluded — every enrolled contact cleared the gate.
            </p>
          ) : (
            <ul className={styles.exclusionList}>
              {meta.exclusions.map((ex) => (
                <li key={ex.name} className={styles.exclusionRow}>
                  <span className={styles.exclusionName}>{ex.name}</span>
                  <GateReason reason={ex.reason} variant="row" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'excluded';
}) {
  const valueClass =
    tone === 'excluded' && value > 0
      ? `${styles.figureValue} ${styles.figureValueExcluded}`
      : styles.figureValue;
  return (
    <div className={styles.figure}>
      <span className={styles.figureLabel}>{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

// Fold in a nonzero live enrolled count from the route while keeping figures
// coherent: sent ≤ enrolled, replied ≤ sent.
function resolveStats(row: CampaignRow, base: RunStats): RunStats {
  if (row.enrolled <= 0) return base;
  const enrolled = Math.max(base.enrolled, row.enrolled);
  const sent = Math.min(base.sent, enrolled);
  const replied = Math.min(base.replied, sent);
  return { enrolled, excluded: base.excluded, sent, replied };
}

function PlaybookSkeletons() {
  return (
    <div className={styles.grid}>
      {Array.from({ length: 3 }, (_, i) => (
        <Card key={i} padded={false} className={styles.card}>
          <div className={styles.cardBody}>
            <div className={styles.cardHead}>
              <Skeleton width={180} height={18} />
              <Skeleton width={96} height={22} radius="999px" />
            </div>
            <Skeleton width="100%" height={62} />
            <div className={styles.figures}>
              {Array.from({ length: 4 }, (_, j) => (
                <div key={j} className={styles.figure}>
                  <Skeleton width={56} height={11} />
                  <Skeleton width={36} height={26} />
                </div>
              ))}
            </div>
            <Skeleton width="70%" height={13} />
          </div>
        </Card>
      ))}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="var(--ok)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
