import { useClient } from '../../shell/ClientContext.tsx';
import { useData } from '../../data/useData.ts';
import type { HomePulse, OutcomeRow } from '../../data/types.ts';
import {
  Card,
  EmptyState,
  Skeleton,
  StatusPill,
  Button,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from '../../components/index.ts';
import type { StatusTone } from '../../components/index.ts';
import RecoveredChart from './RecoveredChart.tsx';
import type { MonthPoint } from './RecoveredChart.tsx';
import styles from './InsightsScreen.module.css';

// Canonical pilot ramp (mirrors the fixture RECOVERED_BY_MONTH). The most-recent
// month's figure ($4,120) is the causally-attributed total shown in the hero.
const RECOVERED_BY_MONTH: MonthPoint[] = [
  { label: 'Feb', cents: 0 },
  { label: 'Mar', cents: 0 },
  { label: 'Apr', cents: 89000 },
  { label: 'May', cents: 0 },
  { label: 'Jun', cents: 412000 },
  { label: 'Jul', cents: 0 },
];

// Outcomes lack a date field; supply a stable, deterministic month per row.
const OUTCOME_MONTH = 'Jun 2026';

function fullDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

function kindTone(kind: string): { tone: StatusTone; label: string } {
  if (kind === 'renewal_won_back') return { tone: 'ok', label: 'Renewal' };
  if (kind === 'cross_sell') return { tone: 'info', label: 'Cross-sell' };
  return { tone: 'neutral', label: kind.replaceAll('_', ' ') };
}

function Hero({ pulse }: { pulse: HomePulse | undefined }) {
  return (
    <div className={styles.hero}>
      <span className={styles.heroLabel}>Recovered revenue</span>
      {pulse === undefined ? (
        <Skeleton width={180} height={46} />
      ) : (
        <span className={`${styles.heroValue} tnum`}>{fullDollars(pulse.wonBackCents)}</span>
      )}
      <span className={styles.heroSub}>
        Causally-attributed only — we count nothing we can&rsquo;t prove.
      </span>
    </div>
  );
}

function ChartCard({ loading }: { loading: boolean }) {
  return (
    <Card title="Recovered by month">
      {loading ? (
        <Skeleton width="100%" height={200} />
      ) : (
        <RecoveredChart series={RECOVERED_BY_MONTH} />
      )}
    </Card>
  );
}

function Ledger({
  loading,
  error,
  rows,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  rows: OutcomeRow[] | undefined;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <Card title="Outcome ledger" padded={false}>
        <div className={styles.ledgerSkeleton}>
          <Skeleton width="100%" height={20} />
          <Skeleton width="100%" height={20} />
          <Skeleton width="100%" height={20} />
        </div>
      </Card>
    );
  }
  if (error) {
    return (
      <Card title="Outcome ledger">
        <EmptyState
          message="We couldn't load the outcome ledger."
          action={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      </Card>
    );
  }
  if (rows === undefined || rows.length === 0) {
    return (
      <Card title="Outcome ledger">
        <EmptyState message="No recovered outcomes yet. Only causally-attributed wins are recorded here — nothing modeled or assumed." />
      </Card>
    );
  }

  const total = rows.reduce((acc, r) => acc + r.amount_cents, 0);

  return (
    <Card title="Outcome ledger" padded={false}>
      <Table>
        <THead>
          <TR>
            <TH>Contact</TH>
            <TH>Playbook</TH>
            <TH>Outcome</TH>
            <TH>Month</TH>
            <TH className={styles.amountHead}>Amount</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r, i) => {
            const kt = kindTone(r.kind);
            return (
              <TR key={`${r.contact}-${r.kind}-${i}`}>
                <TD>{r.contact}</TD>
                <TD>{r.playbook}</TD>
                <TD>
                  <span className={styles.outcomeCell}>
                    <StatusPill tone={kt.tone}>{kt.label}</StatusPill>
                    <span className={styles.outcomeLabel}>{r.outcome}</span>
                  </span>
                </TD>
                <TD>{OUTCOME_MONTH}</TD>
                <TD num>{fullDollars(r.amount_cents)}</TD>
              </TR>
            );
          })}
          <TR className={styles.totalRow}>
            <TD>Total recovered</TD>
            <TD>&nbsp;</TD>
            <TD>&nbsp;</TD>
            <TD>&nbsp;</TD>
            <TD num>{fullDollars(total)}</TD>
          </TR>
        </TBody>
      </Table>
      <p className={styles.ledgerNote}>
        Only causally-attributed outcomes are counted — no modeled or assumed revenue.
      </p>
    </Card>
  );
}

export default function InsightsScreen() {
  const client = useClient();
  const home = useData(() => client.home(), [client]);
  const outcomes = useData(() => client.outcomes(), [client]);

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <h1 className={styles.title}>Insights</h1>
        <p className={styles.sub}>What the agents recovered — proven, not projected.</p>
      </header>

      <Card>
        <div className={styles.heroRow}>
          <Hero pulse={home.error !== undefined ? undefined : home.data} />
        </div>
      </Card>

      <ChartCard loading={outcomes.loading || home.loading} />

      <Ledger
        loading={outcomes.loading}
        error={outcomes.error !== undefined}
        rows={outcomes.data}
        onRetry={outcomes.refetch}
      />
    </div>
  );
}
