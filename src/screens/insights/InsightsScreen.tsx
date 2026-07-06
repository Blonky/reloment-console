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

// The chart is DERIVED from the outcome ledger (single source of truth): the
// last six months ending at the client clock's month, each bar the sum of that
// month's attributed outcomes. It can never disagree with the hero or ledger.
function deriveSeries(rows: OutcomeRow[], now: number): MonthPoint[] {
  const byMonth = new Map<string, number>();
  for (const r of rows) byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.amount_cents);
  const points: MonthPoint[] = [];
  for (let back = 5; back >= 0; back -= 1) {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - back);
    const iso = d.toISOString().slice(0, 7);
    points.push({
      label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
      cents: byMonth.get(iso) ?? 0,
    });
  }
  return points;
}

function monthLabel(iso: string): string {
  const d = new Date(`${iso}-15T00:00:00Z`);
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function fullDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

function kindTone(kind: string): { tone: StatusTone; label: string } {
  if (kind === 'renewal_won_back') return { tone: 'ok', label: 'Renewal' };
  if (kind === 'cross_sell') return { tone: 'info', label: 'Cross-sell' };
  return { tone: 'neutral', label: kind.replaceAll('_', ' ') };
}

function HeroCard({ pulse }: { pulse: HomePulse | undefined }) {
  return (
    <Card className={styles.heroCard}>
      <div className={styles.hero}>
        <span className={styles.heroLabel}>Recovered revenue</span>
        {pulse === undefined ? (
          <Skeleton width={160} height={44} />
        ) : (
          <span className={`${styles.heroValue} tnum`}>{fullDollars(pulse.wonBackCents)}</span>
        )}
        <span className={styles.heroSub}>
          Causally-attributed only — we count nothing we can&rsquo;t prove.
        </span>
      </div>
    </Card>
  );
}

function ChartCard({ loading, series }: { loading: boolean; series: MonthPoint[] }) {
  return (
    <Card title="Recovered by month" className={styles.chartCard}>
      {loading ? (
        <Skeleton width="100%" height={200} />
      ) : (
        <div className={styles.chartWrap}>
          <RecoveredChart series={series} />
        </div>
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
    <Card title="Outcome ledger" padded={false} className={styles.ledgerCard}>
      <div className={styles.ledgerScroll}>
      <div className={styles.tableScroll}>
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
                <TD>{monthLabel(r.month)}</TD>
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
      </div>
      </div>
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

      {/* Top row: hero recovered card (1fr) | chart card (2fr, ≤240px tall). */}
      <div className={styles.topGrid}>
        <HeroCard pulse={home.error !== undefined ? undefined : home.data} />
        <ChartCard
          loading={outcomes.loading || home.loading}
          series={deriveSeries(outcomes.data ?? [], client.now())}
        />
      </div>

      {/* Ledger fills the rest and scrolls internally if it must. */}
      <Ledger
        loading={outcomes.loading}
        error={outcomes.error !== undefined}
        rows={outcomes.data}
        onRetry={outcomes.refetch}
      />
    </div>
  );
}
