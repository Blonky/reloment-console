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
  AgentAsk,
  AgentChatMessage,
  AgentProfile,
  AgentSession,
  AgentVoice,
  ApproveResult,
  AuditRow,
  BookRow,
  CallListRow,
  CampaignRow,
  Channel,
  ConnectionRow,
  ConnectionsCatalog,
  Contact,
  KnowledgeDoc,
  ConversationBrief,
  EnrollResult,
  FeedEvent,
  GateDecision,
  HomeBriefing,
  HomePulse,
  InboundResult,
  InsightsReport,
  LinkPart,
  MediaPart,
  MessagePart,
  OutcomeRow,
  PlaybookFlow,
  QueueItem,
  ResearchReport,
  ResearchStep,
  SearchHit,
  SteerGoal,
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
  LICENSED_AGENT,
  LINE_DISPLAY,
  OUTCOMES,
  PLAYBOOK_HISTORY,
  PLAYBOOKS,
  TENANT_NAME,
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

// ── Agent workspace (r11) persistence ───────────────────────────────────────
// One namespaced localStorage key holds the whole session store (sessions +
// their transcripts). Bumping the version suffix is how we'd migrate the shape.
const AGENT_STORE_KEY = 'reloment.demo.agentSessions.v1';
// A fresh session's placeholder title until the first user message renames it.
const NEW_CHAT_TITLE = 'New chat';
// How many characters a first-message-derived title is truncated to (~40).
const TITLE_MAX = 40;

// The persisted shape under AGENT_STORE_KEY: sessions keyed by id, each with its
// own transcript. Kept flat + JSON-friendly so it round-trips through the key.
interface AgentStore {
  sessions: AgentSession[];
  messages: Record<string, AgentChatMessage[]>;
}

// The persisted brain shape under BRAIN_STORE_KEY: the editable voice + the
// knowledge documents. Seeded once (from TONE_PROFILE + three starter docs) the
// first time it is read on a fresh browser; edits persist here.
interface AgentBrainStore {
  voice: AgentVoice;
  docs: KnowledgeDoc[];
}

// The native surfaces available to request in the Connections marketplace —
// mirrors the provider's real integration catalog (conversation panes, sidebar
// sends, workflow/flow actions, book-of-record sync, custom MCP/API).
const AVAILABLE_CONNECTIONS: { key: string; name: string; blurb: string }[] = [
  {
    key: 'salesforce',
    name: 'Salesforce',
    blurb: 'Text customers from Lead, Contact and Account records',
  },
  { key: 'hubspot', name: 'HubSpot', blurb: 'Text from contact records and workflows' },
  { key: 'slack', name: 'Slack', blurb: 'Customer replies land in your Slack channels for the team' },
  { key: 'nowcerts', name: 'NowCerts', blurb: 'Keeps policies, renewals and LOBs synced automatically' },
  { key: 'hawksoft', name: 'HawkSoft', blurb: 'Keeps policies, renewals and LOBs synced automatically' },
  { key: 'custom', name: 'Custom', blurb: 'Bring your own MCP or API and we wire it in' },
];

// ── Agent brain (r13) persistence ───────────────────────────────────────────
// One namespaced key holds the editable voice + knowledge documents. Same
// guarded pattern as the agent-session store: an in-memory cache is always
// authoritative; localStorage is best-effort (SSR / privacy mode safe).
const BRAIN_STORE_KEY = 'reloment.demo.agentBrain.v1';
// The Connections marketplace records requested integrations under its own key so
// a "Requested" state survives reload without touching the brain store.
const CONNECTION_REQUESTS_KEY = 'reloment.demo.connectionRequests.v1';
// Voice limits mirror the pinned PUT /api/agent/voice contract.
const VOICE_TRAIT_MAX = 6;
const VOICE_TRAIT_LEN = 60;
const VOICE_INSTRUCTIONS_LEN = 2000;

// ── File upload (r19) — client-side text parsing, chunk mirroring ────────────
// Text-like files are read into the doc body; long text is chunked at ~1500 chars
// into "part N/M" docs, mirroring the platform's chunker. Bodies cap at ~200KB.
const UPLOAD_TEXT_CAP = 200_000; // ~200KB of decoded text kept
const UPLOAD_CHUNK_CHARS = 1500; // chunk size mirroring the platform
// Honest status for binaries in demo mode — no fake extraction; the real parse
// happens on the platform connection.
const UPLOAD_BINARY_NOTE = 'Parsed on the platform connection';

// Text-like if the mime is text/* (or empty) OR the extension is .txt/.md/.csv.
function isTextLike(filename: string, mime: string): boolean {
  const m = mime.toLowerCase();
  if (m.startsWith('text/') || m === 'application/json' || m === 'text/csv') return true;
  if (m && !m.startsWith('text/')) {
    // A concrete non-text mime (e.g. application/pdf, image/*) → binary.
    if (m !== 'application/octet-stream') return /\.(txt|md|markdown|csv|log)$/i.test(filename);
  }
  return /\.(txt|md|markdown|csv|log)$/i.test(filename);
}

// Decode a base64 payload to a UTF-8 string, guarded (malformed → empty). Uses
// atob + TextDecoder so multibyte content survives; no Node Buffer dependency.
function decodeBase64Utf8(b64: string): string {
  try {
    const binary = globalThis.atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

// The decoded byte length of a base64 payload (for size_bytes), without decoding
// the whole thing: 3 bytes per 4 base64 chars, minus padding.
function base64ByteLength(b64: string): number {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  if (clean.length === 0) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, (clean.length * 3) / 4 - padding);
}

// Stopwords the knowledge matcher ignores so common filler never scores a hit.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'is', 'are', 'was', 'were', 'be',
  'been', 'do', 'does', 'did', 'you', 'your', 'yours', 'we', 'our', 'us', 'i',
  'me', 'my', 'they', 'them', 'it', 'to', 'of', 'in', 'on', 'for', 'with', 'at',
  'by', 'from', 'up', 'about', 'into', 'over', 'after', 'this', 'that', 'these',
  'those', 'can', 'could', 'would', 'should', 'will', 'have', 'has', 'had', 'get',
  'got', 'guys', 'guy', 'hey', 'hi', 'hello', 'so', 'just', 'any', 'some', 'what',
  'when', 'how', 'why', 'who', 'there', 'here', 'yes', 'no', 'ok', 'okay', 'please',
]);

// The salient tokens of a lowercased string: word tokens ≥3 chars, minus
// stopwords. A light plural-fold (trailing 's' dropped) so "plans" matches "plan".
// Deterministic; used by the knowledge matcher for both the query and the docs.
function salientTokens(lower: string): Set<string> {
  const out = new Set<string>();
  for (const raw of lower.split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    const folded = raw.length > 3 && raw.endsWith('s') ? raw.slice(0, -1) : raw;
    out.add(folded);
  }
  return out;
}

// The first sentence of a doc body (for composing a one-sentence answer). Strips
// a leading list marker ("- ", "• ") so a bulleted rules doc reads cleanly.
function firstSentence(body: string): string {
  const one = body.replaceAll(/\s+/g, ' ').trim().replace(/^[-•*]\s*/, '');
  const m = /^(.+?[.!?])(\s|$)/.exec(one);
  return (m ? m[1] : one).trim();
}

// Lowercase the first character of a fact so it reads naturally after "Yes {name},".
// Preserves an all-caps acronym lead (e.g. "EFT") — only single leading capitals
// get folded.
function lowerFirst(s: string): string {
  if (s.length < 2) return s.toLowerCase();
  if (s[0] === s[0].toUpperCase() && s[1] === s[1].toLowerCase()) {
    return s[0].toLowerCase() + s.slice(1);
  }
  return s;
}

// Split text into ~size-char chunks on paragraph/line boundaries where possible,
// mirroring a simple platform chunker. Never returns an empty array.
function chunkText(text: string, size: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= size) return [trimmed];
  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > size) {
    // Prefer a break at the last newline before the cap; else a space; else hard.
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = rest.lastIndexOf(' ', size);
    if (cut < size * 0.5) cut = size;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks.length > 0 ? chunks : [trimmed.slice(0, size)];
}

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

// The provider's real text-back pipeline dedupes identical auto-acks on
// line + recipient within a 6-hour window: a caller who already got the
// missed-call acknowledgement does NOT get re-texted the same line minutes
// later. We model that here so repeated clicks read as a system behaving
// correctly (the call still shows; the ack is suppressed honestly).
const MISSED_CALL_DEDUPE_MS = 6 * 60 * 60_000;
// The body of the auto-ack the missed-call playbook sends. A prior send of THIS
// line inside the dedupe window is what suppresses a fresh one.
const MISSED_CALL_ACK_BODY =
  "Hey, sorry we missed you! This is Hartley Insurance's text line. What can we help with?";

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

// Pick the delivered-as channel with the SAME policy the platform enforces
// (services.resolveChannelPreference, round-22): SMS opens the door, iMessage
// carries the conversation. A non-iMessage contact is always SMS. An iMessage-
// capable contact still gets SMS on the FIRST outbound — before they have
// replied — because a cold iMessage open is rate-limited and deliverability-
// risky; once they reply (an inbound lands on the thread) the channel upgrades
// to iMessage. So a missed-call auto-ack goes out SMS, and the reply after the
// customer answers rides iMessage — visible via the bubble's ChannelBadge.
function pickChannel(t: { contactId: string; messages: { direction: string }[] }): Exclude<Channel, null> {
  const c = contactById(t.contactId);
  if (!c?.imessageCapable) return 'sms';
  const hasReplied = t.messages.some((m) => m.direction === 'inbound');
  return hasReplied ? 'imessage' : 'sms';
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

  // The tenant identity card — the pinned Hartley fixtures, so the demo sidebar
  // reads exactly as it always has (name + the same line number).
  tenant(): Promise<{ name: string; line: string }> {
    // Pinned fixtures, not a network read — resolve immediately so the sidebar
    // identity paints without a flash (the value is known up front).
    return Promise.resolve({ name: TENANT_NAME, line: LINE_DISPLAY });
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

  // Memory evolution (r20) — the demo's deterministic stand-in for the platform
  // extractor (agents/memory.ts). Same observable contract: a fact only ever
  // derives from words ACTUALLY in the customer's text (each rule is a regex
  // over it — the demo analogue of the verbatim-evidence gate), duplicates are
  // skipped, the learn is audited, and memory.changed announces it so Contacts
  // and the open thread's brief update live.
  private learnFromText(contactId: string, conversationId: string, text: string): void {
    const c = contactById(contactId);
    if (!c) return;
    const lower = text.toLowerCase();
    const learned: string[] = [];

    const timeMatch = lower.match(/\bafter (\d{1,2}\s?(?:am|pm))\b/);
    if (timeMatch) learned.push(`Prefers contact after ${timeMatch[1]}`);
    if (/\b(?:son|daughter)\b[^.!?]*\b(?:license|permit|driver)/.test(lower)) {
      learned.push('Has a newly licensed teen driver in the household');
    }
    const soldMatch = lower.match(/\bsold (?:the|our|my) (boat|car|truck|rv|motorcycle)\b/);
    if (soldMatch) learned.push(`Sold their ${soldMatch[1]}`);
    const newMatch = lower.match(/\b(?:bought|got|getting|buying) a new (car|truck|house|home|boat)\b/);
    if (newMatch) learned.push(`Recently added a new ${newMatch[1]}`);

    let changed = false;
    for (const value of learned.slice(0, 3)) {
      const dup = c.memory.some((m) => m.value.toLowerCase() === value.toLowerCase());
      if (dup) continue;
      c.memory.push({ value, source: 'conversation' });
      this.appendAudit('memory_agent', 'memory_learned', value);
      changed = true;
    }
    if (changed) this.emit({ type: 'memory.changed', contactId, conversationId });
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
  // Snapshot of a contact's consent scopes taken at opt-out time, so a later
  // record correction (r16) can restore the FULL prior scopes — including
  // marketing — because a correction says the opt-out never validly happened.
  // Seeded for the fixture-opted-out contacts from their fixture consents.
  private priorConsents = new Map<string, Set<string>>(
    CONTACTS.filter((c) => c.optedOut).map((c) => [c.id, new Set(c.consents)]),
  );
  // Messages-first thread (v4): the per-conversation Agent ON/OFF switch, seeded
  // from the fixtures' controller (all fixture threads are agent-controlled →
  // enabled). Absent from the map means "not yet toggled" — default enabled.
  // OFF stands the agent down (no typing/drafts on inbound) but the composer and
  // an assistive suggestion stay available.
  private agentEnabled = new Map<string, boolean>();
  // Steering (r10): per-conversation goal the human set for the agent, with an
  // optional free-text note. Absent = no steer. null goal clears it. The steer
  // engine reads this; the suggestion engine weaves it in naturally.
  private steers = new Map<string, { goal: SteerGoal; note?: string }>();
  // How many rungs a FRESH steer resets — one steer credit per conversation that
  // lets a rung-2 "wait" state produce one more (steered) suggestion, because the
  // human explicitly asked for an action. Consumed once the steered suggestion is
  // computed at a rung the ladder would otherwise silence; re-armed on each steer.
  private steerResetArmed = new Set<string>();
  // Knowledge-driven drafting (r19): the title of the knowledge doc that grounded
  // the pending held draft on a conversation, if any. suggestion() surfaces it as
  // a "From your knowledge: {title}" rationale on the held draft. Set when a
  // knowledge-answer draft is created; cleared when the next draft has no doc hit.
  private draftKnowledgeSource = new Map<string, string>();
  // Agent flows (r10): tenant-wide playbook on/off state (default all enabled).
  // Absent from the map means "not yet toggled" → enabled. A disabled playbook
  // stops producing drafts/acks in the choreography and drops from the briefing.
  private playbookEnabled = new Map<string, boolean>();
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
    const channel = pickChannel(t);
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

  // ── Steering (r10) ──────────────────────────────────────────────────────────
  // The human sets a per-conversation goal the agent works toward — book a time,
  // take a payment, collect a missing fact, or request a document — with an
  // optional free-text note. null clears it. The suggestion engine reads this
  // and weaves it in NATURALLY (never a canned line). A FRESH steer re-arms one
  // ladder-reset credit (the human explicitly asked for an action, so a rung-2
  // "wait" may yield one more steered suggestion). Emits steer.changed +
  // suggestion.updated so the composer's suggestion re-weaves the goal.
  async steer(conversationId: string, goal: SteerGoal | null, note?: string): Promise<void> {
    const t = this.threads.get(conversationId);
    if (!t) throw new Error('not found');
    if (goal === null) {
      this.steers.delete(conversationId);
      this.steerResetArmed.delete(conversationId);
      this.appendAudit('owner', 'steer_cleared', conversationId);
    } else {
      const trimmed = note?.trim();
      this.steers.set(conversationId, trimmed ? { goal, note: trimmed } : { goal });
      // A fresh steer resets one rung — arm the credit.
      this.steerResetArmed.add(conversationId);
      this.appendAudit('owner', 'steer_set', trimmed ? `${goal}:${trimmed}` : goal);
    }
    this.emit({ type: 'steer.changed', conversationId });
    this.emit({ type: 'suggestion.updated', conversationId });
    await delay(undefined);
  }

  // Whether a playbook is ON for the tenant (default enabled until toggled off).
  private isPlaybookEnabled(key: string): boolean {
    return this.playbookEnabled.get(key) ?? true;
  }

  // Turn a playbook on/off for the whole tenant (session state). A disabled
  // playbook stops producing drafts/acks in the inbound + missed-call choreography
  // and drops out of the home briefing. Emits playbook.toggled.
  async setPlaybookEnabled(key: string, enabled: boolean): Promise<void> {
    this.playbookEnabled.set(key, enabled);
    this.appendAudit('owner', 'playbook_toggled', `${key}:${enabled ? 'on' : 'off'}`);
    this.emit({ type: 'playbook.toggled', key, enabled });
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
      // An inbound landed → the next-best suggestion regenerates for EVERY case
      // below (STOP/START consent flip, agent-ON draft path, agent-OFF assistive
      // path). Agent-ON additionally re-fires after the held draft is created.
      this.emit({ type: 'suggestion.updated', conversationId });

      if (isStop) {
        // Only the FIRST opt-out records a system entry + consent event; a
        // repeated STOP records the inbound bubble only (the bug being fixed).
        if (!wasOptedOut) {
          // Snapshot the scopes we're revoking so a later record correction can
          // restore the FULL prior consent (a correction says it never happened).
          this.priorConsents.set(t.contactId, new Set(this.consentScopes(t.contactId)));
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

      // Memory evolution (r20): the demo mirror of the platform's learning path.
      // The real backend extracts durable facts with an LLM behind a verbatim-
      // evidence grounding gate; the demo keeps the same OBSERVABLE behavior with
      // deterministic rules — a fact is only ever derived from words actually in
      // the text, deduped against the board, and announced via memory.changed.
      this.learnFromText(t.contactId, conversationId, body);

      // Normal message. Agent ON + not-opted-out → the existing typing→held-draft
      // flow (agent typing ~900ms in, then typing stopped + draft.created). Agent
      // OFF → NO agent typing/draft, but the suggestion already regenerated above
      // so the human sees a fresh assistive suggestion (held: false). Opted out →
      // silent (the suggestion() will resolve to null). If the playbook governing
      // this reply is turned OFF, the agent stays quiet too (no draft) — the
      // suggestion still refreshed above so the human keeps an assistive slot.
      const replyPlaybook = this.inboundReplyPlaybookKey(t);
      if (
        !this.optedOut.has(t.contactId) &&
        this.isAgentEnabled(conversationId) &&
        this.isPlaybookEnabled(replyPlaybook)
      ) {
        setTimeout(() => {
          this.emit({ type: 'typing', conversationId, who: 'agent', state: 'typing' });
        }, AGENT_TYPING_START_MS - CUSTOMER_TYPING_MS);

        setTimeout(() => {
          this.emit({ type: 'typing', conversationId, who: 'agent', state: 'stopped' });
          // One refreshing draft, not a stack: a new inbound while a draft is
          // pending REPLACES it. Count the run of unanswered inbounds BEFORE
          // clearing so the fresh draft can acknowledge a frustration run, then
          // drop the stale draft and append one classified on the LATEST message.
          const run = this.trailingUnansweredInbounds(t);
          this.clearHeldDrafts(t);
          const draft = this.appendHeldDraft(t, text, run);
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
    status: 'opted_out' | 'opted_back_in' | 'optout_corrected',
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

  // The most recent missed-call auto-ack on this thread that is still inside the
  // 6-hour dedupe window, or null. Matches the ack line the playbook sends — so a
  // later inbound reply (or any other outbound) does not defeat the dedupe.
  private lastMissedCallAck(t: FixtureThread): FixtureMessage | null {
    const nowMs = this.now() + this.clockMin * 60_000;
    for (let i = t.messages.length - 1; i >= 0; i -= 1) {
      const m = t.messages[i];
      if (m.direction === 'outbound' && m.status === 'sent' && m.body === MISSED_CALL_ACK_BODY) {
        const ageMs = nowMs - new Date(m.created_at).getTime();
        return ageMs <= MISSED_CALL_DEDUPE_MS ? m : null;
      }
    }
    return null;
  }

  // A centered timeline entry noting the auto-ack was suppressed by the dedupe
  // window (the provider re-texts nobody the same line inside 6 hours). Carries
  // the honest "N minutes ago" in its body; rendered as a system event, not a
  // bubble (isSystemEvent matches the 'suppressed_duplicate' status).
  private appendSuppressedDuplicate(t: FixtureThread, agoMin: number): FixtureMessage {
    const m: FixtureMessage = {
      id: `msg_sys_suppressed_${t.messages.length + 1}_${t.conversationId}`,
      direction: 'outbound',
      body: `Text-back suppressed · already texted ${agoMin}m ago`,
      status: 'suppressed_duplicate',
      channel_accepted: null,
      advice_verdict: 'none',
      classification: 'transactional',
      created_at: this.stamp(),
    };
    t.messages.push(m);
    return m;
  }

  // A held reply draft the agent proposes to a normal inbound — awaiting the
  // operator's approval (the DraftCard money component picks this up). The body
  // is CONTENT-AWARE: classified on the latest inbound (mirrors the suggestion
  // engine's tiers) and run-aware (a frustration run of ≥2 unanswered inbounds
  // gets a "we're on it" prefix), never the old context-blind "good question!".
  private appendHeldDraft(t: FixtureThread, inboundText: string, run = 1): FixtureMessage {
    const c = contactById(t.contactId);
    const first = c?.name.split(' ')[0] ?? 'there';
    const { body, sourceTitle } = this.classifyReplyDraft(c, first, inboundText, run);
    // Remember which knowledge doc (if any) grounded this draft, so suggestion()
    // can surface a "From your knowledge: {title}" rationale on the held draft.
    // A knowledge hit is keyed by conversation and cleared when no doc matched, so
    // deleting the FAQ and re-simulating flips the rationale off (round-trips).
    if (sourceTitle) this.draftKnowledgeSource.set(t.conversationId, sourceTitle);
    else this.draftKnowledgeSource.delete(t.conversationId);
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

  // Count the RUN of unanswered customer inbounds at the tail of the thread —
  // consecutive inbound messages with no outbound `sent` after them. A prior
  // send (or the start of the thread) resets the run. Held drafts and centered
  // system entries are skipped (they are not answers the customer received).
  private trailingUnansweredInbounds(t: FixtureThread): number {
    let count = 0;
    for (let i = t.messages.length - 1; i >= 0; i -= 1) {
      const m = t.messages[i];
      if (m.direction === 'outbound' && m.status === 'sent') break; // an answer resets the run
      if (m.direction === 'inbound' && m.status === 'received') count += 1;
      // else: a held draft or centered system entry — skip it.
    }
    return count;
  }

  // Content-aware reply-draft classifier (r18a). Mirrors the suggestion engine's
  // tiers so a held draft actually answers what the customer SAID. All bodies
  // obey the voice canon: warm business-casual, ≤2 sentences, ≤1 question, no em
  // dashes, the name used naturally, never "AI". A frustration/greeting run of
  // ≥2 unanswered inbounds prefixes a brief "we're on it" acknowledgement.
  private classifyReplyDraft(
    c: FixtureContact | undefined,
    first: string,
    inboundText: string,
    run: number,
  ): { body: string; sourceTitle?: string } {
    const raw = inboundText.trim();
    const text = raw.toLowerCase();
    const has = (...needles: string[]): boolean => needles.some((n) => text.includes(n));
    // A run of two-plus unanswered inbounds → a short thread-level acknowledgement
    // so the reply reads as caught-up, not context-blind. The frustration tier
    // handles the run itself (it already apologizes) so it never double-"Sorry"s.
    const isRun = run >= 2;
    const runPrefix = isRun ? `Sorry ${first}, we're on it. ` : '';

    // 1) Frustration / confusion → de-escalate, own it, offer the human. No
    //    exclamation marks in a de-escalation; no question stacking beyond one. On
    //    a run it leads with a caught-up acknowledgement instead of a second sorry.
    //    Tone tiers run FIRST — an angry outburst is answered with de-escalation,
    //    not an FAQ paste, even if a knowledge keyword happens to appear.
    if (
      has('wtf', 'wth', 'ridiculous', 'unacceptable', 'frustrat', 'angry', 'annoyed', 'confus', 'terrible', 'useless') ||
      /\?\?|!!/.test(raw) ||
      has("what's going on", 'whats going on', 'what is going on', 'no one', 'nobody', 'still waiting', 'hello?')
    ) {
      const lead = isRun
        ? `Sorry ${first}, we're on it and I don't want to leave you hanging.`
        : `Sorry for the confusion, ${first}.`;
      return { body: `${lead} Tom can give you a straight answer today, want him to call you this afternoon?` };
    }

    // 2) Bare greeting → friendly, brief, one open question.
    const greetingOnly = /^(hey+|hi+|hello+|yo+|hiya|heya)[!.\s]*$/.test(text);
    if (greetingOnly) {
      return { body: `${runPrefix}Hey ${first}! What can we help with?` };
    }

    // 3) Thanks / positive → warm close, NO question. Matchers are word-anchored
    //    so a substring like "liabili-ty l-imits" never trips the thanks tier.
    if (
      has('thank', 'thanx', 'appreciate', 'sounds good', 'ok great', 'okay great', 'great, thanks') ||
      /\bthx\b|\bty\b/.test(text) ||
      /^(ok|okay|great|awesome|cool|perfect)[!.\s]*$/.test(text)
    ) {
      return { body: `${runPrefix}Anytime, ${first}. We're here when you need us.` };
    }

    // 3.5) KNOWLEDGE ANSWER (r19) — before the generic content tiers. A keyword
    //      match against the taught FAQ / company / rules docs lets the draft
    //      ANSWER FROM THE DOC in voice canon (affirmation + the doc's key fact
    //      trimmed to one sentence + one question), never a raw paste. Editing the
    //      FAQ body in the Knowledge tab changes what appears here — it round-trips.
    const knowledge = this.knowledgeAnswer(text, first, runPrefix);
    if (knowledge) return knowledge;

    // 4) Scheduling words → propose a concrete slot via the booking connection +
    //    memory (after-6pm etc.). One time offer, one question.
    if (has('call', 'tomorrow', 'time', 'book', 'schedule', 'meet', 'appointment', 'chat', 'talk')) {
      const afterSix =
        (c?.memory ?? []).some((m) => /after 6pm|evening/i.test(m.value));
      const slot = afterSix ? 'Thursday at 6:30' : 'Thursday at 2';
      return { body: `${runPrefix}Happy to set that up, ${first}. Tom has ${slot} open, does that work for you?` };
    }

    // 5) Price / renewal / rate question → the renewal-grounded reply. A HOUSE
    //    RULE about offering a call before quoting numbers (r19) biases the copy:
    //    when the rule is present we make the call the offer; deleting that rule
    //    softens it to pulling the rate without pushing the call. This reads the
    //    linkage from the rules doc, so removing the rule visibly changes behavior.
    if (has('price', 'cost', 'premium', 'rate', 'renew', 'quote', 'how much')) {
      const body = this.rulesFavorCallBeforeQuote()
        ? `${runPrefix}Good question on the numbers, ${first}. Tom can pull your latest rate today, want a quick call this week to run through it?`
        : `${runPrefix}Good question on the numbers, ${first}. Tom can pull your latest rate and text it right over.`;
      return { body };
    }

    // 6) Coverage / limits question → non-advisory, Tom-will-advise.
    if (has('coverage', 'limit', 'liability', 'deductible', 'covered', 'covers', 'policy')) {
      return { body: `${runPrefix}Great question, ${first}. Tom can walk you through what fits your situation, want a quick call this week to go over it?` };
    }

    // 7) Default → a grounded acknowledgement that QUOTES their actual words,
    //    never the old generic "good question!" for a non-question.
    return { body: `${runPrefix}On "${this.trim(raw, 48)}", let me get you a real answer, ${first}. Tom can confirm the details today.` };
  }

  // ── Knowledge-driven drafting (r19) ─────────────────────────────────────────
  // Score the taught FAQ / company / rules docs against the inbound and, on a
  // confident hit, compose an answer IN VOICE from the winning doc. Deterministic
  // keyword scoring (no deps): tokens from the doc title weigh most, salient body
  // tokens next; the inbound's own tokens are the query. A hit must clear a small
  // threshold so an unrelated inbound never triggers a knowledge answer. The
  // composed body is affirmation + the doc's key fact (its first sentence, trimmed
  // to ≤1 sentence) + one question — NEVER the raw doc. Returns the composed body
  // plus the doc title (for the "From your knowledge" rationale), or null.
  private knowledgeAnswer(
    lowerInbound: string,
    first: string,
    runPrefix: string,
  ): { body: string; sourceTitle: string } | null {
    const queryTokens = salientTokens(lowerInbound);
    if (queryTokens.size === 0) return null;

    const docs = this.readBrainStore().docs.filter(
      (d) => d.kind === 'faq' || d.kind === 'company' || d.kind === 'rules',
    );
    let best: { doc: KnowledgeDoc; score: number } | null = null;
    for (const doc of docs) {
      const titleTokens = salientTokens(doc.title.toLowerCase());
      const bodyTokens = salientTokens(doc.body.toLowerCase());
      let score = 0;
      for (const q of queryTokens) {
        if (titleTokens.has(q)) score += 3; // a title-token overlap is the strongest signal
        else if (bodyTokens.has(q)) score += 1;
      }
      if (score > 0 && (best === null || score > best.score)) best = { doc, score };
    }
    // Threshold: need at least a title-token overlap (score ≥3) or two body
    // overlaps (score ≥2) so a single incidental word never answers from a doc.
    if (!best || best.score < 2) return null;

    const fact = firstSentence(best.doc.body);
    if (!fact) return null;
    // Compose: affirmation + the doc's key fact trimmed to one sentence + one
    // question, in voice canon (warm, ≤2 sentences, no em dashes). We never paste
    // the raw doc; `fact` is its lead sentence, lightly trimmed.
    // Strip a leading affirmation from the doc itself ("Yes, ..." / "Yes we...")
    // so the composed "Yes {name}, ..." never doubles it ("Yes Dana, yes, ...").
    const deduped = fact.replace(/^yes[,!.]?\s+/i, '');
    const trimmedFact = this.trim(deduped, 150);
    const body = `${runPrefix}Yes ${first}, ${lowerFirst(trimmedFact)} Want Tom to set that up on your policy?`;
    return { body, sourceTitle: best.doc.title };
  }

  // True when a house rule tells the agent to offer a CALL before quoting numbers.
  // The price tier reads this so DELETING the rule visibly changes the draft (the
  // call offer softens to a text-the-rate line). Scans the rules docs' bodies for
  // the "call before quot(e/ing)" intent — resilient to light rewording.
  private rulesFavorCallBeforeQuote(): boolean {
    const rules = this.readBrainStore().docs.filter((d) => d.kind === 'rules');
    return rules.some((d) => {
      const b = d.body.toLowerCase();
      return b.includes('call') && (b.includes('quot') || b.includes('number') || b.includes('price'));
    });
  }

  // Resume via START restores transactional consent only; marketing stays
  // revoked (real compliance: resuming does not re-grant marketing express
  // consent). Mutates the session consent view backing getThread/contacts.
  private restoreTransactionalOnly(contactId: string): void {
    const scopes = this.consentScopes(contactId);
    scopes.add('transactional');
    scopes.delete('marketing');
  }

  // Correct an opt-out record made in error (r16). This is NOT a per-contact gate
  // off-switch — a real customer STOP must stand; it is the business fixing a
  // wrong record (a wrong number, an internal test, a mistaken entry) with a
  // reason + audit. It clears optedOut and restores the FULL prior consent scopes
  // (incl. marketing — a correction says the opt-out never validly happened,
  // unlike a customer START which restores transactional only). Writes one
  // 'optout_corrected' timeline entry + a consent.changed + suggestion.updated,
  // and audits action 'optout.corrected' with the reason. A blank reason is
  // refused (fail-closed: a correction always carries a written justification).
  async correctOptOut(contactId: string, reason: string): Promise<{ ok: boolean }> {
    const trimmed = reason.trim();
    if (trimmed.length === 0) return delay({ ok: false });
    // No-op if the contact isn't actually opted out (nothing to correct).
    if (!this.optedOut.has(contactId)) return delay({ ok: false });

    this.optedOut.delete(contactId);
    // Restore the FULL prior scopes (marketing included). Fall back to the
    // fixture consents if we have no snapshot (a seeded opt-out we never STOPped).
    const prior = this.priorConsents.get(contactId) ?? new Set(contactById(contactId)?.consents ?? []);
    this.consents.set(contactId, new Set(prior));
    this.priorConsents.delete(contactId);

    // Record the correction on the contact's thread (if one exists) as a calm
    // centered timeline entry, and audit it.
    const t = [...this.threads.values()].find((thr) => thr.contactId === contactId);
    if (t) {
      this.appendSystem(t, 'optout_corrected', 'Opt-out record corrected by Hartley Insurance');
    }
    this.appendAudit('owner', 'optout.corrected', trimmed);

    const conversationId = t?.conversationId ?? `cv_${contactId}`;
    this.emit({ type: 'consent.changed', conversationId, contactId, optedOut: false });
    this.emit({ type: 'suggestion.updated', conversationId });
    return delay({ ok: true });
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

    // Dedupe like the provider's real pipeline: if THIS caller already got the
    // missed-call auto-ack within the 6-hour window, the call still shows (above)
    // and call.missed still fired, but we do NOT re-text the same line minutes
    // apart. Append ONE quiet suppression entry ("Text-back suppressed · already
    // texted {N}m ago") instead. No new conversation is minted (it reuses Ray's).
    const priorAck = this.lastMissedCallAck(t);
    if (priorAck) {
      const agoMs = this.now() + this.clockMin * 60_000 - new Date(priorAck.created_at).getTime();
      const agoMin = Math.max(1, Math.round(agoMs / 60_000));
      const entry = this.appendSuppressedDuplicate(t, agoMin);
      this.appendAudit('missed_call_agent', 'text_back_suppressed', `dedupe_6h ${agoMin}m`);
      this.emit({ type: 'message.sent', conversationId, message: this.toThreadMessage(entry) });
      this.emit({ type: 'suggestion.updated', conversationId });
      return delay({ conversationId });
    }

    // If the caller opted out — or the missed-call playbook is turned OFF — the
    // playbook stays silent (no typing, no text-back). The conversation was still
    // minted above so the missed call is visible; it just won't auto-answer.
    if (!this.optedOut.has(contactId) && this.isPlaybookEnabled('missed_call')) {
      setTimeout(() => {
        this.emit({ type: 'typing', conversationId, who: 'agent', state: 'typing' });
      }, MISSED_CALL_AGENT_TYPING_MS);

      setTimeout(() => {
        this.emit({ type: 'typing', conversationId, who: 'agent', state: 'stopped' });
        // The gate still runs (fail-closed): auto-send only on ALLOW.
        const decision = this.gate(contactId, 'transactional');
        this.appendAudit('send_gate', 'send_gate', decision.auditReason);
        if (decision.decision !== 'ALLOW') return;
        const channel = pickChannel(t!);
        const sent = this.appendSent(t!, MISSED_CALL_ACK_BODY, channel);
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
      // Render-don't-hide (r16): the gate REFUSED the send — surface it honestly
      // in the thread as a centered GateReason row (no bubble, nothing was sent)
      // rather than silently swallowing it. The composer keeps the typed text.
      const refusal = this.appendBlocked(t, decision.auditReason);
      this.emit({ type: 'message.sent', conversationId, message: this.toThreadMessage(refusal) });
      // Keep state coherent so the suggestion slot re-resolves (null when opted out).
      this.emit({ type: 'suggestion.updated', conversationId });
      return delay({ ok: false, blockedReason: decision.auditReason });
    }
    const channel = pickChannel(t);
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
    // The pending draft is gone → drop any knowledge-source tag for it (r19), so a
    // stale "From your knowledge" rationale never outlives the draft it described.
    this.draftKnowledgeSource.delete(t.conversationId);
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
    const channel = pickChannel(t);
    const ask = this.appendSent(
      t,
      `Could you text over a quick photo of your ${docType}? A phone pic works great.`,
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

  // Send a rich-link message from the business's side (booking / payment /
  // document-request). Gated exactly like sendManual (fail-closed: kill switch /
  // opt-out / consent). The provider natively unfurls the link into a preview
  // card, so the outbound carries a LinkPart alongside one short human sentence.
  // document_request delegates to the existing requestDocument (its own choreo).
  sendLink(
    conversationId: string,
    kind: 'booking' | 'payment' | 'document_request',
    docType?: string,
  ): Promise<{ ok: boolean; blockedReason?: string }> {
    const t = this.threads.get(conversationId);
    if (!t) return Promise.reject(new Error('not found'));

    // A document request is a link-shaped ask that reuses the media-reply flow.
    if (kind === 'document_request') {
      const type = docType ?? 'declarations page';
      // Pre-check the gate so we can report the block reason (requestDocument is
      // silent). On a clear gate, delegate and report ok.
      const decision = this.gate(t.contactId, 'transactional');
      if (decision.decision !== 'ALLOW') {
        this.appendAudit('send_gate', 'send_gate', decision.auditReason);
        return delay({ ok: false, blockedReason: decision.auditReason });
      }
      void this.requestDocument(conversationId, type);
      return delay({ ok: true });
    }

    // Booking / payment: gate first (fail-closed), then append a link outbound.
    const decision = this.gate(t.contactId, 'transactional');
    this.appendAudit('send_gate', 'send_gate', decision.auditReason);
    if (decision.decision !== 'ALLOW') {
      return delay({ ok: false, blockedReason: decision.auditReason });
    }

    const first = contactById(t.contactId)?.name.split(' ')[0] ?? 'there';
    const cal = BOOKING_CONNECTION.calendar; // "Tom Hartley — Renewal reviews"
    const link: LinkPart =
      kind === 'booking'
        ? {
            type: 'link',
            url: 'https://hartley.reloment.link/book',
            title: `Book with ${LICENSED_AGENT} · Renewal reviews`,
            domain: 'hartley.reloment.link',
          }
        : {
            type: 'link',
            url: 'https://hartley.reloment.link/pay',
            title: 'Pay your premium · Hartley Insurance',
            domain: 'hartley.reloment.link',
          };
    const body =
      kind === 'booking'
        ? `Here’s a link to grab time with Tom, ${first}. Pick whatever works for you.`
        : `Here’s a secure link to take care of your premium whenever you’re ready, ${first}.`;
    void cal;

    const channel = pickChannel(t);
    const sent = this.appendSentWithParts(t, body, channel, [link]);
    this.appendAudit('owner', 'message.sent', `link:${kind} channel:${channel}`);
    this.emit({ type: 'message.sent', conversationId, message: this.toThreadMessage(sent) });
    this.emit({ type: 'suggestion.updated', conversationId });
    return delay({ ok: true });
  }

  // Append a delivered outbound (status 'sent', channel set). Used by the auto
  // text-back, manual sends, and document requests.
  private appendSent(t: FixtureThread, body: string, channel: Exclude<Channel, null>): FixtureMessage {
    return this.appendSentWithParts(t, body, channel);
  }

  // Append a gate-refusal as a centered `blocked_<reason>` timeline entry (r16) —
  // a visible refusal for a send the gate would not permit (e.g. a manual send to
  // an opted-out contact). No bubble, nothing delivered; SystemEntry renders it as
  // the GateReason row style (isSystemEvent matches `blocked_` prefixes).
  private appendBlocked(t: FixtureThread, auditReason: string): FixtureMessage {
    const m: FixtureMessage = {
      id: `msg_blk_${t.messages.length + 1}_${t.conversationId}`,
      direction: 'outbound',
      body: '',
      status: `blocked_${auditReason}`,
      channel_accepted: null,
      advice_verdict: 'none',
      classification: 'transactional',
      created_at: this.stamp(),
    };
    t.messages.push(m);
    return m;
  }

  // Append a delivered outbound, optionally carrying rich parts (e.g. a LinkPart
  // preview card). One code path so link sends and plain sends stay consistent.
  private appendSentWithParts(
    t: FixtureThread,
    body: string,
    channel: Exclude<Channel, null>,
    parts?: MessagePart[],
  ): FixtureMessage {
    const m: FixtureMessage = {
      id: `msg_out_${t.messages.length + 1}_${t.conversationId}`,
      direction: 'outbound',
      body,
      status: 'sent',
      channel_accepted: channel,
      advice_verdict: 'none',
      classification: 'transactional',
      created_at: this.stamp(),
      ...(parts ? { parts } : {}),
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
      // Seeded history + live session enrollments — the same baseline
      // playbookFlows() reads, so the Agent tab and the Home artifact agree.
      const history = PLAYBOOK_HISTORY[pb.key] ?? { enrolled: 0, sent: 0, replied: 0 };
      const enrolled =
        history.enrolled + this.enrollments.filter((e) => e.playbookKey === pb.key).length;
      return {
        key: pb.key,
        name: pb.name,
        classification: pb.classification,
        status: pb.status,
        enrolled,
        drafts_pending: this.playbookHeldCount(pb.name),
      };
    });
    return delay(rows);
  }

  // Gate-held drafts attributable to a playbook — counts enrolled drafts
  // (msg_pb_* ids) AND seeded/agent drafts via playbookLabelFor, so the Agent
  // flows and the Home campaign artifact report the same number (Dana's held
  // renewal draft counts toward Renewal reminder on both surfaces).
  private playbookHeldCount(name: string): number {
    let n = 0;
    for (const { msg } of this.allMessages()) {
      if (msg.status !== 'awaiting_approval') continue;
      if (this.playbookLabelFor(msg) === name) n += 1;
    }
    return n;
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

  // ── Agent asks — the agent reaches back to the business ─────────────────────
  // Deterministic 3–5 prompts the agent surfaces TO the producer: things it needs
  // to keep a conversation (or the tenant) moving. Recomputed cheaply on every
  // read from the SAME fixture + session state the rest of the client uses — no
  // new events, no invented facts. Order is stable (contact asks first, then
  // tenant asks), so the Home briefing can take the top N.
  async agentAsks(): Promise<AgentAsk[]> {
    return delay(this.computeAgentAsks());
  }

  private computeAgentAsks(): AgentAsk[] {
    const asks: AgentAsk[] = [];

    // Contact-scoped, grounded in live thread state.
    for (const t of this.threads.values()) {
      const c = contactById(t.contactId);
      if (!c || this.optedOut.has(c.id)) continue;
      const first = c.name.split(' ')[0];

      // Routed to a licensed human and still waiting → confirm the answer.
      if (t.messages.some((m) => m.status === 'routed_to_human')) {
        asks.push({
          id: `ask_confirm_${c.id}`,
          scope: 'contact',
          contactId: c.id,
          contactName: c.name,
          ask: `Confirm ${first}'s coverage-limit answer with a licensed producer`,
          why: 'Routed to a human — the reply is waiting on your sign-off before it can send.',
        });
      }

      // Auto+Home with an upcoming renewal → the bundle quote needs the dec page.
      const renewsSoon = c.xDateDays !== null && c.xDateDays >= 0 && c.xDateDays <= 45;
      if (c.lob === 'Auto+Home' && renewsSoon) {
        asks.push({
          id: `ask_dec_${c.id}`,
          scope: 'contact',
          contactId: c.id,
          contactName: c.name,
          ask: `Ask ${first} for the home declarations page`,
          why: 'Quoting the auto+home bundle at renewal needs the current dec page.',
        });
      }

      // A new-lead caller with no text consent on file → call them back (the gate
      // refuses texting an unconsented lead; a call is fine).
      if (c.status === 'new_lead' && this.consentScopes(c.id).size === 0) {
        asks.push({
          id: `ask_callback_${c.id}`,
          scope: 'contact',
          contactId: c.id,
          contactName: c.name,
          ask: `Have a licensed producer call ${first} back`,
          why: 'Called the line with no policy or text consent on file — a call is the only compliant reach.',
        });
      }
    }

    // Tenant-scoped, derived from real counts / connection status.
    const eveningCount = CONTACTS.filter(
      (c) =>
        !this.optedOut.has(c.id) &&
        c.memory.some((m) => /after 6pm|evening/i.test(m.value)),
    ).length;
    if (eveningCount > 0) {
      asks.push({
        id: 'ask_evening_slots',
        scope: 'tenant',
        ask: 'Add evening booking slots to Tom’s calendar',
        why: `${eveningCount} contact${eveningCount === 1 ? ' prefers' : 's prefer'} texts after 6pm — evening slots would land the review.`,
      });
    }

    // Voice training only surfaces if its connection needs attention (in the demo
    // fixtures it is connected, so this stays quiet — it fires honestly if not).
    const voice = this.connectionStatus('voice');
    if (voice === 'action_needed') {
      asks.push({
        id: 'ask_voice_training',
        scope: 'tenant',
        ask: 'Finish voice training so the agent writes in your producers’ voice',
        why: 'The voice-training connection needs attention before the agent sounds like Hartley.',
      });
    }

    // Keep the surface tight: at least 3 (never fewer than what's real), at most 5.
    return asks.slice(0, 5);
  }

  // The live status of a named connection row (composed from the same source as
  // connections()). Used by agentAsks to fire the Voice-training ask honestly.
  private connectionStatus(key: string): 'connected' | 'action_needed' {
    // The demo connections are all wired; this stays a single source of truth so
    // if a future fixture flips one to action_needed the ask follows automatically.
    void key;
    return 'connected';
  }

  // ── Home briefing — Home as a daily briefing ────────────────────────────────
  // One composed read for the Home surface. Every field derives from the SAME
  // session/fixture state the rest of the client reads — no new hardcoded stats.
  //   needsYou   — where the work is (approvals waiting → /inbox; asks → count)
  //   overnight  — plain-English one-liners of what the agent did (sent / held /
  //                blocked counts + missed calls answered, from the session)
  //   callOut    — the top 3 of the call list, each with one reason
  //   asks       — the top 3 agent asks
  async homeBriefing(): Promise<HomeBriefing> {
    // Approvals waiting = drafts awaiting approval + routed-to-human, exactly the
    // Inbox queue's definition (single source of truth).
    const approvalsWaiting = this.allMessages().filter(
      ({ msg }) => msg.status === 'awaiting_approval' || msg.status === 'routed_to_human',
    ).length;

    const asks = this.computeAgentAsks();

    const needsYou: HomeBriefing['needsYou'] = [];
    if (approvalsWaiting > 0) {
      needsYou.push({ label: 'Approvals waiting', count: approvalsWaiting, href: '/inbox' });
    }
    if (asks.length > 0) {
      needsYou.push({ label: 'Asks for you', count: asks.length, href: '/inbox' });
    }

    // Overnight recap — derived from the session audit log (what the agent
    // actually did), never a static list. Counts sends, holds/drafts, blocks,
    // and missed calls answered since the session began.
    const overnight = this.overnightLines();

    // Call-out — the top 3 of the ranked call list, each with its lead reason.
    const callList = await this.callList();
    const callOut = callList.slice(0, 3).map((r) => ({
      name: r.name,
      reason: r.reasons[0] ?? r.suggestedAction,
    }));

    return delay({ needsYou, overnight, callOut, asks: asks.slice(0, 3) });
  }

  // ── Activity derivation (single source of truth) ────────────────────────────
  // What the agent did this session, counted from the audit log (the record of
  // every governed action) + the message store. Home's overnight lines AND the
  // Insights WORK band both read this one helper — the numbers can never disagree.
  //   sent           — audit rows where the gate let a message go (message.sent)
  //   heldForReview  — drafts currently awaiting approval OR routed to a human
  //                    (= Home's "Approvals waiting" / the Inbox queue's count)
  //   blockedByGate  — send_gate rows the gate refused (not allow, not a hold)
  //   missedCallsAnswered — auto-ack sends on a missed-call inquiry basis
  //   preparedDrafts — draft-prep audit entries (used only by the overnight copy)
  private activityCounts(): {
    sent: number;
    heldForReview: number;
    blockedByGate: number;
    missedCallsAnswered: number;
    preparedDrafts: number;
  } {
    let sent = 0;
    let blockedByGate = 0;
    let missedCallsAnswered = 0;
    let preparedDrafts = 0;
    for (const a of this.auditLog) {
      if (a.reason.startsWith('auto_ack')) missedCallsAnswered += 1;
      if (a.action === 'message.sent') sent += 1;
      else if (a.action === 'draft.created' || a.action === 'draft_edited') preparedDrafts += 1;
      else if (a.action === 'send.blocked' || a.reason.startsWith('blocked_')) blockedByGate += 1;
      // A send_gate row that isn't an allow and isn't a quiet-hours HOLD is a block.
      else if (
        a.action === 'send_gate' &&
        a.reason !== 'allow' &&
        a.reason !== 'quiet_hours'
      ) {
        blockedByGate += 1;
      }
    }
    // "Approvals waiting" — the Inbox queue's definition (single source of truth).
    const heldForReview = this.allMessages().filter(
      ({ msg }) => msg.status === 'awaiting_approval' || msg.status === 'routed_to_human',
    ).length;
    return { sent, heldForReview, blockedByGate, missedCallsAnswered, preparedDrafts };
  }

  // Median minutes between an inbound and the NEXT outbound sent on the same
  // conversation, across the whole store. null when there are no inbound→outbound
  // pairs to measure. Deterministic (fixture timestamps are fixed offsets).
  private medianFirstReplyMin(): number | null {
    const gaps: number[] = [];
    for (const t of this.threads.values()) {
      const ordered = [...t.messages].sort((a, b) => a.created_at.localeCompare(b.created_at));
      let pendingInboundAt: number | null = null;
      for (const m of ordered) {
        if (m.direction === 'inbound') {
          if (pendingInboundAt === null) pendingInboundAt = Date.parse(m.created_at);
        } else if (m.direction === 'outbound' && m.status === 'sent' && pendingInboundAt !== null) {
          const gapMs = Date.parse(m.created_at) - pendingInboundAt;
          if (gapMs >= 0) gaps.push(gapMs / 60_000);
          pendingInboundAt = null;
        }
      }
    }
    if (gaps.length === 0) return null;
    gaps.sort((a, b) => a - b);
    const mid = Math.floor(gaps.length / 2);
    const median =
      gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
    return Math.max(1, Math.round(median));
  }

  // Plain-English one-liners of what the agent did this session, over the same
  // activityCounts() the Insights WORK band reads. No hardcoded stats.
  private overnightLines(): string[] {
    const { sent, heldForReview, blockedByGate, missedCallsAnswered, preparedDrafts } =
      this.activityCounts();

    const lines: string[] = [];
    if (sent > 0) lines.push(`Sent ${sent} message${sent === 1 ? '' : 's'} through the send gate.`);
    if (heldForReview > 0) {
      lines.push(`Held ${heldForReview} draft${heldForReview === 1 ? '' : 's'} for your approval.`);
    } else if (preparedDrafts > 0) {
      lines.push(`Prepared ${preparedDrafts} draft${preparedDrafts === 1 ? '' : 's'} for review.`);
    }
    if (missedCallsAnswered > 0) {
      lines.push(
        `Answered ${missedCallsAnswered} missed call${missedCallsAnswered === 1 ? '' : 's'} with a gated text-back.`,
      );
    }
    if (blockedByGate > 0) {
      lines.push(`Blocked ${blockedByGate} send${blockedByGate === 1 ? '' : 's'} the gate refused.`);
    }
    if (lines.length === 0) lines.push('Quiet overnight — nothing needed sending.');
    return lines;
  }

  // ── Insights report (r14) — the owner's report ──────────────────────────────
  // PROOF is the outcome ledger (read by the screen via outcomes()/home()). This
  // read composes WORK (activityCounts + median first reply) and PIPELINE (from
  // the book): renewals in 0–30d, reactivation candidates (lapsed quotes that
  // still hold valid marketing consent and aren't opted out), and bundle
  // candidates (auto-only ACTIVE customers). Each pipeline list caps at 3 with an
  // overflow count. Names carry a direct href to their thread (or contacts book).
  async insightsReport(): Promise<InsightsReport> {
    const counts = this.activityCounts();
    // The report covers the same period as the outcome ledger, so Sent counts
    // every outbound `sent` in the store (seeded history + session) — unlike
    // the Home "Overnight" line, which is scoped to session audit activity.
    const sentAllTime = this.allMessages().filter(
      ({ msg }) => msg.direction === 'outbound' && msg.status === 'sent',
    ).length;
    const activity: InsightsReport['activity'] = {
      conversations: this.threads.size,
      sent: sentAllTime,
      heldForReview: counts.heldForReview,
      blockedByGate: counts.blockedByGate,
      missedCallsAnswered: counts.missedCallsAnswered,
      medianFirstReplyMin: this.medianFirstReplyMin(),
    };

    // A direct href for a contact — their live thread if one exists, else the book.
    const hrefFor = (contactId: string): string => {
      const conv =
        [...this.threads.values()].find((t) => t.contactId === contactId) ??
        threadByContactId(contactId);
      return conv
        ? `/inbox?c=${encodeURIComponent(conv.conversationId)}`
        : `/contacts?c=${encodeURIComponent(contactId)}`;
    };

    // Renewals — anything renewing in the next 0–30 days, nearest first.
    const renewalsAll = CONTACTS.filter(
      (c) => c.xDateDays !== null && c.xDateDays >= 0 && c.xDateDays <= 30,
    )
      .sort((a, b) => (a.xDateDays ?? 0) - (b.xDateDays ?? 0))
      .map((c) => ({ name: c.name, days: c.xDateDays as number, href: hrefFor(c.id) }));

    // Reactivation — lapsed quotes that still hold VALID marketing consent and
    // aren't opted out (exactly who the win-back playbook can legally re-engage).
    const reactivationAll = CONTACTS.filter(
      (c) =>
        c.status === 'lapsed_quote' &&
        !c.optedOut &&
        this.consentScopes(c.id).has('marketing'),
    )
      .sort((a, b) => (b.xDateDays ?? -9999) - (a.xDateDays ?? -9999)) // most-recently lapsed first
      .map((c) => ({
        name: c.name,
        reason: 'Quote lapsed — marketing consent still valid',
        href: hrefFor(c.id),
      }));

    // Bundle — auto-only ACTIVE customers (a home policy is the cross-sell).
    const bundleAll = CONTACTS.filter((c) => c.lob === 'Auto' && c.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({
        name: c.name,
        reason: 'Auto only — no home policy',
        href: hrefFor(c.id),
      }));

    const CAP = 3;
    const pipeline: InsightsReport['pipeline'] = {
      renewals30d: renewalsAll.slice(0, CAP),
      reactivation: reactivationAll.slice(0, CAP),
      bundle: bundleAll.slice(0, CAP),
      more: {
        renewals30d: Math.max(0, renewalsAll.length - CAP),
        reactivation: Math.max(0, reactivationAll.length - CAP),
        bundle: Math.max(0, bundleAll.length - CAP),
      },
    };

    return delay({ activity, pipeline });
  }

  // ── Voice/tone profile & booking connection ─────────────────────────────────
  // toneProfile() now READS the live voice store (r13) for its traits, so an edit
  // on the Agent → Voice segment flows straight into every surface that reads it.
  // trainedOn + the before/after example stay fixture-derived (the demo doesn't
  // retrain the example prose from edits — see agentProfile()).
  toneProfile(): Promise<ToneProfile> {
    const voice = this.readBrainStore().voice;
    return delay({
      trainedOn: TONE_PROFILE.trainedOn,
      traits: [...voice.traits],
      example: { generic: TONE_PROFILE.example.generic, tuned: TONE_PROFILE.example.tuned },
    });
  }

  // ── Agent profile (r10 → r13 editable) — the "Agent" surface's identity card ─
  // ONE agent per business (Intercom-Fin shape) that switches roles across flows.
  // r13: the name + traits now DERIVE FROM THE LIVE VOICE STORE — editing them on
  // the Voice segment updates the profile immediately (the demo proves training
  // changes the agent's identity). trainedOn, the before/after example, and the
  // fixed guardrails stay grounded (the drafting bodies keep their templates; what
  // moves is the agent's stated identity). The "tuned" example header reads "Your
  // agent" in the UI. line + guardrails are fixed.
  agentProfile(): Promise<AgentProfile> {
    const voice = this.readBrainStore().voice;
    const guardrails = [
      'Never gives coverage or legal advice — routes to a licensed human',
      'Only texts people with consent on file — the gate refuses everything else',
      'Respects quiet hours in the customer’s timezone',
      'STOP always sticks — only the customer can opt back in',
    ];
    return delay({
      name: voice.name,
      // Human-formatted, derived from LINE_E164 — the same string Settings and
      // the tenant card show, so the line never renders as two numbers.
      line: LINE_DISPLAY,
      trainedOn: TONE_PROFILE.trainedOn,
      traits: [...voice.traits],
      example: { generic: TONE_PROFILE.example.generic, tuned: TONE_PROFILE.example.tuned },
      guardrails,
    });
  }

  // ── Playbook flows (r10) — playbooks reshaped for the merged Agent tab ──────
  // Each playbook reads as a plain-language FLOW: when it fires, who it reaches,
  // what the message does, and how much autonomy it has (plain "Review before
  // sending" vs "Sends automatically"). Derived from PLAYBOOKS + the SAME
  // enrollment/store campaignStatus() reads (single source of truth), with the
  // session on/off state layered in.
  async playbookFlows(): Promise<PlaybookFlow[]> {
    const status = await this.campaignStatus(); // same store, single source
    const byKey = new Map(status.map((s) => [s.key, s]));

    // Plain-language trigger / audience / message-approach per playbook key.
    const copy: Record<string, { when: string; who: string; what: string }> = {
      renewal_reminder: {
        when: 'A policy is 30 days from renewal',
        who: 'Customers with a renewal coming up',
        what: 'A warm heads-up that offers Tom’s time to review options first.',
      },
      speed_to_lead: {
        when: 'A new lead asks for a quote',
        who: 'Fresh inbound leads',
        what: 'A quick, friendly reply that offers to pull their numbers today.',
      },
      winback_lapsed: {
        when: 'A quote lapsed but consent is still valid',
        who: 'Dead leads whose marketing consent still holds',
        what: 'A light nudge that rates have moved and it’s worth a fresh look.',
      },
      missed_call: {
        when: 'Someone calls and we miss it',
        who: 'Callers to the messaging-only line',
        what: 'An instant, apologetic text-back that asks how we can help.',
      },
      bundle_upsell: {
        when: 'An auto-only customer could bundle',
        who: 'Insured auto-only customers with no home policy',
        what: 'A gentle mention that bundling home usually trims both premiums.',
      },
    };

    const flows: PlaybookFlow[] = PLAYBOOKS.map((pb) => {
      const s = byKey.get(pb.key);
      const enabled = this.isPlaybookEnabled(pb.key);
      // autonomy: only the missed-call ack auto-sends within its ceiling; every
      // other playbook is draft-for-approval ("Review before sending").
      const auto = pb.autonomy === 'auto_send_ack';
      const c = copy[pb.key] ?? {
        when: pb.trigger ?? 'On a matching signal',
        who: 'Matching contacts',
        what: pb.description ?? pb.name,
      };
      return {
        key: pb.key,
        name: pb.name,
        enabled,
        when: c.when,
        who: c.who,
        what: c.what,
        autonomy: auto ? 'auto' : 'review',
        autonomyLabel: auto ? 'Sends automatically (still gated)' : 'Review before sending',
        stats: {
          // campaignStatus already folds in the seeded history for enrolled and
          // the label-based held count; sent/replied add history to the live
          // session-attributed counts.
          enrolled: s?.enrolled ?? 0,
          sent:
            (PLAYBOOK_HISTORY[pb.key]?.sent ?? 0) + this.playbookSentCount(pb.key),
          replied:
            (PLAYBOOK_HISTORY[pb.key]?.replied ?? 0) + this.playbookRepliedCount(pb.key),
          heldBack: s?.drafts_pending ?? 0,
        },
      };
    });
    return delay(flows);
  }

  // Sent count attributable to a playbook — outbound `sent` messages whose id
  // carries the playbook key (enrolled drafts that were later approved) plus, for
  // the missed-call flow, the auto-ack sends. Derived from the store (no fixture
  // stat), so it moves as the demo loop runs.
  private playbookSentCount(key: string): number {
    let n = 0;
    for (const { msg } of this.allMessages()) {
      if (msg.direction !== 'outbound' || msg.status !== 'sent') continue;
      if (msg.id.includes(`_${key}_`) || msg.id.startsWith(`msg_pb_${key}_`)) n += 1;
    }
    return n;
  }

  // Replied count — threads carrying a playbook-attributed outbound that got a
  // later customer inbound. Cheap heuristic over the store; single source only.
  private playbookRepliedCount(key: string): number {
    let n = 0;
    for (const t of this.threads.values()) {
      const idx = t.messages.findIndex(
        (m) => m.direction === 'outbound' && (m.id.includes(`_${key}_`) || m.id.startsWith(`msg_pb_${key}_`)),
      );
      if (idx >= 0 && t.messages.slice(idx + 1).some((m) => m.direction === 'inbound')) n += 1;
    }
    return n;
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
        detail: `${LINE_DISPLAY} · texts send as Hartley Insurance`,
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
  // no Math.random. Tiers:
  //   (a) opted out → null (the gate would refuse every outbound anyway).
  //   (b) a held draft exists → THAT draft is the suggestion (held: true), with
  //       its playbook label and rationale drawn from the contact's data.
  //   (c) FOLLOW-UP LADDER — when the last message is OUR own unanswered
  //       outbound (the agent's or the human's; the agent treats human turns as
  //       its own), we do NOT re-pitch. Rung 1 (one unanswered outbound, ≥1h
  //       old): a shorter DIFFERENT-ANGLE nudge grounded in memory atoms. Rung 2
  //       (two unanswered outbounds): null — a good producer doesn't send a
  //       third text. Unanswered <1h: null (still fresh). A customer reply resets.
  //   (d) otherwise compute the next-best message from last-inbound keywords,
  //       renewal proximity, LOB gap, memory atoms, and policy_status — or null
  //       when a nudge would be pushy (closing/declined). "Silence is sometimes
  //       the best action."
  // HARD RULE (enforced by a FINAL check, not just by construction): never return
  // a body that already appears — normalized (trim + lowercase) — among the
  // thread's own outbound messages. The agent never repeats what it already sent.
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

    // The normalized set of bodies we've ALREADY sent as outbound (real sends,
    // not centered system entries). The final check reads from this so we never
    // hand back a message the thread already carries.
    const sentBodies = this.sentOutboundBodies(t);
    const norm = (s: string): string => s.trim().toLowerCase();

    // Steering (r10): the goal the human set on this thread, if any. When present
    // the suggestion works the goal in NATURALLY — a concrete time offer, a
    // payment nudge tied to real context, the missing-fact ask, or the document
    // ask — with an optional free-text note woven in. It still respects the ladder
    // and the anti-repeat rule; a FRESH steer resets one rung (a one-time credit).
    const steer = this.steers.get(conversationId) ?? null;

    // (b) A held draft awaiting approval IS the suggestion. Rationale is built
    // from the contact's real data (renewal proximity, memory atoms), not prose.
    const heldDraft = [...t.messages].reverse().find((m) => m.status === 'awaiting_approval');
    if (heldDraft) {
      const rationale = this.rationaleFor(c, hasMem);
      // Knowledge-driven drafts cite the doc they answered from (r19), so the
      // operator sees the training pay off. Prepended above the data reasons.
      const knowledgeSource = this.draftKnowledgeSource.get(conversationId);
      if (knowledgeSource) rationale.unshift(`From your knowledge: ${knowledgeSource}`);
      if (steer) rationale.unshift(this.steerRationale(steer.goal));
      return delay({
        body: heldDraft.body,
        playbookLabel: this.playbookLabelFor(heldDraft),
        held: true,
        draftId: heldDraft.id,
        rationale: rationale.slice(0, 3),
      });
    }

    // Thread-position facts shared by the ladder and the base builder.
    const lastInbound = [...t.messages].reverse().find((m) => m.direction === 'inbound');
    const lastMessage = t.messages[t.messages.length - 1];
    const lastOutbound = [...t.messages].reverse().find((m) => m.direction === 'outbound');
    const inboundText = (lastInbound?.body ?? '').toLowerCase();
    const customerWaiting =
      !!lastInbound && (!lastOutbound || lastOutbound.created_at < lastInbound.created_at);

    // Silence — a won-back / closed thread whose last message is a closing
    // outbound and where the customer isn't waiting on us. Nudging a just-
    // confirmed customer is pushy; the best action is to leave them alone.
    const closingWords = ['confirmed', "you're in", 'you’re in', 'all set', 'welcome aboard'];
    const lastIsClosingOutbound =
      lastMessage?.direction === 'outbound' &&
      closingWords.some((w) => lastMessage.body.toLowerCase().includes(w));
    if (lastIsClosingOutbound && !customerWaiting) return delay(null);

    // Silence — the customer just declined. A follow-up would be pushy.
    const declineWords = ['no thanks', 'not interested', 'stop texting', 'leave me alone', 'we passed'];
    if (declineWords.some((w) => inboundText.includes(w))) return delay(null);

    // (c) FOLLOW-UP LADDER. Count our own trailing unanswered sends — outbound
    // messages that landed AFTER the customer's last reply (the agent counts its
    // own AND the human's outbound as "ours"; a customer reply resets the rung).
    const unanswered = this.trailingUnansweredSends(t);
    if (unanswered >= 1) {
      // A FRESH steer resets ONE rung: the human explicitly asked for an action,
      // so a state the ladder would otherwise silence (rung ≥2, or a rung-1 send
      // still < 1h old) may produce ONE steered suggestion. The credit is consumed
      // here so a stale steer doesn't keep re-firing. Anti-repeat still guards it.
      const ageMs = this.now() - new Date(lastMessage!.created_at).getTime();
      const ladderWouldSilence = unanswered >= 2 || !(ageMs >= 60 * 60_000);
      if (steer && this.steerResetArmed.has(conversationId) && ladderWouldSilence) {
        this.steerResetArmed.delete(conversationId);
        const steered = this.steeredSuggestion(c, first, hasMem, steer);
        if (steered && !sentBodies.has(norm(steered.body))) {
          return delay({ ...steered, held: false, draftId: undefined });
        }
        // No safe steered body left → fall through to the normal ladder rules.
      }

      // Rung 2 (or deeper): two unanswered outbounds already — waiting is the
      // right move. A third text is what a good producer would NOT send.
      if (unanswered >= 2) return delay(null);

      // Rung 1: one unanswered outbound. Only nudge once it's aged ≥1h by the
      // demo clock — inside the hour a second text reads as pushy (keep the rule).
      if (!(ageMs >= 60 * 60_000)) return delay(null);

      // Steered rung-1 (aged ≥1h): the goal reshapes the nudge naturally.
      if (steer) {
        const steered = this.steeredSuggestion(c, first, hasMem, steer);
        if (steered && !sentBodies.has(norm(steered.body))) {
          return delay({ ...steered, held: false, draftId: undefined });
        }
      }

      // A shorter, DIFFERENT-ANGLE nudge grounded in memory atoms — never the
      // same pitch. Built by a dedicated builder; the final check still guards it.
      const followUp = this.followUpNudge(c, first, hasMem);
      if (followUp && !sentBodies.has(norm(followUp.body))) {
        return delay({ ...followUp, held: false, draftId: undefined });
      }
      // No safe different-angle nudge left → the honest move is to wait.
      return delay(null);
    }

    // (d) The customer holds the ball (or the thread is fresh). When steered, the
    // goal drives the next-best message directly — a concrete time offer, a
    // payment nudge, a missing-fact ask, or a document ask — before the generic
    // renewal/lapsed/lead routing. Anti-repeat still guards the final body.
    if (steer) {
      const steered = this.steeredSuggestion(c, first, hasMem, steer);
      if (steered && !sentBodies.has(norm(steered.body))) {
        this.steerResetArmed.delete(conversationId);
        return delay({ ...steered, held: false, draftId: undefined });
      }
    }

    // Build the next-best message. Body sounds like the Hartley drafts: short,
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
      body = `Hey ${first}, your ${c.lob ?? 'policy'} renews ${this.friendlyDate(
        c.xDateDays!,
      )}. Tom kept time open to go over your options first. Want to grab 15 minutes ${timeHint}?`;
    } else if (lapsed && customerWaiting && /quote|number|refresh|deciding|still/.test(inboundText)) {
      // They replied to a lapsed-quote nudge and are still deciding — offer the
      // refresh they asked about. Grounded in the actual inbound keywords.
      playbookLabel = 'Win back lapsed quotes';
      rationale.push('Quote lapsed — customer still deciding');
      rationale.push(`Their last reply: “${this.trim(lastInbound!.body, 48)}”`);
      body = `No rush ${first}. Want me to have Tom refresh those numbers so you're seeing the latest? Happy to hold your prior quote while you decide.`;
    } else if (lapsed) {
      // A cold lapsed quote we can reactivate (marketing consent required to send;
      // the gate enforces it — we suggest honestly and let the gate decide).
      playbookLabel = 'Win back lapsed quotes';
      rationale.push('Quote lapsed — reactivation candidate');
      if (!scopes.has('marketing')) rationale.push('No marketing consent — gate will hold');
      body = `Hey ${first}, that quote from earlier this year is about to expire. Rates have moved since, so it's worth a fresh look. Want Tom to pull updated numbers?`;
    } else if (c.status === 'new_lead') {
      // A new lead who reached out — speed-to-lead follow-up. If they asked a
      // coverage question we keep it non-advisory (Tom answers the specifics).
      playbookLabel = 'Speed to lead';
      rationale.push('New lead — reached out about a quote');
      if (/liability|coverage|limit/.test(inboundText)) {
        rationale.push('Asked about coverage limits — Tom to advise');
        body = `Hey ${first}, good question on the limits. Tom can walk you through what fits your situation. Want a quick call this week to lock in your numbers?`;
      } else {
        body = `Hey ${first}, thanks for reaching out about a quote! I can pull your numbers together today. What's a good time for a quick call?`;
      }
      if (autoOnly) rationale.push('Auto only — bundle candidate');
    } else if (autoOnly) {
      // An insured auto-only customer with nothing pressing — a gentle bundle
      // mention (marketing; gate enforces consent).
      playbookLabel = 'Bundle upsell';
      rationale.push('Auto only — bundle candidate');
      if (!scopes.has('marketing')) rationale.push('No marketing consent — gate will hold');
      body = `Hey ${first}, you're with us on auto already. Bundling your home policy usually trims both premiums. Want Tom to run the combined number?`;
    } else {
      // Nothing actionable stands out — silence beats a filler text.
      return delay(null);
    }

    // FINAL HARD-RULE CHECK — if the computed body is one we already sent
    // (normalized), never repeat it. The honest move is silence until state moves.
    if (sentBodies.has(norm(body))) return delay(null);

    return delay({ body, playbookLabel, held: false, draftId: undefined, rationale });
  }

  // The normalized (trim + lowercase) set of bodies we've already sent as real
  // outbound on this thread. Backs the suggestion engine's HARD anti-repeat rule.
  // Excludes centered system entries (opt-out/opt-in/missed-call), which aren't
  // messages we "said". Held/awaiting drafts are excluded too (not yet sent).
  private sentOutboundBodies(t: FixtureThread): Set<string> {
    const bodies = new Set<string>();
    for (const m of t.messages) {
      if (m.direction === 'outbound' && m.status === 'sent') {
        bodies.add(m.body.trim().toLowerCase());
      }
    }
    return bodies;
  }

  // Count OUR trailing unanswered sends — outbound `sent` messages at the tail of
  // the thread with no customer inbound after them. A customer reply resets the
  // count to 0 (they hold the ball). The agent treats human sends as its own, so
  // both count. Centered system entries are skipped (not messages we "said").
  private trailingUnansweredSends(t: FixtureThread): number {
    let count = 0;
    for (let i = t.messages.length - 1; i >= 0; i -= 1) {
      const m = t.messages[i];
      if (m.direction === 'inbound') break; // a reply resets the ladder
      if (m.direction === 'outbound' && m.status === 'sent') count += 1;
      // else: a centered system entry (opted_out / missed_call / etc.) — skip it.
    }
    return count;
  }

  // A rung-1 follow-up: a SHORTER, different-angle nudge to our own unanswered
  // outbound, grounded in the contact's memory atoms — deliberately NOT the same
  // pitch we already sent. Returns null when no honest different angle exists.
  private followUpNudge(
    c: FixtureContact,
    first: string,
    hasMem: (needle: string) => boolean,
  ): { body: string; playbookLabel: string; rationale: string[] } | null {
    const renewsSoon = c.xDateDays !== null && c.xDateDays >= 0 && c.xDateDays <= 45;
    const afterSix = hasMem('after 6pm') || hasMem('evening');

    if (renewsSoon) {
      // Renewal thread, no reply yet. Different angle: name the reason to talk
      // (the teenage driver) or offer the evening slot they prefer — not the
      // original "grab 15 minutes" pitch.
      const rationale = ['No reply to yesterday’s text — trying a different angle'];
      if (hasMem('teenage driver')) {
        rationale.push('Teenage driver starting this fall');
        const when = afterSix ? 'after 6' : 'this week';
        return {
          body: `No rush ${first}. With a teenage driver joining this fall it’s worth a quick look before renewal, even 10 minutes ${when} works.`,
          playbookLabel: 'Renewal reminder',
          rationale,
        };
      }
      if (afterSix) {
        rationale.push('Prefers texts after 6pm');
        return {
          body: `No rush ${first}. I can grab Tom an evening slot after 6 if that’s easier. Just say the word.`,
          playbookLabel: 'Renewal reminder',
          rationale,
        };
      }
      return {
        body: `No rush ${first}. Happy to work around your schedule for the renewal review. When’s good?`,
        playbookLabel: 'Renewal reminder',
        rationale,
      };
    }

    if (c.status === 'lapsed_quote') {
      return {
        body: `No pressure ${first}. The door’s open if you want fresh numbers before that quote expires. Just say the word.`,
        playbookLabel: 'Win back lapsed quotes',
        rationale: ['No reply to our note — trying a lighter, different angle', 'Quote lapsed — reactivation candidate'],
      };
    }

    if (c.status === 'new_lead') {
      return {
        body: `No rush ${first}. Whenever you’ve got two minutes I can still pull those numbers together. Happy to work around you.`,
        playbookLabel: 'Speed to lead',
        rationale: ['No reply to the first note — trying a different angle', 'New lead — reached out about a quote'],
      };
    }

    return null;
  }

  // A short "Steered: …" rationale entry naming the goal the human set.
  private steerRationale(goal: SteerGoal): string {
    const label: Record<SteerGoal, string> = {
      book_time: 'Steered: book a time',
      take_payment: 'Steered: take payment',
      collect_info: 'Steered: collect the missing info',
      request_document: 'Steered: request a document',
    };
    return label[goal];
  }

  // A STEERED next-best message — the human set a goal, so we work it in
  // NATURALLY (never a canned line), grounded in the contact's real data. Warm
  // business-casual, ≤2 sentences, one question, no emojis. The free-text note is
  // woven in when present. Returns null only if no honest steered body exists.
  private steeredSuggestion(
    c: FixtureContact,
    first: string,
    hasMem: (needle: string) => boolean,
    steer: { goal: SteerGoal; note?: string },
  ): { body: string; playbookLabel: string; rationale: string[] } | null {
    const rationale: string[] = [this.steerRationale(steer.goal)];
    // A note like "mention the bundle discount" gets its own quiet rationale line
    // and a natural clause woven into the body (offset with a comma so it reads
    // cleanly wherever it lands, before the closing question). No em dashes in a
    // customer-received body (the voice canon — they read as machine-written).
    const noteClause = steer.note ? `, and I can ${this.lowerFirst(steer.note)}` : '';
    if (steer.note) rationale.push(`Your note: “${this.trim(steer.note, 40)}”`);

    const afterSix = hasMem('after 6pm') || hasMem('evening');
    const renewsSoon = c.xDateDays !== null && c.xDateDays >= 0 && c.xDateDays <= 45;

    if (steer.goal === 'book_time') {
      // Concrete time offer against the booking connection + the after-6pm memory.
      if (afterSix) rationale.push('Prefers texts after 6pm');
      rationale.push(`Booking: ${BOOKING_CONNECTION.calendar}`);
      const slot = afterSix ? 'Thursday at 6:30' : 'Thursday at 2';
      const body = `Hey ${first}, want me to lock in a time with Tom? ${slot} is open if that works${noteClause}.`;
      return { body, playbookLabel: 'Book a time', rationale: rationale.slice(0, 3) };
    }

    if (steer.goal === 'take_payment') {
      // Natural payment nudge tied to real context (a renewal that's due).
      const context = renewsSoon
        ? `since your renewal lands ${this.friendlyDate(c.xDateDays!)}`
        : 'whenever it’s convenient';
      if (renewsSoon) rationale.push(`Renews ${this.friendlyDate(c.xDateDays!)} (${c.xDateDays} days)`);
      const body = `Hey ${first}, I can text you a secure link to take care of the premium ${context}${noteClause}. Want me to send it over?`;
      return { body, playbookLabel: 'Take payment', rationale: rationale.slice(0, 3) };
    }

    if (steer.goal === 'collect_info') {
      // Ask for the missing fact the agent actually lacks. For an Auto+Home
      // renewal that's the home declarations page (same gap agentAsks surfaces);
      // otherwise the general "what we're missing" — the coverage they want quoted.
      if (c.lob === 'Auto+Home' && renewsSoon) {
        rationale.push('Bundle quote needs the current dec page');
        const body = `Hey ${first}, to quote the auto+home bundle at renewal I just need your current home declarations page${noteClause}. Could you send it over when you get a sec?`;
        return { body, playbookLabel: 'Collect info', rationale: rationale.slice(0, 3) };
      }
      rationale.push('Missing the details to quote accurately');
      const body = `Hey ${first}, to get your numbers exactly right I just need a couple quick details on your coverage${noteClause}. Mind if I grab those?`;
      return { body, playbookLabel: 'Collect info', rationale: rationale.slice(0, 3) };
    }

    // request_document — mirrors the document ask (a phone pic is fine).
    const docType = c.lob === 'Auto+Home' || c.lob === 'Home' ? 'home declarations page' : 'driver’s license';
    rationale.push(`Needs the ${docType}`);
    const body = `Hey ${first}, could you text over a quick photo of your ${docType}? A phone pic works great${noteClause}.`;
    return { body, playbookLabel: 'Request a document', rationale: rationale.slice(0, 3) };
  }

  // Lowercase the first character of a free-text note so it reads inside a clause
  // ("I can mention the bundle discount too"). No other mutation.
  private lowerFirst(s: string): string {
    const t = s.trim();
    return t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
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

  // Which playbook governs the agent's held reply-draft to an inbound on this
  // thread — so turning that playbook OFF stands the reply choreography down.
  // Mirrors the base-suggestion routing: a near renewal → renewal_reminder;
  // a new lead → speed_to_lead; a lapsed quote → winback_lapsed; else the
  // renewal_reminder key (the default reply playbook).
  private inboundReplyPlaybookKey(t: FixtureThread): string {
    const c = contactById(t.contactId);
    if (!c) return 'renewal_reminder';
    if (c.xDateDays !== null && c.xDateDays >= 0 && c.xDateDays <= 45) return 'renewal_reminder';
    if (c.status === 'new_lead') return 'speed_to_lead';
    if (c.status === 'lapsed_quote') return 'winback_lapsed';
    return 'renewal_reminder';
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

  // ── Agent workspace (r11) — chat sessions with history + delete ─────────────
  // Persisted to localStorage under AGENT_STORE_KEY. ALL localStorage access is
  // guarded (SSR / privacy mode → the in-memory fallback below is authoritative).
  // Ordering uses the session stamp() clock so newest-first is deterministic.
  private memoryStore: AgentStore | null = null; // in-memory fallback / cache
  private brainStore: AgentBrainStore | null = null; // voice + knowledge cache
  private connectionRequests: Set<string> | null = null; // requested keys cache
  private knowledgeSeq = 0; // monotonic knowledge-doc id counter
  private agentSeq = 0; // monotonic id counter (deterministic, no Math.random)
  private agentSeqSeeded = false; // seeded once from persisted ids per instance

  private nextAgentId(prefix: string): string {
    this.agentSeq += 1;
    return `${prefix}_${this.agentSeq}`;
  }

  // Seed the id counter past the highest numeric suffix already in the store, so
  // ids minted in a fresh page load NEVER collide with sessions/messages that
  // were persisted to localStorage in a previous load. Runs once per instance.
  private seedAgentSeq(store: AgentStore): void {
    if (this.agentSeqSeeded) return;
    this.agentSeqSeeded = true;
    let max = this.agentSeq;
    const consider = (id: string) => {
      const n = Number(id.slice(id.lastIndexOf('_') + 1));
      if (Number.isFinite(n) && n > max) max = n;
    };
    for (const s of store.sessions) consider(s.id);
    for (const list of Object.values(store.messages)) {
      for (const m of list) consider(m.id);
    }
    this.agentSeq = max;
  }

  // Read the whole store. Prefers localStorage; falls back to the in-memory copy
  // when storage is unavailable or the payload is malformed. Never throws.
  private readAgentStore(): AgentStore {
    if (this.memoryStore) return this.memoryStore;
    const empty: AgentStore = { sessions: [], messages: {} };
    try {
      const raw = globalThis.localStorage?.getItem(AGENT_STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AgentStore;
        if (parsed && Array.isArray(parsed.sessions) && parsed.messages) {
          this.memoryStore = parsed;
          this.seedAgentSeq(parsed);
          return parsed;
        }
      }
    } catch {
      // SSR / privacy mode / malformed — fall through to the in-memory store.
    }
    this.memoryStore = empty;
    return empty;
  }

  // Persist the store. Updates the in-memory cache first (always authoritative),
  // then best-effort writes to localStorage inside a try/catch.
  private writeAgentStore(store: AgentStore): void {
    this.memoryStore = store;
    try {
      globalThis.localStorage?.setItem(AGENT_STORE_KEY, JSON.stringify(store));
    } catch {
      // Quota / privacy mode — the in-memory cache still holds the truth.
    }
  }

  agentSessions(): Promise<AgentSession[]> {
    const { sessions } = this.readAgentStore();
    const sorted = sessions
      .slice()
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return delay(sorted);
  }

  createAgentSession(): Promise<AgentSession> {
    const store = this.readAgentStore();
    const session: AgentSession = {
      id: this.nextAgentId('sess'),
      title: NEW_CHAT_TITLE,
      updated_at: this.stamp(),
    };
    store.sessions.push(session);
    store.messages[session.id] = [];
    this.writeAgentStore(store);
    return delay(session);
  }

  deleteAgentSession(id: string): Promise<void> {
    const store = this.readAgentStore();
    store.sessions = store.sessions.filter((s) => s.id !== id);
    delete store.messages[id];
    this.writeAgentStore(store);
    return delay(undefined);
  }

  agentSessionMessages(id: string): Promise<AgentChatMessage[]> {
    const { messages } = this.readAgentStore();
    // Oldest-first (append order); a faithful transcript log.
    return delay((messages[id] ?? []).slice());
  }

  // Append one transcript line. On the FIRST user message, if the session title
  // is still the placeholder, derive a truncated title from that message. Every
  // append bumps updated_at so the session floats to the top of the list.
  appendAgentMessage(id: string, role: 'user' | 'assistant', body: string): Promise<void> {
    const store = this.readAgentStore();
    const session = store.sessions.find((s) => s.id === id);
    if (!session) return delay(undefined); // deleted mid-flight — a quiet no-op
    const list = store.messages[id] ?? (store.messages[id] = []);
    const at = this.stamp();
    list.push({ id: this.nextAgentId('acm'), role, body, created_at: at });
    if (role === 'user' && session.title === NEW_CHAT_TITLE) {
      session.title = this.deriveTitle(body);
    }
    session.updated_at = at;
    this.writeAgentStore(store);
    return delay(undefined);
  }

  renameAgentSession(id: string, title: string): Promise<void> {
    const store = this.readAgentStore();
    const session = store.sessions.find((s) => s.id === id);
    if (session) {
      const trimmed = title.trim();
      session.title = trimmed || NEW_CHAT_TITLE;
      session.updated_at = this.stamp();
      this.writeAgentStore(store);
    }
    return delay(undefined);
  }

  // Truncate a first message to a session title (~40 chars, collapse whitespace).
  private deriveTitle(body: string): string {
    const one = body.replaceAll(/\s+/g, ' ').trim();
    if (!one) return NEW_CHAT_TITLE;
    return one.length > TITLE_MAX ? `${one.slice(0, TITLE_MAX - 1)}…` : one;
  }

  // ── Agent brain (r13) — editable voice + knowledge base ─────────────────────
  // Persisted to localStorage under BRAIN_STORE_KEY with the SAME guarded pattern
  // as the session store (in-memory cache authoritative; storage best-effort).
  // Seeded ONCE on first read: voice from TONE_PROFILE (+ empty instructions), and
  // three warm starter docs (Company / House rules / FAQ). agentProfile() and
  // toneProfile() read voice.traits/name from here, so edits change the agent.

  // Build the seed brain the first time nothing is persisted. Deterministic.
  private seedBrain(): AgentBrainStore {
    const at = this.stamp();
    return {
      voice: {
        name: 'Hartley concierge',
        traits: [...TONE_PROFILE.traits],
        instructions: '',
      },
      docs: [
        {
          id: this.nextKnowledgeId(),
          kind: 'company',
          title: 'About Hartley Insurance',
          body:
            'Hartley Insurance Group is a family-run independent agency in Austin, writing ' +
            'personal auto, home and umbrella for people who want a real human on the other ' +
            'end. Tom Hartley leads renewals himself and would rather talk something through ' +
            'than let a policy lapse quietly.',
          updated_at: at,
        },
        {
          id: this.nextKnowledgeId(),
          kind: 'rules',
          title: 'House rules',
          body:
            '- Always offer a call before quoting numbers over text.\n' +
            "- Never promise a rate — Tom confirms every quote.\n" +
            '- If someone sounds frustrated, slow down and offer to have Tom call.',
          updated_at: at,
        },
        {
          id: this.nextKnowledgeId(),
          kind: 'faq',
          title: 'Do you offer payment plans?',
          body:
            'Yes — most carriers we write with support monthly EFT or card autopay with no ' +
            'extra fee, and paid-in-full usually earns a small discount. For the exact split ' +
            'on a specific policy, offer to have Tom pull it up on a quick call.',
          updated_at: at,
        },
      ],
    };
  }

  private nextKnowledgeId(): string {
    this.knowledgeSeq += 1;
    return `kn_${this.knowledgeSeq}`;
  }

  // Seed the knowledge id counter past the highest persisted suffix so ids minted
  // in a fresh load never collide with docs persisted in a previous load.
  private seedKnowledgeSeq(docs: KnowledgeDoc[]): void {
    let max = this.knowledgeSeq;
    for (const d of docs) {
      const n = Number(d.id.slice(d.id.lastIndexOf('_') + 1));
      if (Number.isFinite(n) && n > max) max = n;
    }
    this.knowledgeSeq = max;
  }

  private readBrainStore(): AgentBrainStore {
    if (this.brainStore) return this.brainStore;
    try {
      const raw = globalThis.localStorage?.getItem(BRAIN_STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AgentBrainStore;
        if (parsed && parsed.voice && Array.isArray(parsed.docs)) {
          this.brainStore = parsed;
          this.seedKnowledgeSeq(parsed.docs);
          return parsed;
        }
      }
    } catch {
      // SSR / privacy mode / malformed — fall through to a fresh seed.
    }
    const seeded = this.seedBrain();
    this.writeBrainStore(seeded);
    return seeded;
  }

  private writeBrainStore(store: AgentBrainStore): void {
    this.brainStore = store;
    try {
      globalThis.localStorage?.setItem(BRAIN_STORE_KEY, JSON.stringify(store));
    } catch {
      // Quota / privacy mode — the in-memory cache still holds the truth.
    }
  }

  agentVoice(): Promise<AgentVoice> {
    const { voice } = this.readBrainStore();
    return delay({ ...voice, traits: [...voice.traits] });
  }

  // Accepts a PARTIAL patch (autosave-on-blur per field). Enforces the pinned
  // limits: ≤6 traits, each ≤60 chars, instructions ≤2000 chars. Persists and
  // returns the new voice; agentProfile()/toneProfile() read it on their next call.
  updateAgentVoice(patch: Partial<AgentVoice>): Promise<AgentVoice> {
    const store = this.readBrainStore();
    const next: AgentVoice = { ...store.voice };
    if (patch.name !== undefined) next.name = patch.name.trim() || store.voice.name;
    if (patch.traits !== undefined) {
      next.traits = patch.traits
        .map((t) => t.trim().slice(0, VOICE_TRAIT_LEN))
        .filter((t) => t.length > 0)
        .slice(0, VOICE_TRAIT_MAX);
    }
    if (patch.instructions !== undefined) {
      next.instructions = patch.instructions.slice(0, VOICE_INSTRUCTIONS_LEN);
    }
    store.voice = next;
    this.writeBrainStore(store);
    this.appendAudit('owner', 'agent_voice_updated', Object.keys(patch).join(','));
    // The brain changed → any mounted surface (Agent → Voice/Overview, Home
    // briefing) refetches on this event, so training round-trips live.
    this.emit({ type: 'knowledge.changed' });
    return delay({ ...next, traits: [...next.traits] });
  }

  knowledgeDocs(): Promise<KnowledgeDoc[]> {
    const { docs } = this.readBrainStore();
    return delay(docs.map((d) => ({ ...d })));
  }

  createKnowledgeDoc(
    doc: Pick<KnowledgeDoc, 'kind' | 'title' | 'body'> &
      Partial<Pick<KnowledgeDoc, 'filename' | 'size_bytes'>>,
  ): Promise<KnowledgeDoc> {
    const store = this.readBrainStore();
    const created: KnowledgeDoc = {
      id: this.nextKnowledgeId(),
      kind: doc.kind,
      title: doc.title,
      body: doc.body,
      ...(doc.filename ? { filename: doc.filename } : {}),
      ...(doc.size_bytes !== undefined ? { size_bytes: doc.size_bytes } : {}),
      updated_at: this.stamp(),
    };
    store.docs.push(created);
    this.writeBrainStore(store);
    this.appendAudit('owner', 'knowledge_created', `${created.kind}:${created.id}`);
    this.emit({ type: 'knowledge.changed' });
    return delay({ ...created });
  }

  updateKnowledgeDoc(
    id: string,
    patch: Partial<Pick<KnowledgeDoc, 'title' | 'body'>>,
  ): Promise<KnowledgeDoc> {
    const store = this.readBrainStore();
    const doc = store.docs.find((d) => d.id === id);
    if (!doc) return Promise.reject(new Error('not found'));
    if (patch.title !== undefined) doc.title = patch.title;
    if (patch.body !== undefined) doc.body = patch.body;
    doc.updated_at = this.stamp();
    this.writeBrainStore(store);
    this.appendAudit('owner', 'knowledge_updated', id);
    this.emit({ type: 'knowledge.changed' });
    return delay({ ...doc });
  }

  deleteKnowledgeDoc(id: string): Promise<void> {
    const store = this.readBrainStore();
    store.docs = store.docs.filter((d) => d.id !== id);
    this.writeBrainStore(store);
    this.appendAudit('owner', 'knowledge_deleted', id);
    this.emit({ type: 'knowledge.changed' });
    return delay(undefined);
  }

  // ── File upload into the Files group (r19) ──────────────────────────────────
  // The UI hands us { filename, mime_type, content_base64 } — it has already read
  // the file. We mirror the platform's pipeline deterministically:
  //   - text-like files (text/* mime, or a .txt/.md/.csv extension) → decode the
  //     base64, cap at ~200KB, and store the REAL content as the doc body. Long
  //     text is chunked into "{name} · part N/M" docs at ~1500 chars, mirroring the
  //     platform's chunker, so the agent drafts from the actual file content.
  //   - binaries (PDF etc.) → store metadata only with an honest status line
  //     "Parsed on the platform connection" (no fake extraction in demo mode).
  // One or more `file` KnowledgeDocs are created; a single knowledge.changed fires
  // at the end so the Files group refetches once for the whole upload.
  uploadKnowledgeFile(file: {
    filename: string;
    mime_type: string;
    content_base64: string;
  }): Promise<void> {
    const store = this.readBrainStore();
    const isText = isTextLike(file.filename, file.mime_type);
    const size = base64ByteLength(file.content_base64);

    if (isText) {
      const decoded = decodeBase64Utf8(file.content_base64).slice(0, UPLOAD_TEXT_CAP);
      const chunks = chunkText(decoded, UPLOAD_CHUNK_CHARS);
      const total = chunks.length;
      chunks.forEach((chunk, i) => {
        const title = total > 1 ? `${file.filename} · part ${i + 1}/${total}` : file.filename;
        store.docs.push({
          id: this.nextKnowledgeId(),
          kind: 'file',
          title,
          body: chunk,
          filename: file.filename,
          size_bytes: size,
          updated_at: this.stamp(),
        });
      });
      this.appendAudit('owner', 'knowledge_uploaded', `text:${file.filename}:${total}`);
    } else {
      // Binary — metadata only, honest about where parsing happens.
      store.docs.push({
        id: this.nextKnowledgeId(),
        kind: 'file',
        title: file.filename,
        body: UPLOAD_BINARY_NOTE,
        filename: file.filename,
        size_bytes: size,
        updated_at: this.stamp(),
      });
      this.appendAudit('owner', 'knowledge_uploaded', `binary:${file.filename}`);
    }

    this.writeBrainStore(store);
    this.emit({ type: 'knowledge.changed' });
    return delay(undefined);
  }

  // ── Connections marketplace (r13) ───────────────────────────────────────────
  // connected = the existing connections() rows (unchanged idiom); available =
  // the native surfaces the business can request. A requested key persists so its
  // optimistic "Requested" state survives reload.
  private readConnectionRequests(): Set<string> {
    if (this.connectionRequests) return this.connectionRequests;
    let set = new Set<string>();
    try {
      const raw = globalThis.localStorage?.getItem(CONNECTION_REQUESTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) set = new Set(parsed);
      }
    } catch {
      // SSR / privacy mode / malformed — start empty.
    }
    this.connectionRequests = set;
    return set;
  }

  private writeConnectionRequests(set: Set<string>): void {
    this.connectionRequests = set;
    try {
      globalThis.localStorage?.setItem(CONNECTION_REQUESTS_KEY, JSON.stringify([...set]));
    } catch {
      // Quota / privacy mode — the in-memory cache still holds the truth.
    }
  }

  async connectionsCatalog(): Promise<ConnectionsCatalog> {
    const connected = await this.connections();
    const requested = this.readConnectionRequests();
    return delay({
      connected,
      available: AVAILABLE_CONNECTIONS.map((a) => ({
        ...a,
        requested: requested.has(a.key),
      })),
    });
  }

  requestConnection(key: string, note?: string): Promise<{ ok: true }> {
    const set = this.readConnectionRequests();
    set.add(key);
    this.writeConnectionRequests(set);
    this.appendAudit('owner', 'connection_requested', note ? `${key}:${note}` : key);
    return delay({ ok: true as const });
  }

  // ── Research / waterfall enrichment (r11) — demo-honest ─────────────────────
  // Resolve the contact by id or fuzzy name, then run a first-party waterfall:
  //   book          → real policy / LOB / renewal facts from the fixture
  //   conversations → memory atoms + the last inbound quote from the thread
  //   carrier       → needs_platform (ships with the AMS connector)
  //   web           → needs_platform (Exa runs on the platform connection)
  // Demo mode NEVER invents web facts — the honesty rule. Unknown name → null.
  researchContact(nameOrId: string): Promise<ResearchReport | null> {
    const c = this.resolveContact(nameOrId);
    if (!c) return delay(null);

    const steps: ResearchStep[] = [];

    // book — real policy facts.
    const bookFacts: string[] = [];
    if (c.lob) bookFacts.push(`Lines of business: ${c.lob}`);
    if (c.status) bookFacts.push(`Policy status: ${c.status.replaceAll('_', ' ')}`);
    if (c.xDateDays !== null)
      bookFacts.push(`Renews ${this.friendlyDate(c.xDateDays)} (${c.xDateDays} days)`);
    steps.push({
      source: 'book',
      label: 'Book of record',
      status: bookFacts.length ? 'hit' : 'miss',
      facts: bookFacts,
    });

    // conversations — memory atoms + last inbound quote.
    const convFacts: string[] = c.memory.map((m) => `${m.value} (${m.source})`);
    const thread = threadByContactId(c.id) ??
      [...this.threads.values()].find((t) => t.contactId === c.id);
    const lastInbound = thread
      ? [...thread.messages].reverse().find((m) => m.direction === 'inbound')
      : undefined;
    if (lastInbound) convFacts.push(`Last inbound: “${this.trim(lastInbound.body, 90)}”`);
    steps.push({
      source: 'conversations',
      label: 'Your conversations',
      status: convFacts.length ? 'hit' : 'miss',
      facts: convFacts,
    });

    // carrier — needs the AMS connector (no invented facts).
    steps.push({
      source: 'carrier',
      label: 'Carrier lookup ships with the AMS connector',
      status: 'needs_platform',
      facts: [],
    });

    // web — Exa runs on the platform connection (no invented facts).
    steps.push({
      source: 'web',
      label: 'Web research (Exa) runs on the platform connection',
      status: 'needs_platform',
      facts: [],
    });

    return delay({
      contactId: c.id,
      name: c.name,
      steps,
      consentNote:
        'Research informs calls and prep for anyone — texting still requires consent; the gate enforces it.',
    });
  }

  // Resolve a contact by exact id, exact name, or a fuzzy (case-insensitive,
  // substring / first-name) match. Deterministic — first fixture match wins.
  private resolveContact(nameOrId: string): FixtureContact | undefined {
    const q = nameOrId.trim().toLowerCase();
    if (!q) return undefined;
    const byId = contactById(nameOrId);
    if (byId) return byId;
    return (
      CONTACTS.find((c) => c.name.toLowerCase() === q) ??
      CONTACTS.find((c) => c.name.toLowerCase().includes(q)) ??
      CONTACTS.find((c) => c.name.toLowerCase().split(' ').includes(q))
    );
  }

  // ── Navigation intent (r11) — deterministic "take me to…" resolver ──────────
  // A contact name routes to their conversation (/inbox?c=<conversationId>), or
  // /contacts?c=<contactId> when no conversation exists. Section words route to
  // their surface. Returns null when nothing matches. Computed locally.
  resolveNavigate(query: string): Promise<{ label: string; href: string } | null> {
    return delay(this.computeNavigate(query));
  }

  private computeNavigate(query: string): { label: string; href: string } | null {
    const q = query.trim().toLowerCase();
    if (!q) return null;

    // Section words first — an explicit surface intent beats a stray name match.
    const sections: { match: string[]; label: string; href: string }[] = [
      { match: ['inbox', 'approvals'], label: 'Inbox', href: '/inbox' },
      { match: ['agent', 'flows', 'playbooks'], label: 'Agent', href: '/agent' },
      { match: ['insights', 'revenue'], label: 'Insights', href: '/insights' },
      { match: ['settings', 'trust', 'connections'], label: 'Settings', href: '/settings' },
      { match: ['contacts', 'book'], label: 'Contacts', href: '/contacts' },
    ];
    const words = q.split(/\s+/);
    for (const s of sections) {
      if (s.match.some((m) => words.includes(m))) {
        return { label: s.label, href: s.href };
      }
    }

    // Contact name → their conversation (or the contacts book if none exists).
    const c = this.resolveContact(query);
    if (c) {
      const conv =
        [...this.threads.values()].find((t) => t.contactId === c.id) ??
        threadByContactId(c.id);
      return conv
        ? { label: c.name, href: `/inbox?c=${encodeURIComponent(conv.conversationId)}` }
        : { label: c.name, href: `/contacts?c=${encodeURIComponent(c.id)}` };
    }

    return null;
  }
}

// Small helpers re-exported for command-router narration (Home, Wave 2).
export { contactByName, threadByConversationId };
