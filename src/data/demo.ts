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
  CallListRow,
  CampaignRow,
  Channel,
  ConnectionRow,
  Contact,
  ConversationBrief,
  EnrollResult,
  FeedEvent,
  GateDecision,
  HomePulse,
  InboundResult,
  LineAgent,
  MediaPart,
  OutcomeRow,
  QueueItem,
  SearchHit,
  Suggestion,
  ThreadBrief,
  ThreadDetail,
  ThreadMessage,
  ToneProfile,
} from './types.ts';
import {
  AUDIT_SAMPLE,
  BOOKING_CONNECTION,
  CONTACTS,
  DEMO_NOW,
  HOME_PULSE,
  LINE_AGENTS,
  OUTCOMES,
  PLAYBOOKS,
  THREADS,
  TONE_PROFILE,
  auditTime,
  contactById,
  contactByName,
  daysFromNow,
  lastActivityFor,
  playbookByKey,
  threadByContactId,
  threadByConversationId,
  type FixtureContact,
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

// Missed-call text-back choreography (simulateMissedCall). call.missed fires at
// t=0 with the conversation already on the store; the agent then types and the
// acknowledgement auto-sends (no approval — inquiry basis within the ceiling).
const MISSED_CALL_AGENT_TYPING_MS = 1200; // agent typing 'typing'
const MISSED_CALL_AUTOSEND_MS = 2600; // agent typing 'stopped' + message.sent

// Document request choreography (requestDocument). The ask sends immediately;
// the customer then replies with a media part after a beat.
const DOC_REPLY_TYPING_MS = 2800; // customer typing → message.received (with media)

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

// A realistic media part per document type — the shape mirrors the provider's
// inbound media part ({ type:'media', filename, mime_type, size_bytes }).
function mediaPartFor(docType: string): MediaPart {
  const d = docType.toLowerCase();
  if (d.includes('declaration')) {
    return { type: 'media', filename: 'declarations.pdf', mime_type: 'application/pdf', size_bytes: 284_612 };
  }
  if (d.includes('license') || d.includes('licence')) {
    return { type: 'media', filename: 'IMG_2214.heic', mime_type: 'image/heic', size_bytes: 1_842_004 };
  }
  if (d.includes('damage') || d.includes('photo')) {
    return { type: 'media', filename: 'IMG_2231.heic', mime_type: 'image/heic', size_bytes: 2_305_889 };
  }
  return { type: 'media', filename: 'IMG_2214.heic', mime_type: 'image/heic', size_bytes: 1_842_004 };
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
  // Messages-first thread (v4): the per-conversation Agent ON/OFF switch, seeded
  // from the fixtures' controller (all fixture threads are agent-controlled →
  // enabled). Absent from the map means "not yet toggled" — default enabled.
  // OFF stands the agent down (no typing/drafts on inbound) but the composer and
  // an assistive suggestion stay available.
  private agentEnabled = new Map<string, boolean>();
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
      ...(m.parts ? { parts: m.parts } : {}),
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
        agent_enabled: this.isAgentEnabled(t.conversationId),
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
    // A message landed → the next-best suggestion regenerates.
    this.emit({ type: 'suggestion.updated', conversationId });
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

  // The Agent ON/OFF switch (v4). Turning OFF stands the agent down — no more
  // typing/drafts on inbound — and withdraws any pending held draft from the
  // queue (it was the agent's proposal; the human is taking the wheel). Turning
  // ON re-arms it. Either way controller stays mirrored and suggestion.updated
  // fires so the composer's suggestion slot refreshes (assistive when OFF).
  async setAgentEnabled(conversationId: string, enabled: boolean): Promise<void> {
    const t = this.threads.get(conversationId);
    if (!t) throw new Error('not found');
    this.agentEnabled.set(conversationId, enabled);
    if (!enabled) {
      for (const m of t.messages) {
        if (m.status === 'awaiting_approval') m.status = 'held';
      }
    }
    this.appendAudit('owner', 'agent_toggled', enabled ? 'on' : 'off');
    this.emit({ type: 'agent.toggled', conversationId, enabled });
    this.emit({ type: 'suggestion.updated', conversationId });
    await delay(undefined);
  }

  // takeover() is now a thin alias for turning the agent OFF, kept so any
  // not-yet-updated caller keeps compiling and behaving (agent stands down).
  async takeover(conversationId: string): Promise<void> {
    await this.setAgentEnabled(conversationId, false);
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
      // An inbound landed → the next-best suggestion regenerates for EVERY case
      // below (STOP/START consent flip, agent-ON draft path, agent-OFF assistive
      // path). Agent-ON additionally re-fires after the held draft is created.
      this.emit({ type: 'suggestion.updated', conversationId });

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

      // Normal message. Agent ON + not-opted-out → the existing typing→held-draft
      // flow (agent typing ~900ms in, then typing stopped + draft.created). Agent
      // OFF → NO agent typing/draft, but the suggestion already regenerated above
      // so the human sees a fresh assistive suggestion (held: false). Opted out →
      // silent (the suggestion() will resolve to null).
      if (!this.optedOut.has(t.contactId) && this.isAgentEnabled(conversationId)) {
        setTimeout(() => {
          this.emit({ type: 'typing', conversationId, who: 'agent', state: 'typing' });
        }, AGENT_TYPING_START_MS - CUSTOMER_TYPING_MS);

        setTimeout(() => {
          this.emit({ type: 'typing', conversationId, who: 'agent', state: 'stopped' });
          const draft = this.appendHeldDraft(t, text);
          this.emit({ type: 'draft.created', conversationId, message: this.toThreadMessage(draft) });
          // The held draft IS the new suggestion now — refresh the slot.
          this.emit({ type: 'suggestion.updated', conversationId });
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

  // Whether the agent is ON for a conversation. Default enabled (fixtures are
  // agent-controlled) until setAgentEnabled flips it. This is the source of
  // truth; controllerFor() is the legacy mirror.
  private isAgentEnabled(conversationId: string): boolean {
    return this.agentEnabled.get(conversationId) ?? true;
  }

  // The controller for a conversation — a legacy mirror of agent_enabled kept
  // populated so not-yet-updated UI ('agent' | 'human') keeps compiling.
  private controllerFor(conversationId: string): 'agent' | 'human' {
    return this.isAgentEnabled(conversationId) ? 'agent' : 'human';
  }

  // ── Operations: missed-call text-back, manual follow-up, documents ──────────

  // A missed call on the messaging-only line, forwarded to text-back. Ray is a
  // NEW caller with no prior conversation: the call.missed event mints the
  // conversation (with a system entry) at t=0, records consent on inquiry basis
  // (inbound_call) at call time, then — if the caller is not opted out — the
  // agent types (~1200ms) and the acknowledgement AUTO-SENDS (~2600ms). It's an
  // auto-send (no approval) because the playbook's ceiling allows an inquiry-
  // basis acknowledgement — but it still passes the gate, recorded honestly.
  simulateMissedCall(): Promise<{ conversationId: string }> {
    const contactId = 'ct_ray';
    const c = contactById(contactId)!;
    const conversationId = `cv_${contactId}`;

    // Record inbound-call consent at call time (inquiry basis). We do NOT grant
    // marketing — a call is transactional inquiry consent only. Idempotent.
    this.consentScopes(contactId).add('transactional');

    // Mint (or reuse) the conversation with a system 'missed_call' entry.
    let t = this.threads.get(conversationId);
    if (!t) {
      t = { conversationId, contactId, messages: [] };
      this.threads.set(conversationId, t);
    }
    const systemEntry: FixtureMessage = {
      id: `msg_sys_missed_${t.messages.length + 1}_${conversationId}`,
      direction: 'outbound',
      body: 'Missed call · forwarded to text-back',
      status: 'missed_call',
      channel_accepted: null,
      advice_verdict: 'none',
      classification: 'transactional',
      created_at: this.stamp(),
    };
    t.messages.push(systemEntry);
    this.appendAudit('voice_capture', 'call.missed', `${c.name} ${c.e164}`);
    this.appendAudit('system', 'consent_recorded', 'inbound_call');

    // t=0: the missed-call event (conversation is already on the store, so
    // listConversations()/queue()/thread() reads see it immediately).
    this.emit({ type: 'call.missed', conversationId, callerName: c.name, e164: c.e164 });

    // If the caller opted out, the playbook stays silent — no text-back.
    if (!this.optedOut.has(contactId)) {
      setTimeout(() => {
        this.emit({ type: 'typing', conversationId, who: 'agent', state: 'typing' });
      }, MISSED_CALL_AGENT_TYPING_MS);

      setTimeout(() => {
        this.emit({ type: 'typing', conversationId, who: 'agent', state: 'stopped' });
        // The gate still runs (fail-closed): auto-send only on ALLOW.
        const decision = this.gate(contactId, 'transactional');
        this.appendAudit('send_gate', 'send_gate', decision.auditReason);
        if (decision.decision !== 'ALLOW') return;
        const channel = pickChannel(contactId);
        const sent = this.appendSent(
          t!,
          "Sorry we missed your call — this is Hartley Insurance's text line. How can we help?",
          channel,
        );
        this.appendAudit('missed_call_agent', 'message.sent', `auto_ack channel:${channel}`);
        this.emit({ type: 'message.sent', conversationId, message: this.toThreadMessage(sent) });
        this.emit({ type: 'suggestion.updated', conversationId });
      }, MISSED_CALL_AUTOSEND_MS);
    }

    return delay({ conversationId });
  }

  // Messages-first send (v4): a normal composer send from the business's side.
  // Allowed whenever the send gate clears — NO human-controller requirement (a
  // human message is just another outbound; it does NOT change agent_enabled).
  // Same fail-closed gate as every other send path (kill switch / opt-out /
  // consent). After a clear send: any held draft on this conversation is CLEARED
  // (the human answered instead — the draft is stale), then message.sent and
  // suggestion.updated fire so an open thread and the suggestion slot refresh.
  sendManual(
    conversationId: string,
    body: string,
  ): Promise<{ ok: boolean; blockedReason?: string }> {
    const t = this.threads.get(conversationId);
    if (!t) return Promise.reject(new Error('not found'));

    const decision = this.gate(t.contactId, 'transactional');
    this.appendAudit('send_gate', 'send_gate', decision.auditReason);
    if (decision.decision !== 'ALLOW') {
      return delay({ ok: false, blockedReason: decision.auditReason });
    }
    const channel = pickChannel(t.contactId);
    const sent = this.appendSent(t, body, channel);
    // The human answered — drop any orphan held draft so no stale "Held" remains.
    this.clearHeldDrafts(t);
    this.appendAudit('owner', 'message.sent', `manual channel:${channel}`);
    this.emit({ type: 'message.sent', conversationId, message: this.toThreadMessage(sent) });
    this.emit({ type: 'suggestion.updated', conversationId });
    return delay({ ok: true });
  }

  // Remove any awaiting-approval drafts from the store (used after a manual send
  // supersedes them). Deletes rather than re-statuses so no orphan bubble lingers.
  private clearHeldDrafts(t: FixtureThread): void {
    t.messages = t.messages.filter((m) => m.status !== 'awaiting_approval');
  }

  // Ask the customer for a document photo, then simulate them replying with a
  // media part. The ask is a gated outbound (blocked SILENTLY if opted out — a
  // no-op rather than an error). On a clear gate the customer replies ~2800ms
  // later with an inbound carrying a MediaPart shaped like the provider's.
  requestDocument(conversationId: string, docType: string): Promise<void> {
    const t = this.threads.get(conversationId);
    if (!t) return Promise.reject(new Error('not found'));

    const decision = this.gate(t.contactId, 'transactional');
    this.appendAudit('send_gate', 'send_gate', decision.auditReason);
    if (decision.decision !== 'ALLOW') {
      // Blocked silently — no outbound, no reply simulated.
      return delay(undefined);
    }
    const channel = pickChannel(t.contactId);
    const ask = this.appendSent(
      t,
      `Could you text us a photo of your ${docType}? A picture is fine.`,
      channel,
    );
    this.appendAudit('owner', 'message.sent', `doc_request:${docType}`);
    this.emit({ type: 'message.sent', conversationId, message: this.toThreadMessage(ask) });
    this.emit({ type: 'suggestion.updated', conversationId });

    // The customer replies with a media attachment after a beat.
    setTimeout(() => {
      this.emit({ type: 'typing', conversationId, who: 'customer', state: 'typing' });
    }, DOC_REPLY_TYPING_MS - 500);

    setTimeout(() => {
      this.emit({ type: 'typing', conversationId, who: 'customer', state: 'stopped' });
      const part = mediaPartFor(docType);
      const reply = this.appendInboundMedia(t, 'Here you go 👍', part);
      this.appendAudit('system', 'message.received', `media:${part.filename}`);
      this.emit({ type: 'message.received', conversationId, message: this.toThreadMessage(reply) });
      this.emit({ type: 'suggestion.updated', conversationId });
    }, DOC_REPLY_TYPING_MS);

    return delay(undefined);
  }

  // Append a delivered outbound (status 'sent', channel set). Used by the auto
  // text-back, manual sends, and document requests.
  private appendSent(t: FixtureThread, body: string, channel: Exclude<Channel, null>): FixtureMessage {
    const m: FixtureMessage = {
      id: `msg_out_${t.messages.length + 1}_${t.conversationId}`,
      direction: 'outbound',
      body,
      status: 'sent',
      channel_accepted: channel,
      advice_verdict: 'none',
      classification: 'transactional',
      created_at: this.stamp(),
    };
    t.messages.push(m);
    return m;
  }

  // Append an inbound bubble carrying a media part (customer document reply).
  private appendInboundMedia(t: FixtureThread, text: string, part: MediaPart): FixtureMessage {
    const m: FixtureMessage = {
      id: `msg_in_media_${t.messages.length + 1}_${t.conversationId}`,
      direction: 'inbound',
      body: text,
      status: 'received',
      channel_accepted: null,
      advice_verdict: 'none',
      classification: 'transactional',
      created_at: this.stamp(),
      parts: [part],
    };
    t.messages.push(m);
    return m;
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
      // A held draft landed on this conversation → its suggestion regenerates.
      const draftConversationId = conv?.conversationId ?? `cv_${contactId}`;
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
      this.emit({ type: 'suggestion.updated', conversationId: draftConversationId });
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
    // The session store is the source of truth — a session-minted conversation
    // (e.g. Ray's missed-call → cv_ct_ray) has no fixture thread, so preferring
    // the live store here makes it a first-class triage row. Fall back to the
    // fixture thread only when nothing has landed on the store for this contact.
    const conv =
      [...this.threads.values()].find((t) => t.contactId === contactId) ??
      threadByContactId(contactId);
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

  // ── Call list — deterministic producer worklist ─────────────────────────────
  // Ranks the book by renewal proximity, engagement (a recent inbound), policy
  // status (lapsed = reactivation), and LOB gap (auto-only = bundle candidate).
  // Contacts with no valid consent still appear — but their suggested action is
  // "Call", never "Text": texting an unconsented lead is what the gate refuses;
  // a phone call is fine.
  callList(): Promise<CallListRow[]> {
    const rows = CONTACTS.map((c) => {
      const reasons: string[] = [];
      let score = 0;

      // Renewal proximity — nearest renewals rank first.
      if (c.xDateDays !== null && c.xDateDays >= 0 && c.xDateDays <= 45) {
        score += (46 - c.xDateDays) * 2;
        reasons.push(`Renews in ${c.xDateDays} day${c.xDateDays === 1 ? '' : 's'}`);
      }
      // Engagement — a recent inbound in their thread.
      const t = threadByContactId(c.id);
      const lastInbound = t
        ? [...t.messages].reverse().find((m) => m.direction === 'inbound')
        : undefined;
      if (lastInbound) {
        score += 10;
        reasons.push('Replied recently — still warm');
      }
      // Policy status — lapsed quotes are reactivation candidates.
      if (c.status === 'lapsed_quote') {
        score += 8;
        reasons.push('Quote lapsed — reactivation candidate');
      }
      if (c.status === 'new_lead') {
        score += 6;
        reasons.push(
          lastInbound || t ? 'New lead — asked about a quote' : 'Called yesterday, no policy on file',
        );
      }
      // LOB gap — auto only, no home = bundle-upsell candidate.
      if (c.lob === 'Auto') {
        score += 5;
        reasons.push('Auto only — bundle candidate');
      }

      const consentState: CallListRow['consentState'] = c.optedOut
        ? 'opted_out'
        : this.consentScopes(c.id).size === 0
          ? 'none'
          : 'ok';
      // The gate refuses texting an unconsented/opted-out lead — suggest a call.
      const suggestedAction = consentState === 'ok' ? 'Text' : 'Call';

      return {
        contactId: c.id,
        name: c.name,
        lob: c.lob,
        score,
        reasons,
        consentState,
        suggestedAction,
      };
    })
      // Keep only contacts with a real reason to reach out; rank and cap 5–7.
      .filter((r) => r.reasons.length > 0)
      .sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name))
      .slice(0, 7);

    return delay(rows);
  }

  // ── Voice/tone profile & booking connection (read-only fixtures) ────────────
  toneProfile(): Promise<ToneProfile> {
    return delay({
      trainedOn: TONE_PROFILE.trainedOn,
      traits: [...TONE_PROFILE.traits],
      example: { generic: TONE_PROFILE.example.generic, tuned: TONE_PROFILE.example.tuned },
    });
  }

  bookingConnection(): Promise<{ provider: string; status: 'connected'; calendar: string }> {
    return delay({
      provider: BOOKING_CONNECTION.provider,
      status: 'connected',
      calendar: BOOKING_CONNECTION.calendar,
    });
  }

  // The Connections surface (Trust & Settings): the five wires the agency
  // connects, composed from existing fixtures (booking + tone) so the whole
  // grid reads in one call. The detail on each row is what the business gave us.
  connections(): Promise<ConnectionRow[]> {
    return delay([
      {
        key: 'messaging',
        name: 'Messaging line',
        status: 'connected',
        powers: 'The number every text sends and receives on.',
        detail: '+1 (512) 555-0140 · texts send as Hartley Insurance',
      },
      {
        key: 'call_capture',
        name: 'Call capture',
        status: 'connected',
        powers: 'Missed calls become gated text-backs.',
        detail:
          'No-answer/busy forward from your business line · +1 (512) 555-0148',
      },
      {
        key: 'booking',
        name: 'Booking',
        status: 'connected',
        powers: 'The agent proposes real open slots.',
        detail: `${BOOKING_CONNECTION.provider} · ${BOOKING_CONNECTION.calendar}`,
      },
      {
        key: 'ams',
        name: 'Book of record (AMS)',
        status: 'connected',
        powers: 'Powers renewal rationale and the call list.',
        detail: 'Policy, renewal and LOB data · synced hourly',
      },
      {
        key: 'voice',
        name: 'Voice training',
        status: 'connected',
        powers: "The agent writes in your best producers' voice.",
        detail: `Trained on ${TONE_PROFILE.trainedOn}`,
      },
    ]);
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

  // ── Messages-first suggestion engine (v4) ───────────────────────────────────
  // The agent's next-best message for the composer's suggestion slot. Computed
  // DETERMINISTICALLY from real thread + fixture state — never invented facts,
  // no Math.random. Three tiers:
  //   (a) opted out → null (the gate would refuse every outbound anyway).
  //   (b) a held draft exists → THAT draft is the suggestion (held: true), with
  //       its playbook label and rationale drawn from the contact's data.
  //   (c) otherwise compute the next-best message from last-inbound keywords,
  //       renewal proximity, LOB gap, memory atoms, and policy_status — or
  //       return null when the honest move is silence (a nudge would be pushy:
  //       the customer just closed/said no, or the last outbound is unanswered
  //       and fresh). "Silence is sometimes the best action."
  async suggestion(conversationId: string): Promise<Suggestion | null> {
    const t = this.threads.get(conversationId);
    if (!t) return delay(null);
    const c = contactById(t.contactId);
    if (!c) return delay(null);

    // (a) Opted out → the gate blocks every outbound; suggesting one is dishonest.
    if (this.optedOut.has(t.contactId)) return delay(null);

    const first = c.name.split(' ')[0];
    const memValues = c.memory.map((m) => m.value.toLowerCase());
    const hasMem = (needle: string): boolean => memValues.some((v) => v.includes(needle));

    // (b) A held draft awaiting approval IS the suggestion. Rationale is built
    // from the contact's real data (renewal proximity, memory atoms), not prose.
    const heldDraft = [...t.messages].reverse().find((m) => m.status === 'awaiting_approval');
    if (heldDraft) {
      return delay({
        body: heldDraft.body,
        playbookLabel: this.playbookLabelFor(heldDraft),
        held: true,
        draftId: heldDraft.id,
        rationale: this.rationaleFor(c, hasMem),
      });
    }

    // (c) Compute the next-best assistive message from real thread + fixture data.
    const lastInbound = [...t.messages].reverse().find((m) => m.direction === 'inbound');
    const lastMessage = t.messages[t.messages.length - 1];
    const lastOutbound = [...t.messages].reverse().find((m) => m.direction === 'outbound');
    const inboundText = (lastInbound?.body ?? '').toLowerCase();

    // Silence rule 1 — a won-back / closed thread whose last message is a
    // closing outbound and where the customer isn't waiting on us. Nudging a
    // just-confirmed customer is pushy; the best action is to leave them alone.
    const closingWords = ['confirmed', "you're in", 'you’re in', 'all set', 'welcome aboard'];
    const lastIsClosingOutbound =
      lastMessage?.direction === 'outbound' &&
      closingWords.some((w) => lastMessage.body.toLowerCase().includes(w));
    const customerWaiting =
      !!lastInbound && (!lastOutbound || lastOutbound.created_at < lastInbound.created_at);
    if (lastIsClosingOutbound && !customerWaiting) return delay(null);

    // Silence rule 2 — the customer just declined. A follow-up would be pushy.
    const declineWords = ['no thanks', 'not interested', 'stop texting', 'leave me alone', 'we passed'];
    if (declineWords.some((w) => inboundText.includes(w))) return delay(null);

    // Silence rule 3 — our last outbound is unanswered and still fresh (< 1h).
    // Double-texting inside the hour reads as pushy; wait for a reply.
    if (lastMessage?.direction === 'outbound' && !customerWaiting) {
      const ageMs = this.now() - new Date(lastMessage.created_at).getTime();
      if (ageMs >= 0 && ageMs < 60 * 60_000) return delay(null);
    }

    // Otherwise build the message. Body sounds like the Hartley drafts: short,
    // human, one question max, names Tom where natural. rationale cites the data.
    const scopes = this.consentScopes(c.id);
    const rationale: string[] = [];
    let body: string;
    let playbookLabel: string;

    const renewsSoon = c.xDateDays !== null && c.xDateDays >= 0 && c.xDateDays <= 45;
    const lapsed = c.status === 'lapsed_quote';
    const autoOnly = c.lob === 'Auto';

    if (renewsSoon) {
      // Renewal proximity is the strongest driver.
      playbookLabel = 'Renewal reminder';
      rationale.push(`Renews ${this.friendlyDate(c.xDateDays!)} (${c.xDateDays} days)`);
      const afterSix = hasMem('after 6pm') || hasMem('evening');
      if (afterSix) rationale.push('Prefers texts after 6pm');
      if (hasMem('teenage driver')) rationale.push('Teenage driver starting this fall');
      const timeHint = afterSix ? 'this evening' : 'this week';
      body = `Hi ${first} — your ${c.lob ?? 'policy'} renews ${this.friendlyDate(
        c.xDateDays!,
      )}. Tom set aside time to go over your options first. Want to grab 15 minutes ${timeHint}?`;
    } else if (lapsed && customerWaiting && /quote|number|refresh|deciding|still/.test(inboundText)) {
      // They replied to a lapsed-quote nudge and are still deciding — offer the
      // refresh they asked about. Grounded in the actual inbound keywords.
      playbookLabel = 'Win back lapsed quotes';
      rationale.push('Quote lapsed — customer still deciding');
      rationale.push(`Their last reply: “${this.trim(lastInbound!.body, 48)}”`);
      body = `No rush ${first} — want me to have Tom refresh those numbers so you're comparing the latest? Happy to hold your prior quote while you decide.`;
    } else if (lapsed) {
      // A cold lapsed quote we can reactivate (marketing consent required to send;
      // the gate enforces it — we suggest honestly and let the gate decide).
      playbookLabel = 'Win back lapsed quotes';
      rationale.push('Quote lapsed — reactivation candidate');
      if (!scopes.has('marketing')) rationale.push('No marketing consent — gate will hold');
      body = `Hi ${first} — your quote from earlier this year is about to expire. Rates moved recently, so it's worth a fresh look. Want Tom to pull updated numbers?`;
    } else if (c.status === 'new_lead') {
      // A new lead who reached out — speed-to-lead follow-up. If they asked a
      // coverage question we keep it non-advisory (Tom answers the specifics).
      playbookLabel = 'Speed to lead';
      rationale.push('New lead — reached out about a quote');
      if (/liability|coverage|limit/.test(inboundText)) {
        rationale.push('Asked about coverage limits — Tom to advise');
        body = `Hi ${first} — good question on the limits. Tom can walk you through what fits your situation; want a quick call this week to lock in your numbers?`;
      } else {
        body = `Hi ${first} — thanks for reaching out about a quote. I can pull your numbers together today; what's a good time for a quick call?`;
      }
      if (autoOnly) rationale.push('Auto only — bundle candidate');
    } else if (autoOnly) {
      // An insured auto-only customer with nothing pressing — a gentle bundle
      // mention (marketing; gate enforces consent).
      playbookLabel = 'Bundle upsell';
      rationale.push('Auto only — bundle candidate');
      if (!scopes.has('marketing')) rationale.push('No marketing consent — gate will hold');
      body = `Hi ${first} — you're insured on auto with us. Bundling your home policy usually trims both premiums. Want Tom to run the combined number?`;
    } else {
      // Nothing actionable stands out — silence beats a filler text.
      return delay(null);
    }

    return delay({ body, playbookLabel, held: false, draftId: undefined, rationale });
  }

  // Rationale for a HELD draft — cites the contact's real data (renewal window,
  // memory atoms) rather than restating the draft prose. 1–3 short reasons.
  private rationaleFor(c: FixtureContact, hasMem: (needle: string) => boolean): string[] {
    const reasons: string[] = [];
    if (c.xDateDays !== null && c.xDateDays >= 0 && c.xDateDays <= 45) {
      reasons.push(`Renews ${this.friendlyDate(c.xDateDays)} (${c.xDateDays} days)`);
    }
    if (hasMem('after 6pm') || hasMem('evening')) reasons.push('Prefers texts after 6pm');
    if (hasMem('teenage driver')) reasons.push('Teenage driver starting this fall');
    if (hasMem('rate increase') && reasons.length < 3) reasons.push('Sore about last year’s rate increase');
    if (c.status === 'lapsed_quote' && reasons.length < 3) reasons.push('Quote lapsed — reactivation candidate');
    if (reasons.length === 0) reasons.push(`On the ${c.lob ?? 'no'} line`);
    return reasons.slice(0, 3);
  }

  // Map a held draft to a plain playbook label from its id / classification.
  private playbookLabelFor(m: FixtureMessage): string {
    if (m.id.includes('renewal_reminder')) return 'Renewal reminder';
    if (m.id.includes('winback_lapsed')) return 'Win back lapsed quotes';
    if (m.id.includes('bundle_upsell')) return 'Bundle upsell';
    if (m.id.includes('speed_to_lead')) return 'Speed to lead';
    if (m.id.includes('draft')) return 'Reply draft';
    return m.classification === 'marketing' ? 'Win back lapsed quotes' : 'Renewal reminder';
  }

  // A friendly month-day for a renewal N days out (e.g. "Aug 2"), from the pinned
  // demo clock so the label agrees with x_date. Deterministic, no locale drift.
  private friendlyDate(days: number): string {
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date(DEMO_NOW.getTime() + days * 86_400_000);
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
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
