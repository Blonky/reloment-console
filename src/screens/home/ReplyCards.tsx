// Reply cards — the structured replies the command channel renders in the
// transcript (DESIGN.md §5, "Artifacts, not dumps (v3)").
//
// Every tool reply is at most three things: (1) one narration sentence, (2) a
// GATE DISCLOSURE (quiet collapsed row of the deterministic checks that ran),
// and (3) an ARTIFACT CARD — a compact icon/title/count/summary tile that opens
// the shared Inspector with the full table/detail. Full tables NEVER render
// inline in the transcript. The ENROLL reply is the deliberate exception: its
// enrolled/excluded GateReason rows stay inline (the exclusions ARE the product
// moment) but compact and capped, with the full run in the Inspector.

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
  CallListRow,
  CampaignRow,
  EnrollResult,
  ResearchReport,
  ResearchStep,
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
  IconPhone,
  IconMissedCall,
  IconNavigate,
  IconCheck,
} from './icons.tsx';
import { COMMAND_CATALOGUE } from './parseIntent.ts';
import ArtifactCard from './ArtifactCard.tsx';
import GateDisclosure from './GateDisclosure.tsx';
import type { GateDisclosure as Disclosure } from './gateChecks.ts';

// Shared per-reply meta: the gate disclosure inputs. Every reply card takes it.
export interface ReplyMeta {
  disclosure: Disclosure;
  durationMs: number;
}

// ── Reply shell — narration sentence + gate disclosure + body ─────────────────
// The body is either an artifact card or (enroll) compact inline rows. No shared
// bordered card chrome: the artifact card is the visible object.
function ReplyShell({
  narration,
  meta,
  children,
}: {
  narration: ReactNode;
  meta: ReplyMeta;
  children: ReactNode;
}) {
  return (
    <div className={styles.reply}>
      <p className={styles.narration}>{narration}</p>
      <GateDisclosure disclosure={meta.disclosure} durationMs={meta.durationMs} />
      {children}
    </div>
  );
}

function xDateLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
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

// ── Book table (renewals / lapsed) → artifact + Inspector table ───────────────
export function BookCard({
  kind,
  rows,
  meta,
}: {
  kind: 'renewals' | 'lapsed';
  rows: BookRow[];
  meta: ReplyMeta;
}) {
  const title = kind === 'renewals' ? 'Renewals · next 30 days' : 'Lapsed quotes';
  const dateHead = kind === 'renewals' ? 'Renews' : 'Lapsed';
  const n = rows.length;
  const countLabel = `${n} ${n === 1 ? 'contact' : 'contacts'}`;

  if (n === 0) {
    return (
      <ReplyShell
        narration={
          kind === 'renewals'
            ? 'No renewals fall in the next 30 days right now.'
            : 'No lapsed quotes past the win-back window right now.'
        }
        meta={meta}
      >
        <EmptyState
          message={
            kind === 'renewals'
              ? 'The book has no renewals inside the 30-day window.'
              : 'Nothing has lapsed past the win-back window.'
          }
        />
      </ReplyShell>
    );
  }

  const verb = n === 1 ? 'comes' : 'come';
  const narration =
    kind === 'renewals'
      ? `${countLabel} ${verb} up for renewal in the next 30 days.`
      : `${countLabel} lapsed past the win-back window.`;
  const summary =
    kind === 'lapsed'
      ? 'Say “enroll win-back” to start the governed campaign.'
      : 'Drafts land in the Inbox as renewals approach.';

  return (
    <ReplyShell narration={narration} meta={meta}>
      <ArtifactCard
        icon={<IconList />}
        title={title}
        count={countLabel}
        summary={summary}
      >
        <div className={styles.inspTableScroll}>
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
        <p className={styles.inspFollowUp}>
          {kind === 'lapsed' ? (
            <>Say “enroll win-back” to start the governed campaign.</>
          ) : (
            <>Open the <Link to="/inbox">Inbox</Link> to review drafts as they land.</>
          )}
        </p>
      </ArtifactCard>
    </ReplyShell>
  );
}

// ── Enroll result — THE EXCEPTION: compact inline rows, full run in Inspector ──
const ENROLL_INLINE_CAP = 4;

export function EnrollCard({
  result,
  meta,
}: {
  result: EnrollResult;
  meta: ReplyMeta;
}) {
  const { enrolled, excluded, playbook } = result;

  // Build a unified, capped inline list — enrolled first, then excluded. The
  // exclusions carry the same visual dignity as the enrollments (the point).
  type Row =
    | { kind: 'enrolled'; name: string }
    | { kind: 'excluded'; name: string; reason: string };
  const rows: Row[] = [
    ...enrolled.map((name) => ({ kind: 'enrolled' as const, name })),
    ...excluded.map((ex) => ({
      kind: 'excluded' as const,
      name: ex.name,
      reason: ex.reason,
    })),
  ];
  const visible = rows.slice(0, ENROLL_INLINE_CAP);
  const hidden = rows.length - visible.length;

  const narration =
    enrolled.length > 0
      ? `Enrolled ${enrolled.length} and held ${excluded.length} back at the gate.`
      : `No one was eligible to enroll — ${excluded.length} held back at the gate.`;

  const renderRow = (r: Row) =>
    r.kind === 'enrolled' ? (
      <div className={styles.enrollItem} key={`e-${r.name}`}>
        <Avatar name={r.name} size="sm" />
        <span className={styles.enrollName}>{r.name}</span>
        <span className={styles.enrollReasonSpacer} />
        <StatusPill tone="ok">Draft queued</StatusPill>
      </div>
    ) : (
      <div
        className={`${styles.enrollItem} ${styles.enrollItemExcluded}`}
        key={`x-${r.name}`}
      >
        <Avatar name={r.name} size="sm" />
        <span className={styles.enrollName}>{r.name}</span>
        <span className={styles.enrollDash}>—</span>
        <span className={styles.enrollReasonSpacer}>
          <GateReason reason={r.reason} variant="row" />
        </span>
      </div>
    );

  return (
    <div className={styles.reply}>
      <p className={styles.narration}>{narration}</p>
      <GateDisclosure disclosure={meta.disclosure} durationMs={meta.durationMs} />

      <div className={styles.enrollInline}>
        <div className={styles.enrollList}>{visible.map(renderRow)}</div>
        {hidden > 0 && (
          <EnrollMore
            playbook={playbook}
            enrolled={enrolled}
            excluded={excluded}
            hidden={hidden}
          />
        )}
      </div>

      {enrolled.length > 0 && (
        <p className={styles.narrationFollow}>
          {enrolled.length} {enrolled.length === 1 ? 'draft is' : 'drafts are'}{' '}
          waiting in your <Link to="/inbox">Inbox</Link>.
        </p>
      )}
    </div>
  );
}

// The "+N more in the run" link — opens the full run in the Inspector.
function EnrollMore({
  playbook,
  enrolled,
  excluded,
  hidden,
}: {
  playbook: string;
  enrolled: string[];
  excluded: EnrollResult['excluded'];
  hidden: number;
}) {
  return (
    <ArtifactCard
      icon={<IconEnroll />}
      title={`Enroll run · ${playbook}`}
      count={`${enrolled.length + excluded.length} total`}
      summary={`${enrolled.length} enrolled · ${excluded.length} held back at the gate`}
      action="View full run"
      inspectorTitle={`Enroll run · ${playbook}`}
    >
      {enrolled.length > 0 && (
        <div className={styles.inspGroup}>
          <span className={styles.inspGroupLabel}>
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
        <div className={styles.inspGroup}>
          <span className={styles.inspGroupLabel}>
            Held back{' '}
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
      <p className={styles.inspFollowUp}>
        {hidden > 0 ? `Showing the full run of ${enrolled.length + excluded.length}.` : ''}
      </p>
    </ArtifactCard>
  );
}

// ── Campaign status → artifact + Inspector table ──────────────────────────────
const CLS_TONE: Record<string, StatusTone> = {
  transactional: 'info',
  marketing: 'ok',
};

export function CampaignCard({
  rows,
  meta,
}: {
  rows: CampaignRow[];
  meta: ReplyMeta;
}) {
  const totalEnrolled = rows.reduce((s, r) => s + r.enrolled, 0);
  const totalPending = rows.reduce((s, r) => s + r.drafts_pending, 0);
  const narration = `${totalEnrolled} enrolled across ${rows.length} playbooks · ${totalPending} drafts awaiting your approval.`;

  return (
    <ReplyShell narration={narration} meta={meta}>
      <ArtifactCard
        icon={<IconCampaign />}
        title="Campaign status"
        count={`${rows.length} ${rows.length === 1 ? 'playbook' : 'playbooks'}`}
        summary={`${totalPending} ${
          totalPending === 1 ? 'draft' : 'drafts'
        } awaiting your approval.`}
      >
        <div className={styles.inspTableScroll}>
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
          <p className={styles.inspFollowUp}>
            Review the pending drafts in your <Link to="/inbox">Inbox</Link>.
          </p>
        )}
      </ArtifactCard>
    </ReplyShell>
  );
}

// ── Thread brief → artifact + Inspector detail ────────────────────────────────
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

export function BriefCard({
  brief,
  meta,
}: {
  brief: ThreadBrief;
  meta: ReplyMeta;
}) {
  const { contact, memory, recent, conversationId } = brief;
  const inboxHref =
    conversationId !== null ? `/inbox?c=${encodeURIComponent(conversationId)}` : '/inbox';
  const metaLine = `${contact.lob ?? 'No line'} · ${statusLabel(contact.policy_status)}`;
  const narration = `Here’s the brief on ${contact.display_name.split(' ')[0]}.`;

  return (
    <ReplyShell narration={narration} meta={meta}>
      <ArtifactCard
        icon={<IconBrief />}
        title={contact.display_name}
        summary={metaLine}
        action="View brief"
        inspectorTitle="Contact brief"
      >
        <div className={styles.briefTop}>
          <Avatar name={contact.display_name} size="lg" />
          <div className={styles.briefIdentity}>
            <span className={styles.briefName}>{contact.display_name}</span>
            <span className={styles.briefMeta}>
              {metaLine}
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

        <p className={styles.inspFollowUp}>
          <Link to={inboxHref}>Open thread →</Link>
        </p>
      </ArtifactCard>
    </ReplyShell>
  );
}

// ── Search hits → artifact + Inspector list ───────────────────────────────────
export function SearchCard({
  query,
  hits,
  meta,
}: {
  query: string;
  hits: SearchHit[];
  meta: ReplyMeta;
}) {
  if (hits.length === 0) {
    return (
      <ReplyShell
        narration={`Nothing in the book mentions “${query}” yet.`}
        meta={meta}
      >
        <EmptyState message={`No conversations or memory mention “${query}”.`} />
      </ReplyShell>
    );
  }

  const n = hits.length;
  const narration = `${n} ${
    n === 1 ? 'match' : 'matches'
  } for “${query}” across conversations and memory.`;

  return (
    <ReplyShell narration={narration} meta={meta}>
      <ArtifactCard
        icon={<IconSearch />}
        title={`Search · “${query}”`}
        count={`${n} ${n === 1 ? 'hit' : 'hits'}`}
        summary="Conversations and memory atoms that mention the term."
        action="View hits"
        inspectorTitle={`Search · “${query}”`}
      >
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
      </ArtifactCard>
    </ReplyShell>
  );
}

// ── Call list → artifact + Inspector ranked table ─────────────────────────────
// The producer worklist. Contacts with no valid consent still appear, but their
// action pill is always "Call" (with a "no texting consent" caption) — texting
// an unconsented lead is exactly what the gate refuses; a phone call is fine.
export function CallListCard({
  rows,
  meta,
}: {
  rows: CallListRow[];
  meta: ReplyMeta;
}) {
  const n = rows.length;
  if (n === 0) {
    return (
      <ReplyShell narration="No one in the book needs a call today." meta={meta}>
        <EmptyState message="Nobody has a signal worth a call right now — the book is quiet." />
      </ReplyShell>
    );
  }

  const narration = `Ranked your book — ${n} ${
    n === 1 ? 'person' : 'people'
  } worth a call today.`;

  return (
    <ReplyShell narration={narration} meta={meta}>
      <ArtifactCard
        icon={<IconPhone />}
        title="Call list"
        count={`${n}`}
        summary="Who to call next — ranked over renewals, engagement, and gaps."
        action="View list"
        inspectorTitle={`Call list · ${n}`}
      >
        <div className={styles.inspTableScroll}>
          <Table>
            <THead>
              <TR>
                <TH>#</TH>
                <TH>Name</TH>
                <TH>Score</TH>
                <TH>Why</TH>
                <TH>Action</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r, i) => {
                const textable = r.suggestedAction === 'Text';
                return (
                  <TR key={r.contactId}>
                    <TD num>{i + 1}</TD>
                    <TD>
                      <span className={styles.callName}>{r.name}</span>
                      {r.lob !== null && (
                        <span className={styles.callLob}>{r.lob}</span>
                      )}
                    </TD>
                    <TD num>
                      <span className={styles.callScore}>{r.score}</span>
                    </TD>
                    <TD>
                      <span className={styles.callReasons}>
                        {r.reasons.map((reason, j) => (
                          <span className={styles.callReason} key={j}>
                            {reason}
                          </span>
                        ))}
                      </span>
                    </TD>
                    <TD>
                      <span className={styles.callActionCell}>
                        <StatusPill tone={textable ? 'ok' : 'neutral'}>
                          {textable ? 'Text first' : 'Call'}
                        </StatusPill>
                        {!textable && (
                          <span className={styles.callActionNote}>
                            no texting consent
                          </span>
                        )}
                      </span>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
        <p className={styles.inspFollowUp}>
          Unconsented leads never get a text suggestion — the gate refuses it, so
          a call is the honest next step.
        </p>
      </ArtifactCard>
    </ReplyShell>
  );
}

// ── Missed-call text-back — a control reply that narrates the auto-send ────────
// The command triggers simulateMissedCall(); the runtime auto-sends the
// acknowledgement inside the gate. The artifact links into the live thread so
// the operator can WATCH the missed-call entry → typing → auto-ack.
export function MissedCallReply({
  conversationId,
  meta,
}: {
  conversationId: string | null;
  meta: ReplyMeta;
}) {
  const href =
    conversationId !== null
      ? `/inbox?c=${encodeURIComponent(conversationId)}`
      : '/inbox';
  return (
    <ReplyShell
      narration="Missed call captured — the text-back playbook answered inside the gate."
      meta={meta}
    >
      <ArtifactCard
        icon={<IconMissedCall />}
        title="Missed-call text-back"
        summary="Auto-acknowledged on inquiry basis — still gated, opt-outs never texted."
        action="View conversation"
        inspectorTitle="Missed-call text-back"
      >
        <p className={styles.briefSummary}>
          A caller reached the messaging-only line and hung up. The voice-capture
          forward minted a conversation, recorded consent on inquiry basis, and
          the missed-call playbook auto-sent the acknowledgement — after clearing
          the send gate. Nothing goes out to a caller on the opt-out list.
        </p>
        <p className={styles.inspFollowUp}>
          <Link to={href}>Open the conversation →</Link>
        </p>
      </ArtifactCard>
    </ReplyShell>
  );
}

// ── Research / enrichment waterfall (r11) ─────────────────────────────────────
// One narration line + a WaterfallCard: the four steps as stacked rows (book,
// conversations, carrier, web). A hit shows a quiet check + its facts; a miss
// shows an em-dash "nothing new"; a needs_platform step shows a muted "runs on
// the platform connection" pill. The consentNote is the card's quiet footer.
// Unknown contact → an honest "not in the book" reply (no card).
const STEP_META: Record<
  ResearchStep['source'],
  { hitLabel: string; missLabel: string }
> = {
  book: { hitLabel: 'Book of record', missLabel: 'Book of record' },
  conversations: { hitLabel: 'Your conversations', missLabel: 'Your conversations' },
  carrier: { hitLabel: 'Carrier lookup', missLabel: 'Carrier lookup' },
  web: { hitLabel: 'Web research', missLabel: 'Web research' },
};

function WaterfallRow({ step }: { step: ResearchStep }) {
  const hitCount = step.status === 'hit' ? step.facts.length : 0;
  return (
    <div className={styles.wfRow}>
      <span
        className={`${styles.wfDot} ${
          step.status === 'hit'
            ? styles.wfDotHit
            : step.status === 'miss'
              ? styles.wfDotMiss
              : styles.wfDotPlatform
        }`}
        aria-hidden="true"
      >
        {step.status === 'hit' ? <IconCheck size={12} /> : null}
      </span>
      <div className={styles.wfMain}>
        <div className={styles.wfHead}>
          <span className={styles.wfLabel}>
            {step.status === 'needs_platform' || step.status === 'miss'
              ? step.label
              : STEP_META[step.source].hitLabel}
          </span>
          {step.status === 'hit' && (
            <span className={styles.wfCount}>
              {hitCount} {hitCount === 1 ? 'fact' : 'facts'}
            </span>
          )}
          {step.status === 'needs_platform' && (
            <span className={styles.wfPlatformPill}>runs on the platform connection</span>
          )}
        </div>
        {step.status === 'hit' && (
          <ul className={styles.wfFacts}>
            {step.facts.map((f, i) => (
              <li className={styles.wfFact} key={i}>
                {f}
              </li>
            ))}
          </ul>
        )}
        {step.status === 'miss' && (
          <span className={styles.wfMiss}>— nothing new</span>
        )}
      </div>
    </div>
  );
}

export function WaterfallCard({
  report,
  meta,
}: {
  report: ResearchReport;
  meta: ReplyMeta;
}) {
  const first = report.name.split(' ')[0];
  const hits = report.steps.filter((s) => s.status === 'hit').length;
  const total = report.steps.length;
  const narration = `Ran the enrichment waterfall for ${first} — ${hits} of ${total} sources hit.`;

  return (
    <ReplyShell narration={narration} meta={meta}>
      <div className={styles.waterfall}>
        <div className={styles.wfList}>
          {report.steps.map((s) => (
            <WaterfallRow step={s} key={s.source} />
          ))}
        </div>
        <p className={styles.wfConsent}>{report.consentNote}</p>
      </div>
    </ReplyShell>
  );
}

// Unknown-contact reply — honest, no card.
export function ResearchMissReply({
  name,
  meta,
}: {
  name: string;
  meta: ReplyMeta;
}) {
  return (
    <ReplyShell
      narration={`I don’t have anyone by “${name}” in the book.`}
      meta={meta}
    >
      <p className={styles.narrationFollow}>
        Try a name from your <Link to="/contacts">Contacts</Link>, or run a{' '}
        search instead.
      </p>
    </ReplyShell>
  );
}

// ── Navigation (r11) — "take me to…" ──────────────────────────────────────────
// A control reply: one narration line + the artifact-style destination link
// (so the transcript history keeps the destination), then the UI auto-navigates
// after a short beat (instant under reduced motion). No gate disclosure — a
// navigation is a pure UI move, not a send — so this reply is bespoke.
export function NavigateCard({
  label,
  href,
}: {
  label: string;
  href: string;
}) {
  return (
    <div className={styles.reply}>
      <p className={styles.narration}>Taking you to {label}.</p>
      <Link to={href} className={styles.navArtifact}>
        <span className={styles.navArtifactIcon}>
          <IconNavigate />
        </span>
        <span className={styles.navArtifactMain}>
          <span className={styles.navArtifactTitle}>{label}</span>
          <span className={styles.navArtifactHref}>{href}</span>
        </span>
        <span className={styles.navArtifactAction}>Open →</span>
      </Link>
    </div>
  );
}

// No-match reply — honest about what it can open.
export function NavigateMissReply({
  query,
  meta,
}: {
  query: string;
  meta: ReplyMeta;
}) {
  return (
    <ReplyShell
      narration={`I couldn’t find anywhere to open for “${query}”.`}
      meta={meta}
    >
      <p className={styles.narrationFollow}>
        I can open the Inbox, Contacts, Agent, Insights, or Trust &amp; Settings —
        or any contact by name.
      </p>
    </ReplyShell>
  );
}

// ── Help card (honest capabilities) — no gate, no artifact; a plain reply ─────
export function HelpCard({ onRun }: { onRun: (text: string) => void }) {
  return (
    <div className={styles.reply}>
      <p className={styles.narration}>
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
    </div>
  );
}
