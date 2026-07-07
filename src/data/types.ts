// Shared domain types. These mirror the platform API's /api/* response shapes
// EXACTLY (field names, nesting) so HttpClient can map with zero translation.
// No `any` in this module — the seam is the contract Wave 2 builds against.

// ── Governance vocabulary (mirrors governance/sendGate.ts) ──────────────────
export type Classification = 'transactional' | 'marketing';
export type AdviceVerdict = 'none' | 'advice_adjacent';
export type Autonomy = 'draft' | 'approved_send' | 'auto';
export type Disposition = 'ALLOW' | 'HOLD' | 'BLOCK';

// The gate's auditReason strings. Union of what the platform actually emits and
// the short aliases the console UI documents. GateReason maps every one.
export type AuditReason =
  | 'allow'
  | 'carrier_reply'
  | 'invalid_message'
  | 'kill_switch'
  | 'opted_out'
  | 'reassigned_number_unscrubbed'
  | 'no_marketing_consent'
  | 'no_transactional_basis'
  | 'line_not_registered'
  | 'advice_never_auto'
  | 'exceeds_autonomy_ceiling'
  | 'advice_requires_licensed_human'
  | 'line_quarantined'
  | 'quiet_hours'
  | 'gate_error'
  // documented aliases (§5 / GateReason spec)
  | 'no_consent'
  | 'autonomy_ceiling'
  | 'unregistered_line'
  | 'quarantined'
  | 'reassigned_number';

export interface GateDecision {
  decision: Disposition;
  auditReason: AuditReason | string;
  routeToHuman?: boolean;
  earliestSendAt?: string;
}

// Message lifecycle status (message.status in the platform).
export type MessageStatus =
  | 'received'
  | 'awaiting_approval'
  | 'routed_to_human'
  | 'sent'
  | 'held'
  | 'opted_out'
  | 'opted_back_in'
  // The business corrected an opt-out record made in error (r16). Unlike a
  // customer START (transactional-only), a correction says the opt-out never
  // validly happened — full prior consent is restored. Rendered as a calm
  // centered timeline entry, not a bubble.
  | 'optout_corrected'
  | 'missed_call'
  | string; // blocked_<reason> is dynamic — keep the door open

export type Direction = 'inbound' | 'outbound';

// Delivered-as channel (message.channel_accepted). null before send.
export type Channel = 'imessage' | 'rcs' | 'sms' | null;

// ── Live event feed (models the provider's SSE stream) ──────────────────────
// The provider delivers real-time inbound via a `message.received` event over
// webhooks or an SSE stream; typing indicators are best-effort "UI signals
// before an agent or automation sends a follow-up". consent.changed is
// Reloment's own layer (the provider has no STOP/START keyword handling).
export type FeedEvent =
  | { type: 'typing'; conversationId: string; who: 'customer' | 'agent'; state: 'typing' | 'stopped' }
  | { type: 'message.received'; conversationId: string; message: ThreadMessage }
  | { type: 'draft.created'; conversationId: string; message: ThreadMessage }
  | { type: 'message.sent'; conversationId: string; message: ThreadMessage }
  | { type: 'consent.changed'; conversationId: string; contactId: string; optedOut: boolean }
  // A missed call on a messaging-only line arrives via Reloment's voice-capture
  // forward, which emits this event so the text-back playbook can engage.
  | { type: 'call.missed'; conversationId: string; callerName: string; e164: string }
  // Messages-first thread (v4): the per-conversation Agent ON/OFF switch flipped.
  | { type: 'agent.toggled'; conversationId: string; enabled: boolean }
  // Steering (r10): the human set/cleared a per-conversation goal for the agent.
  // Emitted alongside suggestion.updated so the composer's suggestion refetches
  // and re-weaves the goal into its next-best message.
  | { type: 'steer.changed'; conversationId: string }
  // Agent flows (r10): a playbook was turned on/off for the whole tenant. A
  // disabled playbook stops producing drafts/acks in the choreography.
  | { type: 'playbook.toggled'; key: string; enabled: boolean }
  // Fires after ANY message lands (or the toggle/consent changes) so the UI
  // refetches suggestion() — the agent's next-best message regenerates each turn.
  | { type: 'suggestion.updated'; conversationId: string }
  // Agent brain (r19): fires on ANY knowledge/voice mutation — a doc created /
  // edited / deleted, a file uploaded, a teach intent, or a voice patch. Surfaces
  // that render the brain (Agent → Knowledge / Voice, the Overview identity card,
  // the Home briefing) refetch on it, so teaching visibly round-trips live with no
  // manual reload. The platform emits the same event on its /api/knowledge +
  // /api/agent/voice writes.
  | { type: 'knowledge.changed' }
  // Memory evolution (r20): a contact's memory board changed — the agent learned
  // a fact from a customer text (grounding-gated on the platform: a fact is only
  // stored with a verbatim evidence quote from the message), or the operator
  // taught/corrected one by prompt (save_memory / forget_memory). Surfaces that
  // render memory (the open thread's brief, Contacts) refetch on it, so the
  // agent's understanding visibly evolves live.
  | { type: 'memory.changed'; contactId: string; conversationId?: string };

// ── Steering (r10) — the human asks the agent to work toward a goal ─────────
// A per-conversation steer the producer sets on a live thread. The suggestion
// engine incorporates it NATURALLY (a time offer, a payment nudge, a missing-
// fact ask, a document ask) — never as a canned line. null clears the steer.
export type SteerGoal =
  | 'book_time'
  | 'take_payment'
  | 'collect_info'
  | 'request_document';

// ── /api/home ───────────────────────────────────────────────────────────────
export interface HomePulse {
  needsYourEyes: number;
  conversationsRunning: number;
  renewalsNext30d: number;
  wonBackCents: number;
  killSwitch: boolean;
}

// ── /api/queue → { items: QueueItem[] } ─────────────────────────────────────
export interface QueueItem {
  message_id: string;
  conversation_id: string;
  status: MessageStatus;
  body: string;
  classification: Classification;
  advice_verdict: AdviceVerdict;
  created_at: string;
  contact_id: string;
  display_name: string;
  lob: string | null;
  policy_status: string | null;
  x_date: string | null;
}

// ── /api/threads/:id ────────────────────────────────────────────────────────
export interface ThreadConversation {
  id: string;
  // Messages-first thread (v4): the per-conversation Agent ON/OFF switch. When
  // ON the agent proposes/held-drafts and its suggestion is its next-best move;
  // when OFF it stays silent but still surfaces an assistive suggestion.
  agent_enabled: boolean;
  // Legacy mirror of agent_enabled ('agent' when ON, 'human' when OFF). Kept
  // populated so not-yet-updated UI keeps compiling; new UI reads agent_enabled.
  controller: 'agent' | 'human' | string;
  contact_id: string;
  display_name: string;
  e164: string;
  timezone: string;
  lob: string | null;
  policy_status: string | null;
  x_date: string | null;
}

// Inbound messages can carry media parts, mirroring the provider's message
// payload shape ({ type:'media', attachment_id, filename, mime_type, size_bytes }).
export interface MediaPart {
  type: 'media';
  filename: string;
  mime_type: string;
  size_bytes: number;
}

// Outbound messages can carry a rich-link part, mirroring the provider's native
// link-preview unfurling ({ type:'link', url, title, domain }) — a booking or
// payment link rendered as a tappable card, not a bare URL.
export interface LinkPart {
  type: 'link';
  url: string;
  title: string;
  domain: string;
}

// A message part is either inbound media or an outbound rich link.
export type MessagePart = MediaPart | LinkPart;

export interface ThreadMessage {
  id: string;
  direction: Direction;
  body: string;
  status: MessageStatus;
  channel_accepted: Channel;
  advice_verdict: AdviceVerdict;
  created_at: string;
  parts?: MessagePart[];
}

export interface MemoryAtom {
  value: string;
  source: string;
}

export interface ConsentRecord {
  scope: string; // 'transactional' | 'marketing' (open per platform)
  basis: string; // 'written' | ...
}

export interface ThreadDetail {
  conversation: ThreadConversation;
  messages: ThreadMessage[];
  memory: MemoryAtom[];
  consents: ConsentRecord[];
  optedOut: boolean;
}

// ── Messages-first suggestion (v4) ──────────────────────────────────────────
// The agent's next-best message, shown ABOVE the composer and regenerated after
// every turn. Either a gate-held draft awaiting approval (held: true) or a purely
// assistive draft the human can send or ignore (held: false). null = the honest
// "silence is sometimes the best action" state (opted out, or a nudge would be
// pushy). rationale MUST cite the real thread/contact data the body was built on.
export interface Suggestion {
  body: string;
  playbookLabel: string;
  held: boolean; // true when this is a gate-held draft awaiting approval
  draftId?: string; // present when held — approve(draftId) sends it
  rationale: string[]; // 1–3 short data-aware reasons, e.g. "Renews Aug 2"
}

// ── Agent asks (the agent reaches back to the business) ─────────────────────
// Deterministic prompts the agent surfaces TO the producer — things it needs
// from the business to keep a conversation or the tenant moving. Derived cheaply
// from fixture + session state on every read; never invented facts.
export interface AgentAsk {
  id: string;
  scope: 'contact' | 'tenant';
  contactId?: string; // present for contact-scoped asks
  contactName?: string; // present for contact-scoped asks
  ask: string; // the imperative ask, e.g. "Ask Dana for her home declarations page"
  why: string; // one plain-English reason grounded in real state
}

// ── Home briefing (Home becomes a daily briefing) ───────────────────────────
// A single composed read for the Home surface — all four fields derive from the
// SAME session/fixture state the rest of the client reads (no new hardcoded
// stats). needsYou links to where the work is; overnight recaps what the agent
// did in plain English; callOut is the top of the call list; asks is the top of
// agentAsks.
export interface HomeBriefing {
  needsYou: { label: string; count: number; href: string }[];
  overnight: string[]; // plain-English one-liners of what the agent did
  callOut: { name: string; reason: string }[]; // top of the call list
  asks: AgentAsk[]; // top agent asks
}

// ── approve → ApproveResult ─────────────────────────────────────────────────
// sent:true carries deliveredAs; sent:false carries the blocking/holding decision.
export interface ApproveResult {
  sent: boolean;
  deliveredAs?: Exclude<Channel, null>;
  decision: GateDecision;
}

// ── simulate/inbound → InboundResult ────────────────────────────────────────
export interface InboundResult {
  ok: boolean;
  optOutRecorded: boolean;
}

// ── tools/query_book → { rows: BookRow[] } ──────────────────────────────────
export interface BookRow {
  display_name: string;
  lob: string | null;
  x_date: string | null;
  policy_status?: string | null;
}

// ── tools/enroll_playbook → EnrollResult ────────────────────────────────────
export interface EnrollExclusion {
  name: string;
  reason: AuditReason | string;
}
export interface EnrollResult {
  playbook: string;
  enrolled: string[];
  excluded: EnrollExclusion[];
}

// ── tools/campaign_status → { playbooks: CampaignRow[] } ────────────────────
export interface CampaignRow {
  key: string;
  name: string;
  classification: Classification;
  status: string;
  enrolled: number;
  drafts_pending: number;
}

// ── tools/thread_brief → ThreadBrief ────────────────────────────────────────
export interface ThreadBriefContact {
  display_name: string;
  lob: string | null;
  policy_status: string | null;
  x_date: string | null;
  timezone: string;
}
export interface ThreadBriefRecent {
  direction: Direction;
  body: string;
  created_at: string;
}
export interface ThreadBrief {
  contactId: string;
  conversationId: string | null;
  contact: ThreadBriefContact;
  memory: { value: string }[];
  recent: ThreadBriefRecent[];
}

// ── Conversation brief (a plain-English recap + canned asks for a thread) ────
// Derived deterministically from the thread's own state — never invented facts.
export interface ConversationBrief {
  summary: string; // 2–3 sentence plain-English recap
  moments: { at: string; label: string }[]; // key timeline moments
  askSuggestions: string[]; // 3 canned questions
}

// ── tools/search_conversations → SearchHit[] (flattened for the UI) ─────────
export type SearchHit =
  | { kind: 'message'; body: string; display_name: string }
  | { kind: 'memory'; value: string; display_name: string };

// ── Fixture-only enrichments (not from a route, used by structured skeletons) ─
// The console's read-only screens need a little more than the raw routes expose
// (e.g. a full contact roster, line/agent registration, outcome ledger). These
// are surfaced through DemoClient's fixtures and the equivalent platform reads.
export interface Contact {
  id: string;
  display_name: string;
  e164: string;
  timezone: string;
  lob: string | null;
  policy_status: string | null;
  x_date: string | null;
  consents: string[];
  optedOut: boolean;
  lastActivity: string; // ISO — most recent message in the book
  memory: MemoryAtom[]; // the contact's memory board (value + provenance)
}

export interface OutcomeRow {
  contact: string;
  playbook: string;
  kind: string; // 'renewal_won_back' | 'cross_sell'
  outcome: string; // plain-English label
  amount_cents: number;
  note: string;
  month: string; // ISO 'YYYY-MM' the outcome was attributed to
}

// ── Insights report (r14) — the owner's report: PROOF / WORK / PIPELINE ──────
// One composed read for the Insights surface. Every field derives from the SAME
// session/fixture state the rest of the client reads — no new hardcoded stats.
// `activity` is the WORK band (counted from the audit record + the message store,
// the same derivations Home's overnight lines use); `pipeline` is what the agent
// is setting up next (renewals due, reactivation and bundle candidates from the
// book). Caps each pipeline list at 3 with a `more` overflow count.
export interface InsightsReport {
  activity: {
    conversations: number; // live conversation count
    sent: number; // messages sent through the gate (audit message.sent)
    heldForReview: number; // drafts awaiting approval / routed to human (= Home's Approvals waiting)
    blockedByGate: number; // sends the gate refused (audit)
    missedCallsAnswered: number; // missed-call auto-acks (0 until the demo fires one)
    medianFirstReplyMin: number | null; // median minutes inbound→next outbound; null if no pairs
  };
  pipeline: {
    renewals30d: { name: string; days: number; href: string }[]; // renewing in 0–30d
    reactivation: { name: string; reason: string; href: string }[]; // lapsed quotes with valid marketing consent
    bundle: { name: string; reason: string; href: string }[]; // auto-only active customers
    more: { renewals30d: number; reactivation: number; bundle: number }; // overflow beyond the cap of 3
  };
}

export interface AuditRow {
  time: string; // ISO
  actor: string;
  action: string;
  reason: string; // plain reason / auditReason
  hash: string; // short hash-chain digest
}

// ── Call list (deterministic priority ranking over the book) ────────────────
// Who the producer should reach out to next, ranked by renewal proximity,
// engagement, policy status, and LOB gaps. consentState drives the suggested
// action: an unconsented lead is never suggested for a text (the gate refuses
// it) — calling them is always fine.
export interface CallListRow {
  contactId: string;
  name: string;
  lob: string | null;
  score: number;
  reasons: string[];
  consentState: 'ok' | 'opted_out' | 'none';
  suggestedAction: string;
}

// ── Voice/tone profile (how the agents were tuned to the agency's voice) ─────
export interface ToneProfile {
  trainedOn: string;
  traits: string[];
  example: { generic: string; tuned: string };
}

// ── Agent profile (r10) — the single "Agent" surface's identity card ────────
// Intercom-Fin shape: ONE agent per business that switches roles across flows.
// Composed from TONE_PROFILE + the line's E.164 + fixed guardrails — no new
// hardcoded facts. `line` is the number every send goes out on; `traits` and
// `example` mirror the tone profile; `guardrails` are the fixed rules the agent
// operates under (advice routing, consent gate, quiet hours, STOP stickiness).
export interface AgentProfile {
  name: string;
  line: string;
  trainedOn: string;
  traits: string[];
  example: { generic: string; tuned: string };
  guardrails: string[];
}

// ── Playbook flows (r10) — playbooks reshaped for the merged Agent tab ──────
// The Campaigns + Agents tabs collapse into one "Agent" surface. Each playbook
// reads as a plain-language FLOW: when it fires, who it reaches, what the message
// does, and how much autonomy it has (HubSpot-Breeze plain language: "Review
// before sending" vs "Sends automatically"). Derived from PLAYBOOKS + the same
// campaign status store — single source of truth. `enabled` is session state.
export interface PlaybookFlow {
  key: string;
  name: string;
  enabled: boolean;
  when: string; // plain trigger sentence
  who: string; // the audience in one phrase
  what: string; // one-line description of the message approach
  autonomy: 'review' | 'auto';
  autonomyLabel: string; // "Review before sending" | "Sends automatically (still gated)"
  stats: { enrolled: number; sent: number; replied: number; heldBack: number };
}

// ── Agent brain (r13) — the editable knowledge-base surface ─────────────────
// The business trains its own agent: an editable voice (name, traits, house-style
// instructions) plus a list of knowledge documents folded into the agent's
// context. Mirrors the platform's /api/agent/voice + /api/knowledge routes so
// HttpClient maps 1:1. The demo persists edits to localStorage and READS the live
// voice store from agentProfile()/toneProfile() — training visibly changes the
// agent's identity card.
export interface AgentVoice {
  name: string;
  traits: string[]; // ≤6, each ≤60 chars
  instructions: string; // plain-language house style, ≤2000 chars
}

// A knowledge document the business drops in. 'company'/'rules'/'faq' are inline-
// editable prose; 'file' entries record a dropped-in file (filename + size) that
// the demo labels "indexed" — an honest demo affordance, no real upload/parse.
export type KnowledgeKind = 'company' | 'rules' | 'faq' | 'file';

export interface KnowledgeDoc {
  id: string;
  kind: KnowledgeKind;
  title: string;
  body: string;
  filename?: string; // present for 'file' entries
  size_bytes?: number; // present for 'file' entries
  updated_at: string; // ISO
}

// ── Connections marketplace (r13) ───────────────────────────────────────────
// The Connections surface becomes a marketplace: the wires already connected plus
// the native surfaces available to request. `available` mirrors the provider's
// real integration catalog (Salesforce, HubSpot, Slack, AMS systems, custom MCP).
export interface ConnectionCatalogItem {
  key: string;
  name: string;
  blurb: string; // one line: what this connection would power
  // True once the business has requested this integration. The demo persists it
  // so the optimistic "Requested" state survives reload; the platform sets it
  // from its own pending-request records.
  requested?: boolean;
}

export interface ConnectionsCatalog {
  connected: ConnectionRow[];
  available: ConnectionCatalogItem[];
}

// ── Connections (Trust & Settings) ──────────────────────────────────────────
// The details Reloment needs FROM the business, woven into one surface: each
// row is a wire the agency connects, its live status, the one line it powers,
// and the single detail the business provided. Composed from existing fixtures
// (booking, tone) so there's one read for the whole grid.
export interface ConnectionRow {
  key: string;
  name: string;
  status: 'connected' | 'action_needed';
  powers: string; // one line: what this connection powers
  detail: string; // the single detail the business provides
}

// ── Agent workspace (r11) — Home becomes a real agent chat with sessions ─────
// The Home command channel is a Manus/Sauna-style workspace: named chat SESSIONS
// with history, plus research/enrichment and navigation capabilities. These
// shapes mirror the platform's /api/agent/sessions CRUD so HttpClient maps 1:1.
export interface AgentSession {
  id: string;
  title: string;
  updated_at: string; // ISO — session list is sorted newest-first on this
}

// A stored transcript line. The demo persists user messages verbatim and the
// assistant's PLAIN-TEXT narration line (not a re-runnable command) — a faithful
// LOG of the conversation, replayed on reopen without re-executing actions.
export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  body: string;
  created_at: string; // ISO
}

// ── Research / waterfall enrichment (r11) ────────────────────────────────────
// A first-party-only enrichment waterfall over a contact: the book, the agency's
// own conversations, then the two capabilities that ship with the platform
// connection (carrier lookup via the AMS connector, web research via the
// platform). Demo mode NEVER fabricates web facts — the honesty rule: the two
// platform-only steps report status 'needs_platform', not invented data.
export interface ResearchStep {
  source: 'book' | 'conversations' | 'carrier' | 'web';
  label: string;
  status: 'hit' | 'miss' | 'needs_platform';
  facts: string[]; // real facts for hits; empty for miss / needs_platform
}

export interface ResearchReport {
  contactId: string | null;
  name: string;
  steps: ResearchStep[];
  consentNote: string; // the standing consent boundary — research ≠ texting
}
