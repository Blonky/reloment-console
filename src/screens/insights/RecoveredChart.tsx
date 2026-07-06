import styles from './RecoveredChart.module.css';

export interface MonthPoint {
  label: string;
  cents: number;
}

export interface RecoveredChartProps {
  series: MonthPoint[];
}

function shortDollars(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString('en-US')}`;
}

// Geometry in viewBox units. Bars derive their heights proportionally from cents.
const VB_W = 560;
const VB_H = 220;
const PAD_L = 8;
const PAD_R = 8;
const BASELINE_Y = 176; // y of the axis; area above holds the bars
const LABEL_Y = 196; // month labels beneath the baseline
const PLOT_TOP = 24; // reserve headroom for the value labels above bars
const MAX_BAR_H = BASELINE_Y - PLOT_TOP;
const BAR_W = 34;

export default function RecoveredChart({ series }: RecoveredChartProps) {
  const max = Math.max(...series.map((p) => p.cents), 1);
  const innerW = VB_W - PAD_L - PAD_R;
  const step = innerW / series.length;

  return (
    <svg
      className={styles.svg}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      role="img"
      aria-label="Recovered revenue by month"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* baseline / axis */}
      <line
        x1={PAD_L}
        y1={BASELINE_Y}
        x2={VB_W - PAD_R}
        y2={BASELINE_Y}
        stroke="var(--line)"
        strokeWidth={1}
      />

      {series.map((p, i) => {
        const cx = PAD_L + step * i + step / 2;
        const x = cx - BAR_W / 2;
        const isZero = p.cents === 0;
        // honest: zero months render as a near-zero tick, not a fake bar
        const h = isZero ? 0 : Math.max(4, (p.cents / max) * MAX_BAR_H);
        const y = BASELINE_Y - h;

        return (
          <g key={p.label}>
            {isZero ? (
              // small tick on the baseline for a zero month
              <line
                x1={cx - 5}
                y1={BASELINE_Y}
                x2={cx + 5}
                y2={BASELINE_Y}
                stroke="var(--ink-2)"
                strokeWidth={2}
                opacity={0.35}
              />
            ) : (
              <>
                <rect
                  x={x}
                  y={y}
                  width={BAR_W}
                  height={h}
                  rx={3}
                  fill="var(--accent)"
                />
                <text
                  x={cx}
                  y={y - 7}
                  textAnchor="middle"
                  className={styles.valueLabel}
                >
                  {shortDollars(p.cents)}
                </text>
              </>
            )}
            <text x={cx} y={LABEL_Y} textAnchor="middle" className={styles.monthLabel}>
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
