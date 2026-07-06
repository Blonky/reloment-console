// Reply cards — the structured replies the command channel renders in the
// transcript. Each is a governed tool's result given typographic dignity:
// tables, briefs, and — the point of the whole surface — the enroll card that
// narrates *exclusions* with the same weight as enrollments (DESIGN.md §5, §1).

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  GateReason,
  StatusPill,
  Avatar,
  EmptyState,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from '../../components/index.ts';
import type { StatusTone } from '../../components/index.ts';
import type {
  BookRow,
  CampaignRow,
  EnrollResult,
  SearchHit,
  ThreadBrief,
} from '../../data/types.ts';
import styles from './HomeScreen.module.css';
import {
  IconList,
  IconEnroll,
  IconCampaign,
  IconBrief,
  IconSearch,
  IconHelp,
} from './icons.tsx';
import { COMMAND_CATALOGUE } from './parseIntent.ts';

// ── Shared card shell ─────────────────────────────────────────────────────────
export function ReplyCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.reply}>
      <div className={styles.replyHead}>
        <span className={styles.replyHeadIcon}>{icon}</span>
        <span className={styles.replyTitle}>{title}</span>
      </div>
      <div className={styles.replyBody}>{children}</div>
    </div>
  );
}

function xDateLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  // iso is a YYYY-MM-DD date column; render compactly, deterministically.
  const [y, m, d] = iso.split('-').map((n) => Number(n));
  if (!y || !m || !d) return iso;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  new_lead: 'New lead',
  lapsed_quote: 'Lapsed quote',
};

function statusLabel(s: string | null | undefined): string {
  if (!s) return '—';
  return STATUS_LABEL[s] ?? s;
}

// ── Book table (renewals / lapsed) ────────────────────────────────────────────
export function BookCard({
  kind,
  rows,
}: {
  kind: 'renewals' | 'lapsed';
  rows: BookRow[];
}) {
  const title = kind === 'renewals' ? 'Renewals · next 30 days' : 'Lapsed quotes';
  const dateHead = kind === 'renewals' ? 'Renews' : 'Lapsed';
  return (
    <ReplyCard icon={<IconList />} title={title}>
      {rows.length === 0 ? (
        <EmptyState
          message={
            kind === 'renewals'
              ? 'No renewals fall in the next 30 days right now.'
              : 'No lapsed quotes past the win-back window right now.'
          }
        />
      ) : (
        <>
          <p className={styles.replyLede}>
            <span className={styles.replyLedeStrong}>{rows.length}</span>{' '}
            {rows.length === 1 ? 'contact' : 'contacts'} in the book.
          </p>
          <div className={styles.tableScroll}>
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Line</TH>
                  <TH>{dateHead}</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={`${r.display_name}-${r.x_date ?? ''}`}>
                    <TD>{r.display_name}</TD>
                    <TD>{r.lob ?? '—'}</TD>
                    <TD num>{xDateLabel(r.x_date)}</TD>
                    <TD>
                      {kind === 'lapsed' ? (
                        <StatusPill tone="hold">
                          {statusLabel(r.policy_status ?? 'lapsed_quote')}
                        </StatusPill>
                      ) : (
                        <StatusPill tone="ok">Renewing</StatusPill>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <p className={styles.followUp}>
            {kind === 'lapsed' ? (
              <>Say “enroll win-back” to start the governed campaign.</>
            ) : (
              <>Open the <Link to="/inbox">Inbox</Link> to review drafts as they land.</>
            )}
          </p>
        </>
      )}
    </ReplyCard>
  );
}

// ── Enroll result — the exclusion-narration card ──────────────────────────────
export function EnrollCard({ result }: { result: EnrollResult }) {
  const { enrolled, excluded, playbook } = result;
  const enrolledNames = enrolled.join(', ');
  return (
    <ReplyCard icon={<IconEnroll />} title={`Enrolled · ${playbook}`}>
      <p className={styles.replyLede}>
        {enrolled.length > 0 ? (
          <>
            <span className={styles.replyLedeStrong}>
              Enrolled {enrolled.length}
            </span>
            {' — '}
            {enrolledNames}.
          </>
        ) : (
          <span className={styles.replyLedeStrong}>
            No one was eligible to enroll.
          </span>
        )}
      </p>

      {enrolled.length > 0 && (
        <div className={styles.enrollGroup}>
          <span className={styles.enrollGroupLabel}>
            Enrolled{' '}
            <span className={styles.enrollGroupCount}>{enrolled.length}</span>
          </span>
          <div className={styles.enrollList}>
            {enrolled.map((name) => (
              <div className={styles.enrollItem} key={name}>
                <Avatar name={name} size="sm" />
                <span className={styles.enrollName}>{name}</span>
                <span className={styles.enrollReasonSpacer} />
                <StatusPill tone="ok">Draft queued</StatusPill>
              </div>
            ))}
          </div>
        </div>
      )}

      {excluded.length > 0 && (
        <div className={styles.enrollGroup}>
          <span className={styles.enrollGroupLabel}>
            Excluded{' '}
            <span className={styles.enrollGroupCount}>{excluded.length}</span>
            {' · governed by the send gate'}
          </span>
          <div className={styles.enrollList}>
            {excluded.map((ex) => (
              <div
                className={`${styles.enrollItem} ${styles.enrollItemExcluded}`}
                key={ex.name}
              >
                <Avatar name={ex.name} size="sm" />
                <span className={styles.enrollName}>{ex.name}</span>
                <span className={styles.enrollDash}>—</span>
                <span className={styles.enrollReasonSpacer}>
                  <GateReason reason={ex.reason} variant="row" />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {enrolled.length > 0 && (
        <p className={styles.followUp}>
          {enrolled.length} {enrolled.length === 1 ? 'draft is' : 'drafts are'}{' '}
          waiting in your <Link to="/inbox">Inbox</Link>.
        </p>
      )}
    </ReplyCard>
  );
}

// ── Campaign status table ─────────────────────────────────────────────────────
const CLS_TONE: Record<string, StatusTone> = {
  transactional: 'info',
  marketing: 'ok',
};

export function CampaignCard({ rows }: { rows: CampaignRow[] }) {
  const totalEnrolled = rows.reduce((s, r) => s + r.enrolled, 0);
  const totalPending = rows.reduce((s, r) => s + r.drafts_pending, 0);
  return (
    <ReplyCard icon={<IconCampaign />} title="Campaign status">
      <p className={styles.replyLede}>
        <span className={styles.replyLedeStrong}>{totalEnrolled}</span> enrolled
        across {rows.length} playbooks ·{' '}
        <span className={styles.replyLedeStrong}>{totalPending}</span> drafts
        awaiting your approval.
      </p>
      <div className={styles.tableScroll}>
        <Table>
          <THead>
            <TR>
              <TH>Playbook</TH>
              <TH>Class</TH>
              <TH>State</TH>
              <TH>Enrolled</TH>
              <TH>Drafts pending</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.key}>
                <TD>{r.name}</TD>
                <TD>
                  <StatusPill tone={CLS_TONE[r.classification] ?? 'neutral'}>
                    {r.classification === 'marketing' ? 'Marketing' : 'Transactional'}
                  </StatusPill>
                </TD>
                <TD>
                  <span className={styles.muted}>{r.status}</span>
                </TD>
                <TD num>{r.enrolled}</TD>
                <TD num>{r.drafts_pending}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      {totalPending > 0 && (
        <p className={styles.followUp}>
          Review the pending drafts in your <Link to="/inbox">Inbox</Link>.
        </p>
      )}
    </ReplyCard>
  );
}

// ── Thread brief ──────────────────────────────────────────────────────────────
function briefTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const now = new Date('2026-07-07T19:20:00.000Z').getTime(); // DEMO_NOW
  const mins = Math.round((now - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function BriefCard({ brief }: { brief: ThreadBrief }) {
  const { contact, memory, recent, conversationId } = brief;
  const inboxHref =
    conversationId !== null ? `/inbox?c=${encodeURIComponent(conversationId)}` : '/inbox';
  return (
    <ReplyCard icon={<IconBrief />} title="Contact brief">
      <div className={styles.briefTop}>
        <Avatar name={contact.display_name} size="lg" />
        <div className={styles.briefIdentity}>
          <span className={styles.briefName}>{contact.display_name}</span>
          <span className={styles.briefMeta}>
            {contact.lob ?? 'No line'} · {statusLabel(contact.policy_status)}
            {contact.x_date ? ` · ${xDateLabel(contact.x_date)}` : ''}
          </span>
        </div>
      </div>

      {memory.length > 0 && (
        <div className={styles.briefSection}>
          <span className={styles.briefSectionLabel}>What we remember</span>
          <ul className={styles.memoryList}>
            {memory.map((m, i) => (
              <li className={styles.memoryItem} key={i}>
                <span className={styles.memoryBullet} />
                {m.value}
              </li>
            ))}
          </ul>
        </div>
      )}

      {recent.length > 0 && (
        <div className={styles.briefSection}>
          <span className={styles.briefSectionLabel}>Last activity</span>
          {recent.slice(0, 2).map((r, i) => (
            <p className={styles.recentLine} key={i}>
              <b>{r.direction === 'inbound' ? 'They' : 'Us'}:</b> {r.body}{' '}
              <span className={styles.muted}>· {briefTimeAgo(r.created_at)}</span>
            </p>
          ))}
        </div>
      )}

      <p className={styles.followUp}>
        <Link to={inboxHref}>Open thread →</Link>
      </p>
    </ReplyCard>
  );
}

// ── Search hits ───────────────────────────────────────────────────────────────
export function SearchCard({ query, hits }: { query: string; hits: SearchHit[] }) {
  return (
    <ReplyCard icon={<IconSearch />} title={`Search · “${query}”`}>
      {hits.length === 0 ? (
        <EmptyState message={`Nothing in the book mentions “${query}” yet.`} />
      ) : (
        <>
          <p className={styles.replyLede}>
            <span className={styles.replyLedeStrong}>{hits.length}</span>{' '}
            {hits.length === 1 ? 'match' : 'matches'} across conversations and memory.
          </p>
          <div className={styles.hitList}>
            {hits.map((h, i) => (
              <Link
                to={`/inbox?q=${encodeURIComponent(query)}`}
                className={styles.hit}
                key={i}
              >
                <span className={styles.hitTop}>
                  <Avatar name={h.display_name} size="sm" />
                  <span className={styles.hitName}>{h.display_name}</span>
                  <StatusPill tone={h.kind === 'memory' ? 'neutral' : 'info'}>
                    {h.kind === 'memory' ? 'Memory' : 'Message'}
                  </StatusPill>
                </span>
                <span className={styles.hitBody}>
                  {h.kind === 'memory' ? h.value : h.body}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </ReplyCard>
  );
}

// ── Help card (honest capabilities) ───────────────────────────────────────────
export function HelpCard({ onRun }: { onRun: (text: string) => void }) {
  return (
    <ReplyCard icon={<IconHelp />} title="What I can do">
      <p className={styles.replyLede}>
        I route a fixed set of commands today. The language-model planner ships
        with the platform connection — until then, these are exact and governed.
      </p>
      <div className={styles.helpList}>
        {COMMAND_CATALOGUE.map((c) => (
          <div className={styles.helpItem} key={c.label}>
            <button
              type="button"
              className={styles.chip}
              onClick={() => onRun(c.example)}
            >
              {c.example}
            </button>
            <span className={styles.helpBlurb}>{c.blurb}</span>
          </div>
        ))}
      </div>
    </ReplyCard>
  );
}
