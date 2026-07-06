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
  ConversationBrief,
  EnrollResult,
  FeedEvent,
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
  DEMO_NOW,
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

// Consent keywords are Reloment's own layer — the provider does no STOP/START
// handling. STOP set includes 'stopall' (a common carrier alias); START/unstop
// are the customer-only resume keywords.
const STOP_WORDS = new Set([
  'stop',
  'stopall',
  'quit',
  'end',
  'cancel',
  'unsubscribe',
  'revoke',
  'optout',
  'opt-out',
]);
const START_WORDS = new Set(['start', 'unstop']);

// The single latency helper. One knob so the whole client feels consistent.
const LATENCY_MS = 250;
const delay = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));

// Live-choreography timings for simulateInbound (all via setTimeout). The
// method resolves quickly with an ack; these events carry the payloads.
const CUSTOMER_TYPING_MS = 700; // typing 'stopped' + message.received fire here
const AGENT_TYPING_START_MS = 900; // agent typing 'typing'
const AGENT_TYPING_STOP_MS = 1400; // agent typing 'stopped' + draft.created

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

  // Pinned clock: what the UI displays (a contact's local time) must agree
  // with what the demo gate decides (see DataClient.now).
  now(): number {
    return DEMO_NOW.getTime();
  }

  // ── Live event feed ─────────────────────────────────────────────────────────
  // A simple in-memory emitter set. subscribe() returns an unsubscribe fn.
  private feedHandlers = new Set<(e: FeedEvent) => void>();

  subscribe(handler: (e: FeedEvent) => void): () => void {
    this.feedHandlers.add(handler);
    return () => {
      this.feedHandlers.delete(handler);
    };
  }

  private emit(event: FeedEvent): void {
    for (const h of this.feedHandlers) h(event);
  }

  // Mutable session state, seeded from the deterministic fixtures.
  private killSwitch = false;
  private optedOut = new Set<string>(
    CONTACTS.filter((c) => c.optedOut).map((c) => c.id),
  );
  // Session-mutable consent scopes per contact (START restores transactional
  // only). Seeded from the fixture consents; the read surfaces prefer this.
  private consents = new Map<string, Set<string>>(
    CONTACTS.map((c) => [c.id, new Set(c.consents)]),
  );
  // Conversations a takeover handed to a human (agent stands down — no drafts).
  private humanControlled = new Set<string>();
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

  // The session's live consent scopes for a contact (seeded from the fixture).
  private consentScopes(contactId: string): Set<string> {
    let scopes = this.consents.get(contactId);
    if (!scopes) {
      scopes = new Set(contactById(contactId)?.consents ?? []);
      this.consents.set(contactId, scopes);
    }
    return scopes;
  }

  // Project a stored FixtureMessage into the ThreadMessage shape event payloads
  // (and getThread) expose — a single mapping so the feed and the read agree.
  private toThreadMessage(m: FixtureMessage): ThreadMessage {
    return {
      id: m.id,
      direction: m.direction,
      body: m.body,
      status: m.status,
      channel_accepted: m.channel_accepted,
      advice_verdict: m.advice_verdict,
      created_at: m.created_at,
    };
  }

  // Monotonic session clock: every stamped event lands one minute after the
  // previous one, starting at DEMO_NOW — so session-created messages always
  // sort (and day-group) after the fixture timeline, never "yesterday".
  private clockMin = 0;
  private stamp(): string {
    this.clockMin += 1;
    return new Date(DEMO_NOW.getTime() + this.clockMin * 60_000).toISOString();
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
      time: this.stamp(),
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
    const messages: ThreadMessage[] = t.messages.map((m) => this.toThreadMessage(m));
    return delay({
      conversation: {
        id: t.conversationId,
        controller: this.controllerFor(t.conversationId),
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
      consents: [...this.consentScopes(c.id)].map((scope) => ({ scope, basis: 'written' })),
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
    // Notify any open thread live (the store already reflects the send above).
    this.emit({ type: 'message.sent', conversationId, message: this.toThreadMessage(draft) });
    return delay({ sent: true, deliveredAs: channel, decision });
  }

  // Deterministic gate: the subset relevant to the demo mutations. Order mirrors
  // sendGate.ts: kill switch → opt-out → marketing consent.
  private gate(contactId: string, classification: string): GateDecision {
    const scopes = this.consentScopes(contactId);
    if (this.killSwitch) return { decision: 'BLOCK', auditReason: 'kill_switch' };
    if (this.optedOut.has(contactId)) return { decision: 'BLOCK', auditReason: 'opted_out' };
    if (classification === 'marketing' && !scopes.has('marketing')) {
      return { decision: 'BLOCK', auditReason: 'no_marketing_consent' };
    }
    if (classification === 'transactional' && !scopes.has('transactional')) {
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
    // Standing the agent down: the thread is human-controlled (no more agent
    // drafts on inbound), and any pending draft is withdrawn from the queue.
    this.humanControlled.add(conversationId);
    for (const m of t.messages) {
      if (m.status === 'awaiting_approval') m.status = 'held';
    }
    this.appendAudit('owner', 'takeover', conversationId);
    await delay(undefined);
  }

  // Live choreography: the method resolves quickly with an ack; timers emit the
  // typing + inbound + (consent | agent draft) events that carry the payloads.
  // The store is mutated when each event's payload is created, so getThread()
  // and listConversations() reads stay authoritative — events are notifications.
  simulateInbound(conversationId: string, text: string): Promise<InboundResult> {
    const t = this.threads.get(conversationId);
    if (!t) return Promise.reject(new Error('not found'));

    const body = text.trim();
    const lower = body.toLowerCase();
    const isStop = STOP_WORDS.has(lower);
    const isStart = START_WORDS.has(lower);
    const wasOptedOut = this.optedOut.has(t.contactId);

    // Customer typing indicator, then (after ~700ms) typing stopped + the
    // inbound message landing on the store and the feed together.
    this.emit({ type: 'typing', conversationId, who: 'customer', state: 'typing' });

    setTimeout(() => {
      this.emit({ type: 'typing', conversationId, who: 'customer', state: 'stopped' });

      const inbound = this.appendInbound(t, text);
      this.emit({ type: 'message.received', conversationId, message: this.toThreadMessage(inbound) });

      if (isStop) {
        // Only the FIRST opt-out records a system entry + consent event; a
        // repeated STOP records the inbound bubble only (the bug being fixed).
        if (!wasOptedOut) {
          this.optedOut.add(t.contactId);
          this.appendSystem(t, 'opted_out', 'Opted out — customer texted STOP');
          this.appendAudit('system', 'opt_out_recorded', text);
          this.emit({
            type: 'consent.changed',
            conversationId,
            contactId: t.contactId,
            optedOut: true,
          });
        }
        return;
      }

      if (isStart) {
        // Only the customer can opt back in. START restores TRANSACTIONAL
        // messaging only — marketing requires fresh express consent, so we
        // revoke it honestly and never restore it here.
        if (wasOptedOut) {
          this.optedOut.delete(t.contactId);
          this.restoreTransactionalOnly(t.contactId);
          this.appendSystem(
            t,
            'opted_back_in',
            'Opted back in — transactional only (marketing needs fresh consent)',
          );
          this.appendAudit('system', 'opt_in_recorded', text);
          this.emit({
            type: 'consent.changed',
            conversationId,
            contactId: t.contactId,
            optedOut: false,
          });
        }
        return;
      }

      // Normal message: only an agent-controlled, not-opted-out thread drafts a
      // reply (agent typing ~900ms in, then typing stopped + draft.created).
      if (!this.optedOut.has(t.contactId) && this.controllerFor(conversationId) === 'agent') {
        setTimeout(() => {
          this.emit({ type: 'typing', conversationId, who: 'agent', state: 'typing' });
        }, AGENT_TYPING_START_MS - CUSTOMER_TYPING_MS);

        setTimeout(() => {
          this.emit({ type: 'typing', conversationId, who: 'agent', state: 'stopped' });
          const draft = this.appendHeldDraft(t, text);
          this.emit({ type: 'draft.created', conversationId, message: this.toThreadMessage(draft) });
        }, AGENT_TYPING_STOP_MS - CUSTOMER_TYPING_MS);
      }
    }, CUSTOMER_TYPING_MS);

    // Ack now; the opt-out flag is set on the timer, so report intent here.
    return delay({ ok: true, optOutRecorded: isStop && !wasOptedOut });
  }

  // Append the inbound bubble (single source of truth for getThread reads).
  private appendInbound(t: FixtureThread, text: string): FixtureMessage {
    const m: FixtureMessage = {
      id: `msg_in_${t.messages.length + 1}_${t.conversationId}`,
      direction: 'inbound',
      body: text,
      status: 'received',
      channel_accepted: null,
      advice_verdict: 'none',
      classification: 'transactional',
      created_at: this.stamp(),
    };
    t.messages.push(m);
    return m;
  }

  // A centered timeline entry (opt-out / opt-back-in) — rendered as a system
  // event, not a chat bubble (see inboxUtils.isSystemEvent).
  private appendSystem(
    t: FixtureThread,
    status: 'opted_out' | 'opted_back_in',
    body: string,
  ): FixtureMessage {
    const m: FixtureMessage = {
      id: `msg_sys_${status}_${t.messages.length + 1}_${t.conversationId}`,
      direction: 'outbound',
      body,
      status,
      channel_accepted: null,
      advice_verdict: 'none',
      classification: 'transactional',
      created_at: this.stamp(),
    };
    t.messages.push(m);
    return m;
  }

  // A held reply draft the agent proposes to a normal inbound — awaiting the
  // operator's approval (the DraftCard money component picks this up).
  private appendHeldDraft(t: FixtureThread, inboundText: string): FixtureMessage {
    const c = contactById(t.contactId);
    const first = c?.name.split(' ')[0] ?? 'there';
    // Grounded, generic reply — acknowledges the inbound, offers Tom's time.
    const body =
      `Thanks ${first} — good question. Let me pull the details and have Tom ` +
      `confirm. Want a quick call this week to go over it?`;
    void inboundText; // the draft is a held acknowledgement, not an LLM answer
    const m: FixtureMessage = {
      id: `msg_draft_${t.messages.length + 1}_${t.conversationId}`,
      direction: 'outbound',
      body,
      status: 'awaiting_approval',
      channel_accepted: null,
      advice_verdict: 'none',
      classification: 'transactional',
      created_at: this.stamp(),
    };
    t.messages.push(m);
    return m;
  }

  // Resume via START restores transactional consent only; marketing stays
  // revoked (real compliance: resuming does not re-grant marketing express
  // consent). Mutates the session consent view backing getThread/contacts.
  private restoreTransactionalOnly(contactId: string): void {
    const scopes = this.consentScopes(contactId);
    scopes.add('transactional');
    scopes.delete('marketing');
  }

  // The controller for a conversation. Fixtures are agent-controlled until a
  // takeover flips them to human (tracked in humanControlled).
  private controllerFor(conversationId: string): 'agent' | 'human' {
    return this.humanControlled.has(conversationId) ? 'human' : 'agent';
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
          created_at: this.stamp(),
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
              created_at: this.stamp(),
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
        consents: [...this.consentScopes(c.id)],
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
      OUTCOMES.map((o) => {
        const d = new Date(DEMO_NOW.getTime());
        d.setUTCMonth(d.getUTCMonth() - o.monthOffset);
        return {
          contact: contactById(o.contactId)?.name ?? o.contactId,
          playbook: playbookFor[o.kind] ?? '—',
          kind: o.kind,
          outcome: label[o.kind] ?? o.kind,
          amount_cents: o.amount_cents,
          note: o.note,
          month: d.toISOString().slice(0, 7),
        };
      }),
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
        consents: [...this.consentScopes(c.id)],
        optedOut: true,
        lastActivity: lastActivityFor(c.id),
        memory: c.memory.map((m) => ({ value: m.value, source: m.source })),
      })),
    );
  }

  // ── Conversation brief / ask-the-thread ─────────────────────────────────────
  // Both derive DETERMINISTICALLY from the actual thread state — never invented
  // facts. The brief recaps who/what/gate; askThread keyword-matches the ask and
  // answers from real messages, consent, and gate decisions only.
  conversationBrief(conversationId: string): Promise<ConversationBrief> {
    const t = this.threads.get(conversationId);
    if (!t) return Promise.reject(new Error('not found'));
    const c = contactById(t.contactId)!;
    const first = c.name.split(' ')[0];
    const optedOut = this.optedOut.has(c.id);
    const scopes = this.consentScopes(c.id);

    const lastInbound = [...t.messages].reverse().find((m) => m.direction === 'inbound');
    const latestDraft = [...t.messages]
      .reverse()
      .find((m) => m.status === 'awaiting_approval');
    const sentReply = [...t.messages].reverse().find((m) => m.status === 'sent');
    const routed = t.messages.some((m) => m.status === 'routed_to_human');

    // Sentence 1 — who the contact is (name, product line).
    const lob = c.lob ? `${c.lob} line` : 'no product line on file';
    const sentences: string[] = [
      `${c.name} is on the ${lob}${
        c.status ? `, currently ${c.status.replaceAll('_', ' ')}` : ''
      }.`,
    ];
    // Sentence 2 — what the last inbound asked.
    if (lastInbound) {
      sentences.push(`Their last message: “${this.trim(lastInbound.body)}”.`);
    }
    // Sentence 3 — what the agent did + current gate/consent state.
    if (optedOut) {
      sentences.push(
        `${first} is opted out, so the send gate blocks every outbound until they opt back in.`,
      );
    } else if (routed) {
      sentences.push(`It was routed to a licensed human — the agent held off.`);
    } else if (latestDraft) {
      sentences.push(
        `A reply draft is held for your approval; consent on file is ${this.scopeList(scopes)}.`,
      );
    } else if (sentReply) {
      sentences.push(`The last reply was sent as ${sentReply.channel_accepted ?? 'text'}.`);
    } else {
      sentences.push(`No draft is pending; consent on file is ${this.scopeList(scopes)}.`);
    }

    // moments = system events + first inbound + latest draft, with stamp times.
    const moments: { at: string; label: string }[] = [];
    const firstInbound = t.messages.find((m) => m.direction === 'inbound');
    if (firstInbound) {
      moments.push({ at: firstInbound.created_at, label: 'First inbound received' });
    }
    for (const m of t.messages) {
      if (m.status === 'opted_out') moments.push({ at: m.created_at, label: 'Opted out (STOP)' });
      if (m.status === 'opted_back_in') {
        moments.push({ at: m.created_at, label: 'Opted back in (START) — transactional only' });
      }
      if (m.status === 'routed_to_human') {
        moments.push({ at: m.created_at, label: 'Routed to a licensed human' });
      }
    }
    if (latestDraft) {
      moments.push({ at: latestDraft.created_at, label: 'Draft held for approval' });
    }
    moments.sort((a, b) => a.at.localeCompare(b.at));

    return delay({
      summary: sentences.join(' '),
      moments,
      askSuggestions: [
        `What did ${first} ask?`,
        latestDraft ? 'Why is the draft held?' : `When does ${first} renew?`,
        `What's the next step?`,
      ],
    });
  }

  askThread(conversationId: string, question: string): Promise<{ answer: string }> {
    const t = this.threads.get(conversationId);
    if (!t) return Promise.reject(new Error('not found'));
    const c = contactById(t.contactId)!;
    const first = c.name.split(' ')[0];
    const q = question.toLowerCase();
    const optedOut = this.optedOut.has(c.id);
    const scopes = this.consentScopes(c.id);
    const lastInbound = [...t.messages].reverse().find((m) => m.direction === 'inbound');
    const held = t.messages.some((m) => m.status === 'awaiting_approval');

    // summar → summary recap
    if (q.includes('summar')) {
      const lob = c.lob ? `on the ${c.lob} line` : 'with no product line on file';
      const state = optedOut
        ? 'opted out'
        : held
          ? 'has a draft awaiting your approval'
          : 'is in progress';
      return delay({
        answer: `${c.name}, ${lob}, ${state}. Consent on file: ${this.scopeList(scopes)}.`,
      });
    }
    // why / held / gate → explain the hold citing consent scopes + quiet hours
    if (q.includes('why') || q.includes('held') || q.includes('gate')) {
      const localHint = `their local time is respected for quiet hours (${c.tz})`;
      const consentHint = `consent on file is ${this.scopeList(scopes)}`;
      const answer = optedOut
        ? `The gate blocks this thread because ${first} is opted out — nothing sends until they opt back in.`
        : held
          ? `The draft is held so you can approve it before it sends. On approval the gate re-runs live: ${consentHint}, and ${localHint}.`
          : `Nothing is currently held. When a reply is sent the gate checks opt-out, then ${consentHint}, then quiet hours (${localHint}).`;
      return delay({ answer });
    }
    // ask / want / said → restate last inbound
    if (q.includes('ask') || q.includes('want') || q.includes('said')) {
      return delay({
        answer: lastInbound
          ? `${first} said: “${this.trim(lastInbound.body)}”.`
          : `${first} hasn’t sent an inbound message in this thread yet.`,
      });
    }
    // next / renew → renewal date + suggested next step
    if (q.includes('next') || q.includes('renew')) {
      const renew =
        c.xDateDays === null
          ? `${first} has no renewal date on file`
          : `${first}'s renewal date is ${daysFromNow(c.xDateDays)}`;
      const step = optedOut
        ? 'wait for a customer-initiated START before any outreach'
        : held
          ? 'review and approve the held draft'
          : 'send the renewal reminder when timing fits their quiet hours';
      return delay({ answer: `${renew}. Suggested next step: ${step}.` });
    }
    // fallback — honest about scope
    return delay({
      answer:
        'In this demo I can answer about this conversation’s messages, consent state, and gate decisions.',
    });
  }

  // Short helpers for the brief/ask narration.
  private trim(body: string, max = 90): string {
    const one = body.replaceAll(/\s+/g, ' ').trim();
    return one.length > max ? `${one.slice(0, max - 1)}…` : one;
  }

  private scopeList(scopes: Set<string>): string {
    const list = [...scopes];
    return list.length ? list.join(' + ') : 'none';
  }
}

// Small helpers re-exported for command-router narration (Home, Wave 2).
export { contactByName, threadByConversationId };
