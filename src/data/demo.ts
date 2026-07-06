// DemoClient — deterministic in-memory Hartley fixtures with WORKING mutations.
// The open-source repo demos the full governed loop with zero backend:
//   - approve() moves a draft to sent, picking the channel from the contact's
//     capability ladder (iMessage → SMS), and re-runs the gate: opted-out or a
//     kill switch returns a blocked ApproveResult with the right auditReason.
//   - simulateInbound() with a STOP word records the opt-out; subsequent
//     approvals for that contact return blocked 'opted_out'.
//   - enrollPlaybook('winback_lapsed') enrolls Ava + Noah, excludes Sam
//     (opted_out) and Lee (no_marketing_consent), creates drafts, bumps
//     needsYourEyes.
//   - setKillSwitch(true) flips the pulse and makes approve return blocked
//     'kill_switch'.
// ~250ms simulated latency via a single delay helper. No Math.random.

import type { DataClient } from './client.ts';
import type {
  ApproveResult,
  AuditRow,
  BookRow,
  CampaignRow,
  Channel,
  Contact,
  EnrollResult,
  GateDecision,
  HomePulse,
  InboundResult,
  LineAgent,
  OutcomeRow,
  QueueItem,
  SearchHit,
  ThreadBrief,
  ThreadDetail,
  ThreadMessage,
} from './types.ts';
import {
  AUDIT_SAMPLE,
  CONTACTS,
  HOME_PULSE,
  LINE_AGENTS,
  OUTCOMES,
  PLAYBOOKS,
  THREADS,
  auditTime,
  contactById,
  contactByName,
  daysFromNow,
  lastActivityFor,
  playbookByKey,
  threadByContactId,
  threadByConversationId,
  type FixtureMessage,
  type FixtureThread,
} from './fixtures.ts';

const STOP_WORDS = new Set([
  'stop',
  'quit',
  'end',
  'cancel',
  'unsubscribe',
  'revoke',
  'optout',
  'opt-out',
]);

// The single latency helper. One knob so the whole client feels consistent.
const LATENCY_MS = 250;
const delay = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));

// Deep-ish clone of a fixture thread so mutations don't leak into the fixtures.
function cloneThread(t: FixtureThread): FixtureThread {
  return {
    conversationId: t.conversationId,
    contactId: t.contactId,
    messages: t.messages.map((m) => ({ ...m })),
  };
}

// Pick the delivered-as channel from the contact's capability ladder.
// iMessage-capable → iMessage; otherwise SMS. (RCS is honest but not in the
// Hartley book; the ladder is imessage → rcs → sms in general.)
function pickChannel(contactId: string): Exclude<Channel, null> {
  const c = contactById(contactId);
  return c?.imessageCapable ? 'imessage' : 'sms';
}

interface Enrollment {
  playbookKey: string;
  contactId: string;
}

export class DemoClient implements DataClient {
  readonly mode = 'demo' as const;

  // Mutable session state, seeded from the deterministic fixtures.
  private killSwitch = false;
  private optedOut = new Set<string>(
    CONTACTS.filter((c) => c.optedOut).map((c) => c.id),
  );
  private threads: Map<string, FixtureThread> = new Map(
    THREADS.map((t) => [t.conversationId, cloneThread(t)]),
  );
  private enrollments: Enrollment[] = [];
  private auditLog = AUDIT_SAMPLE.map((a) => ({
    time: auditTime(a.minOffset),
    actor: a.actor,
    action: a.action,
    reason: a.reason,
    hash: a.hash,
  }));
  private hashCounter = 0;

  // ── helpers ───────────────────────────────────────────────────────────────
  private allMessages(): { thread: FixtureThread; msg: FixtureMessage }[] {
    const out: { thread: FixtureThread; msg: FixtureMessage }[] = [];
    for (const t of this.threads.values()) for (const m of t.messages) out.push({ thread: t, msg: m });
    return out;
  }

  private appendAudit(actor: string, action: string, reason: string): void {
    // Deterministic short pseudo-hash from the previous digest (no crypto dep,
    // no randomness — enough to *look* hash-chained in the audit sample).
    this.hashCounter += 1;
    const prev = this.auditLog[this.auditLog.length - 1]?.hash ?? '00000000';
    let acc = 0;
    const seed = `${prev}|${actor}|${action}|${reason}|${this.hashCounter}`;
    for (let i = 0; i < seed.length; i += 1) acc = (acc * 33 + seed.charCodeAt(i)) >>> 0;
    this.auditLog.push({
      time: new Date().toISOString(),
      actor,
      action,
      reason,
      hash: acc.toString(16).padStart(8, '0').slice(0, 8),
    });
  }

  // ── Home ──────────────────────────────────────────────────────────────────
  home(): Promise<HomePulse> {
    const needsYourEyes = this.allMessages().filter(
      ({ msg }) => msg.status === 'awaiting_approval' || msg.status === 'routed_to_human',
    ).length;
    return delay({
      needsYourEyes,
      conversationsRunning: this.threads.size,
      renewalsNext30d: HOME_PULSE.renewalsNext30d,
      wonBackCents: OUTCOMES.reduce((s, o) => s + o.amount_cents, 0),
      killSwitch: this.killSwitch,
    });
  }

  // ── Inbox ───────────────────────────────────────────────────────────────
  queue(): Promise<QueueItem[]> {
    const items: QueueItem[] = this.allMessages()
      .filter(({ msg }) => msg.status === 'awaiting_approval' || msg.status === 'routed_to_human')
      .map(({ thread, msg }) => {
        const c = contactById(thread.contactId)!;
        return {
          message_id: msg.id,
          conversation_id: thread.conversationId,
          status: msg.status,
          body: msg.body,
          classification: msg.classification,
          advice_verdict: msg.advice_verdict,
          created_at: msg.created_at,
          contact_id: c.id,
          display_name: c.name,
          lob: c.lob,
          policy_status: c.status,
          x_date: c.xDateDays === null ? null : daysFromNow(c.xDateDays),
        };
      })
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return delay(items);
  }

  thread(conversationId: string): Promise<ThreadDetail> {
    const t = this.threads.get(conversationId);
    if (!t) return Promise.reject(new Error('not found'));
    const c = contactById(t.contactId)!;
    const messages: ThreadMessage[] = t.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      status: m.status,
      channel_accepted: m.channel_accepted,
      advice_verdict: m.advice_verdict,
      created_at: m.created_at,
    }));
    return delay({
      conversation: {
        id: t.conversationId,
        controller: 'agent',
        contact_id: c.id,
        display_name: c.name,
        e164: c.e164,
        timezone: c.tz,
        lob: c.lob,
        policy_status: c.status,
        x_date: c.xDateDays === null ? null : daysFromNow(c.xDateDays),
      },
      messages,
      memory: c.memory.map((m) => ({ value: m.value, source: m.source })),
      consents: c.consents.map((scope) => ({ scope, basis: 'written' })),
      optedOut: this.optedOut.has(c.id),
    });
  }

  // The one send path: re-run the gate NOW with fresh state (approval is
  // necessary, not sufficient), then move the draft to sent.
  approve(conversationId: string, messageId: string): Promise<ApproveResult> {
    const t = this.threads.get(conversationId);
    const draft = t?.messages.find((m) => m.id === messageId && m.status === 'awaiting_approval');
    if (!t || !draft) return Promise.reject(new Error('no approvable draft'));

    const decision = this.gate(t.contactId, draft.classification);
    this.appendAudit('send_gate', 'send_gate', decision.auditReason);

    if (decision.decision !== 'ALLOW') {
      draft.status = `blocked_${decision.auditReason}`;
      return delay({ sent: false, decision });
    }
    const channel = pickChannel(t.contactId);
    draft.status = 'sent';
    draft.channel_accepted = channel;
    this.appendAudit('owner', 'message.sent', `channel:${channel}`);
    return delay({ sent: true, deliveredAs: channel, decision });
  }

  // Deterministic gate: the subset relevant to the demo mutations. Order mirrors
  // sendGate.ts: kill switch → opt-out → marketing consent.
  private gate(contactId: string, classification: string): GateDecision {
    const c = contactById(contactId)!;
    if (this.killSwitch) return { decision: 'BLOCK', auditReason: 'kill_switch' };
    if (this.optedOut.has(contactId)) return { decision: 'BLOCK', auditReason: 'opted_out' };
    if (classification === 'marketing' && !c.consents.includes('marketing')) {
      return { decision: 'BLOCK', auditReason: 'no_marketing_consent' };
    }
    if (classification === 'transactional' && !c.consents.includes('transactional')) {
      return { decision: 'BLOCK', auditReason: 'no_transactional_basis' };
    }
    return { decision: 'ALLOW', auditReason: 'allow' };
  }

  async edit(conversationId: string, messageId: string, body: string): Promise<void> {
    const t = this.threads.get(conversationId);
    const draft = t?.messages.find((m) => m.id === messageId && m.status === 'awaiting_approval');
    if (!t || !draft) throw new Error('no editable draft');
    draft.body = body;
    this.appendAudit('owner', 'draft_edited', messageId);
    await delay(undefined);
  }

  async takeover(conversationId: string): Promise<void> {
    const t = this.threads.get(conversationId);
    if (!t) throw new Error('not found');
    // Standing the agent down: any pending draft is withdrawn from the queue.
    for (const m of t.messages) {
      if (m.status === 'awaiting_approval') m.status = 'held';
    }
    this.appendAudit('owner', 'takeover', conversationId);
    await delay(undefined);
  }

  simulateInbound(conversationId: string, text: string): Promise<InboundResult> {
    const t = this.threads.get(conversationId);
    if (!t) return Promise.reject(new Error('not found'));
    const stopped = STOP_WORDS.has(text.trim().toLowerCase());
    t.messages.push({
      id: `msg_in_${t.messages.length + 1}_${conversationId}`,
      direction: 'inbound',
      body: text,
      status: 'received',
      channel_accepted: null,
      advice_verdict: 'none',
      classification: 'transactional',
      created_at: new Date().toISOString(),
    });
    if (stopped) {
      this.optedOut.add(t.contactId);
      this.appendAudit('system', 'opt_out_recorded', text);
    }
    return delay({ ok: true, optOutRecorded: stopped });
  }

  // ── Command tools ─────────────────────────────────────────────────────────
  queryBook(kind: 'renewals' | 'lapsed'): Promise<BookRow[]> {
    const rows: BookRow[] =
      kind === 'renewals'
        ? CONTACTS.filter((c) => c.xDateDays !== null && c.xDateDays >= 0 && c.xDateDays <= 30)
            .sort((a, b) => (a.xDateDays ?? 0) - (b.xDateDays ?? 0))
            .map((c) => ({ display_name: c.name, lob: c.lob, x_date: daysFromNow(c.xDateDays!) }))
        : CONTACTS.filter(
            (c) => c.status === 'lapsed_quote' && c.xDateDays !== null && c.xDateDays < -60,
          )
            .sort((a, b) => (a.xDateDays ?? 0) - (b.xDateDays ?? 0))
            .map((c) => ({
              display_name: c.name,
              lob: c.lob,
              x_date: daysFromNow(c.xDateDays!),
              policy_status: c.status,
            }));
    return delay(rows);
  }

  enrollPlaybook(playbookKey: string): Promise<EnrollResult> {
    const pb = playbookByKey(playbookKey);
    if (!pb) return Promise.reject(new Error('unknown playbook'));

    // Audience selection mirrors the platform's enroll_playbook.
    const audience: string[] =
      pb.key === 'winback_lapsed'
        ? CONTACTS.filter(
            (c) => c.status === 'lapsed_quote' && c.xDateDays !== null && c.xDateDays < -60,
          ).map((c) => c.id)
        : pb.key === 'renewal_reminder'
          ? CONTACTS.filter(
              (c) => c.xDateDays !== null && c.xDateDays >= 0 && c.xDateDays <= 30,
            ).map((c) => c.id)
          : CONTACTS.filter((c) => c.status === 'new_lead').map((c) => c.id);

    const enrolled: string[] = [];
    const excluded: { name: string; reason: string }[] = [];

    for (const contactId of audience) {
      const c = contactById(contactId)!;
      const verdict = this.gate(contactId, pb.classification);
      // Only hard BLOCKs exclude; HOLD (quiet hours) still enrolls.
      if (verdict.decision === 'BLOCK') {
        excluded.push({ name: c.name, reason: verdict.auditReason });
        continue;
      }
      if (this.enrollments.some((e) => e.playbookKey === pb.key && e.contactId === contactId)) {
        continue; // idempotent
      }
      this.enrollments.push({ playbookKey: pb.key, contactId });
      enrolled.push(c.name);

      // Create a draft awaiting approval on that contact's conversation.
      const conv = threadByContactId(contactId);
      const body = pb.template.replaceAll('{first_name}', c.name.split(' ')[0]);
      const target = conv && this.threads.get(conv.conversationId);
      if (target) {
        target.messages.push({
          id: `msg_pb_${pb.key}_${contactId}`,
          direction: 'outbound',
          body,
          status: 'awaiting_approval',
          channel_accepted: null,
          advice_verdict: 'none',
          classification: pb.classification,
          created_at: new Date().toISOString(),
        });
      } else {
        // No existing conversation — mint one so the draft is reviewable.
        const conversationId = `cv_${contactId}`;
        this.threads.set(conversationId, {
          conversationId,
          contactId,
          messages: [
            {
              id: `msg_pb_${pb.key}_${contactId}`,
              direction: 'outbound',
              body,
              status: 'awaiting_approval',
              channel_accepted: null,
              advice_verdict: 'none',
              classification: pb.classification,
              created_at: new Date().toISOString(),
            },
          ],
        });
      }
    }
    this.appendAudit('command_agent', 'playbook_enrolled', `${pb.key}:${enrolled.length}`);
    return delay({ playbook: pb.name, enrolled, excluded });
  }

  campaignStatus(): Promise<CampaignRow[]> {
    const rows: CampaignRow[] = PLAYBOOKS.map((pb) => {
      const enrolled = this.enrollments.filter((e) => e.playbookKey === pb.key).length;
      const drafts_pending = this.allMessages().filter(
        ({ msg }) =>
          msg.status === 'awaiting_approval' && msg.id.startsWith(`msg_pb_${pb.key}_`),
      ).length;
      return {
        key: pb.key,
        name: pb.name,
        classification: pb.classification,
        status: pb.status,
        enrolled,
        drafts_pending,
      };
    });
    return delay(rows);
  }

  threadBrief(contactId: string): Promise<ThreadBrief> {
    const c = contactById(contactId);
    if (!c) return Promise.reject(new Error('not found'));
    const conv = threadByContactId(contactId);
    const recent = (conv?.messages ?? [])
      .slice()
      .reverse()
      .slice(0, 6)
      .map((m) => ({ direction: m.direction, body: m.body, created_at: m.created_at }));
    return delay({
      contactId,
      conversationId: conv?.conversationId ?? null,
      contact: {
        display_name: c.name,
        lob: c.lob,
        policy_status: c.status,
        x_date: c.xDateDays === null ? null : daysFromNow(c.xDateDays),
        timezone: c.tz,
      },
      memory: c.memory.map((m) => ({ value: m.value })),
      recent,
    });
  }

  searchConversations(q: string): Promise<SearchHit[]> {
    const needle = q.trim().toLowerCase();
    if (!needle) return delay<SearchHit[]>([]);
    const hits: SearchHit[] = [];
    for (const t of this.threads.values()) {
      const c = contactById(t.contactId)!;
      for (const m of t.messages) {
        if (m.body.toLowerCase().includes(needle)) {
          hits.push({ kind: 'message', body: m.body, display_name: c.name });
        }
      }
    }
    for (const c of CONTACTS) {
      for (const m of c.memory) {
        if (m.value.toLowerCase().includes(needle)) {
          hits.push({ kind: 'memory', value: m.value, display_name: c.name });
        }
      }
    }
    return delay(hits.slice(0, 20));
  }

  setKillSwitch(on: boolean): Promise<void> {
    this.killSwitch = on;
    this.appendAudit('owner', 'kill_switch', on ? 'on' : 'off');
    return delay(undefined);
  }

  // ── Read-model surfaces (structured-skeleton screens) ──────────────────────
  contacts(): Promise<Contact[]> {
    return delay(
      CONTACTS.map((c) => ({
        id: c.id,
        display_name: c.name,
        e164: c.e164,
        timezone: c.tz,
        lob: c.lob,
        policy_status: c.status,
        x_date: c.xDateDays === null ? null : daysFromNow(c.xDateDays),
        consents: c.consents,
        optedOut: this.optedOut.has(c.id),
        lastActivity: lastActivityFor(c.id),
        memory: c.memory.map((m) => ({ value: m.value, source: m.source })),
      })),
    );
  }

  outcomes(): Promise<OutcomeRow[]> {
    const label: Record<string, string> = {
      renewal_won_back: 'Renewal won back',
      cross_sell: 'Cross-sell added',
    };
    const playbookFor: Record<string, string> = {
      renewal_won_back: 'Win back lapsed quotes',
      cross_sell: 'Win back lapsed quotes',
    };
    return delay(
      OUTCOMES.map((o) => ({
        contact: contactById(o.contactId)?.name ?? o.contactId,
        playbook: playbookFor[o.kind] ?? '—',
        kind: o.kind,
        outcome: label[o.kind] ?? o.kind,
        amount_cents: o.amount_cents,
        note: o.note,
      })),
    );
  }

  agents(): Promise<LineAgent[]> {
    return delay(
      LINE_AGENTS.map((a) => ({
        key: a.key,
        name: a.name,
        e164: a.e164,
        registered: a.registered,
        quarantined: a.quarantined,
        autonomyCeiling: a.autonomyCeiling,
        playbooks: a.playbooks,
      })),
    );
  }

  auditSample(): Promise<AuditRow[]> {
    return delay(this.auditLog.slice().reverse().slice(0, 12));
  }

  optOuts(): Promise<Contact[]> {
    return delay(
      CONTACTS.filter((c) => this.optedOut.has(c.id)).map((c) => ({
        id: c.id,
        display_name: c.name,
        e164: c.e164,
        timezone: c.tz,
        lob: c.lob,
        policy_status: c.status,
        x_date: c.xDateDays === null ? null : daysFromNow(c.xDateDays),
        consents: c.consents,
        optedOut: true,
        lastActivity: lastActivityFor(c.id),
        memory: c.memory.map((m) => ({ value: m.value, source: m.source })),
      })),
    );
  }
}

// Small helpers re-exported for command-router narration (Home, Wave 2).
export { contactByName, threadByConversationId };
