import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useClient } from '../../shell/ClientContext.tsx';
import { useData } from '../../data/useData.ts';
import type { HomePulse, InsightsReport, OutcomeRow } from '../../data/types.ts';
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

// ── PROOF ──────────────────────────────────────────────────────────────────
// The hero answers THE question — what did the agent bring back? — with the
// honesty sub. It IS the screen's headline (no separate "Insights" kicker).
function Hero({ pulse }: { pulse: HomePulse | undefined }) {
  return (
    <div className={styles.hero}>
      {pulse === undefined ? (
        <Skeleton width={280} height={40} />
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
  );
}

function ChartCard({ loading, series }: { loading: boolean; series: MonthPoint[] }) {
  return (
    <Card title="Recovered by month" className={styles.chartCard}>
      {loading ? (
        <Skeleton width="100%" height={180} />
      ) : (
        <div className={styles.chartWrap}>
          <RecoveredChart series={series} />
        </div>
      )}
    </Card>
  );
}

// The receipt: the outcome ledger, compacted to a slim quiet table. It stays as
// the flex/scroll region — if anything must give to hold one viewport, it's this.
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
      <div className={styles.ledger}>
        <div className={styles.ledgerSkeleton}>
          <Skeleton width="100%" height={18} />
          <Skeleton width="100%" height={18} />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className={styles.ledger}>
        <EmptyState
          message="We couldn't load the outcome ledger."
          action={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }
  if (rows === undefined || rows.length === 0) {
    return (
      <div className={styles.ledger}>
        <EmptyState message="No recovered outcomes yet. Only causally-attributed wins are recorded here — nothing modeled or assumed." />
      </div>
    );
  }

  const total = rows.reduce((acc, r) => acc + r.amount_cents, 0);

  return (
    <div className={styles.ledger}>
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
    </div>
  );
}

// ── WORK ─────────────────────────────────────────────────────────────────────
// A horizontal band of stat items, counted from the audit record. Fraunces tnum
// numbers, quiet labels. One caption under. No cards-in-cards — one hairline band.
function WorkBand({ report }: { report: InsightsReport | undefined }) {
  const a = report?.activity;
  // Median first reply is omitted entirely when null (no inbound→outbound pairs).
  const stats: { label: string; value: string }[] = [
    { label: 'Conversations handled', value: a ? String(a.conversations) : '—' },
    { label: 'Sent', value: a ? String(a.sent) : '—' },
    { label: 'Held for your review', value: a ? String(a.heldForReview) : '—' },
    { label: 'Blocked by the gate', value: a ? String(a.blockedByGate) : '—' },
    { label: 'Missed calls answered', value: a ? String(a.missedCallsAnswered) : '—' },
  ];
  if (a && a.medianFirstReplyMin !== null) {
    stats.push({ label: 'Median first reply', value: `${a.medianFirstReplyMin}m` });
  }

  return (
    <section className={styles.work} aria-label="What the agent did">
      <span className={styles.microLabel}>What it did</span>
      <div className={styles.workBand} aria-live="polite">
        {stats.map((s) => (
          <div key={s.label} className={styles.stat}>
            <span className={`${styles.statValue} tnum`}>{s.value}</span>
            <span className={styles.statLabel}>{s.label}</span>
          </div>
        ))}
      </div>
      <span className={styles.workCaption}>
        Counted from the audit record — the same log the Settings ledger shows.
      </span>
    </section>
  );
}

// ── PIPELINE ─────────────────────────────────────────────────────────────────
// Three quiet columns (the Home briefing band idiom): what the agent is setting
// up next. Each name links to their thread/contact; empty column → one quiet line.
function PipelineColumn({
  label,
  rows,
  more,
}: {
  label: string;
  rows: { name: string; detail: string; href: string }[];
  more: number;
}) {
  return (
    <section className={styles.pipeCol}>
      <span className={styles.pipeLabel}>{label}</span>
      {rows.length === 0 ? (
        <p className={styles.pipeEmpty}>None right now.</p>
      ) : (
        <ul className={styles.pipeList}>
          {rows.map((r) => (
            <li key={r.name} className={styles.pipeItem}>
              <Link to={r.href} className={styles.pipeName}>
                {r.name}
              </Link>
              <span className={styles.pipeDetail}>{r.detail}</span>
            </li>
          ))}
          {more > 0 && (
            <li className={styles.pipeMore}>
              <span className="tnum">+{more}</span> more
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function Pipeline({ report }: { report: InsightsReport | undefined }) {
  const p = report?.pipeline;
  const renewals = (p?.renewals30d ?? []).map((r) => ({
    name: r.name,
    detail: `in ${r.days} day${r.days === 1 ? '' : 's'}`,
    href: r.href,
  }));
  const reactivation = (p?.reactivation ?? []).map((r) => ({
    name: r.name,
    detail: r.reason,
    href: r.href,
  }));
  const bundle = (p?.bundle ?? []).map((r) => ({
    name: r.name,
    detail: r.reason,
    href: r.href,
  }));

  return (
    <section className={styles.pipeline} aria-label="What the agent is setting up">
      <span className={styles.microLabel}>What it&rsquo;s setting up</span>
      <div className={styles.pipeGrid}>
        <PipelineColumn
          label="Renewals · next 30 days"
          rows={renewals}
          more={p?.more.renewals30d ?? 0}
        />
        <PipelineColumn
          label="Reactivation candidates"
          rows={reactivation}
          more={p?.more.reactivation ?? 0}
        />
        <PipelineColumn label="Bundle candidates" rows={bundle} more={p?.more.bundle ?? 0} />
      </div>
    </section>
  );
}

export default function InsightsScreen() {
  const client = useClient();
  const home = useData(() => client.home(), [client]);
  const outcomes = useData(() => client.outcomes(), [client]);
  const report = useData(() => client.insightsReport(), [client]);

  // Wire the WORK band live like Home's briefing: any feed event (a simulated
  // missed call, an approve, an opt-out) refetches the report so the stats tick
  // live — missedCallsAnswered goes 0→1 the moment the topbar fires a missed call.
  const refetchReport = report.refetch;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = client.subscribe(() => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refetchReport();
      }, 400);
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [client, refetchReport]);

  return (
    <div className={styles.page}>
      {/* PROOF — hero headline + honesty sub on the left, chart on the right. The
          hero IS the page head; no separate kicker (§4). */}
      <div className={styles.proof}>
        <Hero pulse={home.error !== undefined ? undefined : home.data} />
        <ChartCard
          loading={outcomes.loading || home.loading}
          series={deriveSeries(outcomes.data ?? [], client.now())}
        />
      </div>

      {/* The receipt — compacted outcome ledger, the flex/scroll region. */}
      <Ledger
        loading={outcomes.loading}
        error={outcomes.error !== undefined}
        rows={outcomes.data}
        onRetry={outcomes.refetch}
      />

      {/* WORK — what it did, counted from the audit record. */}
      <WorkBand report={report.data} />

      {/* PIPELINE — what it's setting up next, three quiet columns. */}
      <Pipeline report={report.data} />
    </div>
  );
}
