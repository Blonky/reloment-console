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
        {/* The hero answers THE question: what did the agent bring back? A
            Fraunces headline with the figure inline, then one honesty sub. */}
        {pulse === undefined ? (
          <Skeleton width={280} height={44} />
        ) : (
          <h1 className={styles.heroHeadline}>
            Your agent recovered{' '}
            <span className={`${styles.heroFigure} tnum`}>{fullDollars(pulse.wonBackCents)}</span>{' '}
            this quarter
          </h1>
        )}
        <span className={styles.heroSub}>
          Only causally-attributed outcomes are counted — we count nothing we can&rsquo;t prove.
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
      {/* The causally-attributed honesty note lives once, on the hero figure
          (§6). Repeating it here and in the page sub was three copies of one
          claim — cut to a single instance. */}
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
    </Card>
  );
}

export default function InsightsScreen() {
  const client = useClient();
  const home = useData(() => client.home(), [client]);
  const outcomes = useData(() => client.outcomes(), [client]);

  return (
    <div className={styles.page}>
      {/* The hero headline IS the page head now — no separate "Insights" kicker
          (§4: delete chrome that repeats what the topbar already says).
          Top row: hero recovered headline card | chart card (≤240px tall). */}
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
