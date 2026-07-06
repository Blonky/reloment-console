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
  | string; // blocked_<reason> is dynamic — keep the door open

export type Direction = 'inbound' | 'outbound';

// Delivered-as channel (message.channel_accepted). null before send.
export type Channel = 'imessage' | 'rcs' | 'sms' | null;

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
  controller: 'agent' | 'human' | string;
  contact_id: string;
  display_name: string;
  e164: string;
  timezone: string;
  lob: string | null;
  policy_status: string | null;
  x_date: string | null;
}

export interface ThreadMessage {
  id: string;
  direction: Direction;
  body: string;
  status: MessageStatus;
  channel_accepted: Channel;
  advice_verdict: AdviceVerdict;
  created_at: string;
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

export interface LineAgent {
  key: string; // playbook/agent key or line role
  name: string; // human name of the agent
  e164: string; // the line it originates on
  registered: boolean;
  quarantined: boolean;
  autonomyCeiling: Autonomy;
  playbooks: string[]; // playbook names attached
}

export interface AuditRow {
  time: string; // ISO
  actor: string;
  action: string;
  reason: string; // plain reason / auditReason
  hash: string; // short hash-chain digest
}
