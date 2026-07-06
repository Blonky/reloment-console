// The Hartley Insurance Group demo book — data only, deterministic.
// This mirrors platform/src/db/seed.ts exactly: the same line, 8 contacts with
// the same consents/opt-out/memory, the same 3 threads, the same 3 playbooks,
// the same outcomes, and the same home pulse. No Math.random anywhere; every
// timestamp is a fixed offset from the single DEMO_NOW constant.

import type {
  AdviceVerdict,
  Autonomy,
  Channel,
  Classification,
  Direction,
  MessagePart,
  MessageStatus,
} from './types.ts';

// The one clock. Tuesday, 2026-07-07 14:20 America/Chicago in absolute UTC.
// Everything relative offsets from here so the demo is byte-stable across runs.
export const DEMO_NOW = new Date('2026-07-07T19:20:00.000Z');

const DAY = 86_400_000;
const MIN = 60_000;

/** ISO string N days from DEMO_NOW (dates: policy x_date, midday to avoid tz slip). */
export function daysFromNow(n: number): string {
  const d = new Date(DEMO_NOW.getTime() + n * DAY);
  // Normalize to a date-only ISO (YYYY-MM-DD) to match a SQL `date` column.
  return d.toISOString().slice(0, 10);
}

/** ISO timestamp offset from DEMO_NOW by minutes (message created_at). */
function tsMin(deltaMin: number): string {
  return new Date(DEMO_NOW.getTime() + deltaMin * MIN).toISOString();
}

export const TENANT_NAME = 'Hartley Insurance Group';
export const LINE_E164 = '+15125550100';
export const LICENSED_AGENT = 'Tom Hartley';

// ── Contacts (seed.ts CONTACTS, verbatim scenarios) ─────────────────────────
export interface FixtureContact {
  id: string;
  name: string;
  e164: string;
  lob: string | null;
  status: string | null;
  xDateDays: number | null;
  tz: string;
  consents: string[];
  optedOut: boolean;
  imessageCapable: boolean; // capability ladder top rung
  memory: { value: string; source: string }[];
}

// Stable ids (seed uses uuids; we use readable stable slugs — deterministic).
export const CONTACTS: FixtureContact[] = [
  {
    id: 'ct_dana',
    name: 'Dana Whitfield',
    e164: '+15125550201',
    lob: 'Auto+Home',
    status: 'active',
    xDateDays: 21,
    tz: 'America/Chicago',
    consents: ['transactional', 'marketing'],
    optedOut: false,
    imessageCapable: true,
    memory: [
      { value: 'Teenage driver starting this fall', source: 'call_note' },
      { value: 'Prefers texts after 6pm', source: 'preference' },
      { value: 'Sore about last year’s rate increase', source: 'call_note' },
    ],
  },
  {
    id: 'ct_marcus',
    name: 'Marcus Lee',
    e164: '+15125550202',
    lob: 'Auto',
    status: 'new_lead',
    xDateDays: null,
    tz: 'America/Chicago',
    consents: ['transactional'],
    optedOut: false,
    imessageCapable: true,
    memory: [
      { value: 'Came in via web quote form', source: 'lead_source' },
      { value: 'Asked about liability limits', source: 'inbound_message' },
    ],
  },
  {
    id: 'ct_priya',
    name: 'Priya Raman',
    e164: '+15125550203',
    lob: 'Home',
    status: 'lapsed_quote',
    xDateDays: -14,
    tz: 'America/New_York',
    consents: ['transactional', 'marketing'],
    optedOut: false,
    imessageCapable: true,
    memory: [
      { value: 'Quoted $1,840/yr in June', source: 'quote' },
      { value: 'Comparing with current carrier', source: 'inbound_message' },
    ],
  },
  {
    id: 'ct_jordan',
    name: 'Jordan Baker',
    e164: '+15125550204',
    lob: 'Auto',
    status: 'active',
    xDateDays: 180,
    tz: 'America/Chicago',
    consents: ['transactional', 'marketing'],
    optedOut: false,
    imessageCapable: false,
    memory: [{ value: 'Won back in June — renewed after lapse', source: 'outcome' }],
  },
  {
    id: 'ct_sam',
    name: 'Sam Ortiz',
    e164: '+15125550205',
    lob: 'Auto',
    status: 'lapsed_quote',
    xDateDays: -75,
    tz: 'America/Chicago',
    consents: ['transactional', 'marketing'],
    optedOut: true,
    imessageCapable: false,
    memory: [],
  },
  {
    id: 'ct_lee',
    name: 'Lee Nguyen',
    e164: '+15125550206',
    lob: 'Home',
    status: 'lapsed_quote',
    xDateDays: -90,
    tz: 'America/Denver',
    consents: ['transactional'], // no marketing consent → excluded from win-back
    optedOut: false,
    imessageCapable: false, // SMS-only
    memory: [],
  },
  {
    id: 'ct_ava',
    name: 'Ava Thompson',
    e164: '+15125550207',
    lob: 'Auto+Home',
    status: 'lapsed_quote',
    xDateDays: -70,
    tz: 'America/Chicago',
    consents: ['transactional', 'marketing'],
    optedOut: false,
    imessageCapable: true,
    memory: [{ value: 'Mentioned buying a boat this summer', source: 'call_note' }],
  },
  {
    id: 'ct_noah',
    name: 'Noah Kim',
    e164: '+15125550208',
    lob: 'Auto',
    status: 'lapsed_quote',
    xDateDays: -65,
    tz: 'America/Chicago',
    consents: ['transactional', 'marketing'],
    optedOut: false,
    imessageCapable: true,
    memory: [],
  },
  // Ray Delgado — a NEW caller with no prior conversation. He reaches the line
  // by phone; because the line is messaging-only (no voice), the missed call is
  // forwarded to text-back. Consent basis 'inbound_call' is recorded at call
  // time by simulateMissedCall — so his fixture starts with NO consent on file
  // (the call list surfaces him as consentState 'none' → suggested action Call).
  {
    id: 'ct_ray',
    name: 'Ray Delgado',
    e164: '+15125550301',
    lob: null,
    status: 'new_lead',
    xDateDays: null,
    tz: 'America/Chicago',
    consents: [],
    optedOut: false,
    imessageCapable: true,
    memory: [{ value: 'Called the line — no policy on file yet', source: 'inbound_call' }],
  },
];

export const contactById = (id: string): FixtureContact | undefined =>
  CONTACTS.find((c) => c.id === id);
export const contactByName = (name: string): FixtureContact | undefined =>
  CONTACTS.find((c) => c.name === name);

// ── Threads (seed.ts thread() calls, verbatim bodies) ───────────────────────
export interface FixtureMessage {
  id: string;
  direction: Direction;
  body: string;
  status: MessageStatus;
  channel_accepted: Channel;
  advice_verdict: AdviceVerdict;
  classification: Classification;
  created_at: string;
  parts?: MessagePart[];
}
export interface FixtureThread {
  conversationId: string;
  contactId: string;
  messages: FixtureMessage[];
}

let seq = 0;
const mkId = (): string => `msg_${(seq += 1).toString().padStart(3, '0')}`;

function msg(
  direction: Direction,
  body: string,
  createdAtMin: number,
  opts: {
    status?: MessageStatus;
    channel?: Channel;
    advice?: AdviceVerdict;
    cls?: Classification;
  } = {},
): FixtureMessage {
  return {
    id: mkId(),
    direction,
    body,
    status: opts.status ?? (direction === 'inbound' ? 'received' : 'sent'),
    channel_accepted: opts.channel ?? (direction === 'outbound' ? 'imessage' : null),
    advice_verdict: opts.advice ?? 'none',
    classification: opts.cls ?? 'transactional',
    created_at: tsMin(createdAtMin),
  };
}

// Dana — the hero thread: inbound question + renewal draft awaiting approval.
const danaThread: FixtureThread = {
  conversationId: 'cv_dana',
  contactId: 'ct_dana',
  messages: [
    msg('inbound', 'Hey is my policy going up again this year??', -95),
    msg(
      'outbound',
      'Hi Dana — your auto+home renews Jul 28. Rates shifted this year, so Tom’s set aside time to review your options before anything changes. Want Thursday at 5:30, after work?',
      -90,
      { status: 'awaiting_approval', channel: null, cls: 'transactional' },
    ),
  ],
};

// Marcus — advice-adjacent inbound, hard-routed to a licensed human.
const marcusThread: FixtureThread = {
  conversationId: 'cv_marcus',
  contactId: 'ct_marcus',
  messages: [
    msg(
      'inbound',
      'Thanks for the quote. Do you think 50/100 liability is enough for me or should I go higher?',
      -240,
    ),
    msg('outbound', '[Needs a licensed agent: coverage-limit recommendation]', -238, {
      status: 'routed_to_human',
      channel: null,
      advice: 'advice_adjacent',
    }),
  ],
};

// Priya — lapsed quote, replied, agent drafting (no pending draft yet).
const priyaThread: FixtureThread = {
  conversationId: 'cv_priya',
  contactId: 'ct_priya',
  messages: [
    msg(
      'outbound',
      'Hi Priya — your home quote from June is set to expire. Want me to have Tom refresh the numbers?',
      -1450,
      { channel: 'imessage' },
    ),
    msg('inbound', 'Oh right! yes please, we’re still deciding 🙏', -1440),
  ],
};

// Jordan — a finished win-back with an outcome (feeds the pulse tile).
const jordanThread: FixtureThread = {
  conversationId: 'cv_jordan',
  contactId: 'ct_jordan',
  messages: [
    msg(
      'outbound',
      'Hi Jordan — noticed your auto policy lapsed last month. If timing was the issue, Tom found a way to keep your old rate.',
      -8700,
      { channel: 'sms' },
    ),
    msg('inbound', 'ok yeah let’s do it 🙌', -8680),
    msg(
      'outbound',
      'You’re in 🎉 Renewal confirmed at your prior rate. Tom will call to finalize.',
      -8670,
      { channel: 'sms' },
    ),
  ],
};

export const THREADS: FixtureThread[] = [danaThread, marcusThread, priyaThread, jordanThread];

export const threadByConversationId = (id: string): FixtureThread | undefined =>
  THREADS.find((t) => t.conversationId === id);
export const threadByContactId = (contactId: string): FixtureThread | undefined =>
  THREADS.find((t) => t.contactId === contactId);

// ── Playbooks (seed.ts, classification counsel-signed at playbook level) ────
// autonomy here is the playbook's autonomy CEILING, plain-language:
//   'draft'         — always drafts, never sends without approval
//   'auto_send_ack' — may auto-send a bounded acknowledgement (e.g. a missed-
//                     call text-back on inquiry basis); still passes the gate
export type PlaybookAutonomy = 'draft' | 'auto_send_ack';

export interface FixturePlaybook {
  key: string;
  name: string;
  classification: Classification;
  status: string;
  template: string;
  counselSigned: boolean;
  // Optional round-7 enrichments (older playbooks omit them; the console's
  // campaign_status mapping does not depend on these fields).
  trigger?: string; // e.g. 'call.missed' — what starts the playbook
  autonomy?: PlaybookAutonomy;
  description?: string;
}
export const PLAYBOOKS: FixturePlaybook[] = [
  {
    key: 'renewal_reminder',
    name: 'Renewal reminder',
    classification: 'transactional',
    status: 'active',
    template:
      'Hi {first_name} — your policy renews soon. Tom’s set aside time to review your options before anything changes. Want to grab 15 minutes this week?',
    counselSigned: true,
  },
  {
    key: 'speed_to_lead',
    name: 'Speed to lead',
    classification: 'transactional',
    status: 'active',
    template:
      'Hi {first_name} — thanks for reaching out about a quote. I can get your numbers together today; what’s the best time for a quick call?',
    counselSigned: true,
  },
  {
    key: 'winback_lapsed',
    name: 'Win back lapsed quotes',
    classification: 'marketing',
    status: 'active',
    template:
      'Hi {first_name} — your quote from earlier this year is about to expire. Rates moved recently, so it’s worth a fresh look before it does. Want updated numbers?',
    counselSigned: true,
    autonomy: 'draft',
    description:
      'Reactivates dead leads whose quote lapsed but whose consent is still valid — never texts anyone who opted out or was never granted marketing consent.',
  },
  {
    key: 'missed_call',
    name: 'Missed-call text-back',
    classification: 'transactional',
    status: 'active',
    template:
      'Sorry we missed your call — this is Hartley Insurance’s text line. How can we help?',
    counselSigned: true,
    trigger: 'call.missed',
    autonomy: 'auto_send_ack',
    description:
      'The line is messaging-only, so a missed call is forwarded to text-back. Because the caller just reached out, the acknowledgement runs on inquiry consent basis and may auto-send within the ceiling — but it still passes the send gate (an opted-out caller gets no text).',
  },
  {
    key: 'bundle_upsell',
    name: 'Bundle upsell',
    classification: 'marketing',
    status: 'active',
    template:
      'Hi {first_name} — you’re insured on auto with us. Bundling your home policy usually trims both premiums. Want Tom to run the combined number?',
    counselSigned: true,
    autonomy: 'draft',
    description:
      'Cross-sells auto-only customers into auto+home. Draft-for-approval — every send waits on the producer, and marketing consent is required to text.',
  },
];

export const playbookByKey = (key: string): FixturePlaybook | undefined =>
  PLAYBOOKS.find((p) => p.key === key);

// ── Outcomes (seed.ts outcome_event rows — Jordan, $4,120 total) ────────────
export interface FixtureOutcome {
  contactId: string;
  kind: string;
  amount_cents: number;
  note: string;
  monthOffset: number; // months before DEMO_NOW, for the Insights bar chart
}
export const OUTCOMES: FixtureOutcome[] = [
  {
    contactId: 'ct_jordan',
    kind: 'renewal_won_back',
    amount_cents: 262000,
    note: 'Auto renewal recovered (manual attribution)',
    monthOffset: 1,
  },
  {
    contactId: 'ct_jordan',
    kind: 'cross_sell',
    amount_cents: 150000,
    note: 'Added renters policy (manual attribution)',
    monthOffset: 1,
  },
];

// (The Insights month series is derived in-screen from OutcomeRow.month —
// outcomes are the single source of truth; no separate month fixture exists.)

// ── Home pulse (seed-derived, matches the platform's /api/home) ─────────────
// needsYourEyes = Dana (awaiting_approval) + Marcus (routed_to_human) = 2
// conversationsRunning = 4 seeded conversations
// renewalsNext30d = Dana (x_date +21d) = 1
// wonBackCents = 262000 + 150000 = 412000
export const HOME_PULSE = {
  needsYourEyes: 2,
  conversationsRunning: 4,
  renewalsNext30d: 1,
  wonBackCents: 412000,
} as const;

// ── Signals (Home pulse card) ───────────────────────────────────────────────
export const SIGNALS: string[] = [
  '2 win-back candidates aged past 90 days',
  'Dana Whitfield renews in 21 days — renewal draft ready for approval',
  'Marcus Lee asked a coverage question — routed to a licensed human',
];

// ── Line / agent roster (seed.ts line + playbooks; autonomy is agency policy) ─
export interface FixtureLineAgent {
  key: string;
  name: string;
  e164: string;
  registered: boolean;
  quarantined: boolean;
  autonomyCeiling: Autonomy;
  playbooks: string[];
}
export const LINE_AGENTS: FixtureLineAgent[] = [
  {
    key: 'renewals_agent',
    name: 'Renewals agent',
    e164: LINE_E164,
    registered: true,
    quarantined: false,
    autonomyCeiling: 'approved_send',
    playbooks: ['Renewal reminder'],
  },
  {
    key: 'speed_to_lead_agent',
    name: 'Speed-to-lead agent',
    e164: LINE_E164,
    registered: true,
    quarantined: false,
    autonomyCeiling: 'approved_send',
    playbooks: ['Speed to lead'],
  },
  {
    key: 'winback_agent',
    name: 'Win-back agent',
    e164: LINE_E164,
    registered: true,
    quarantined: false,
    autonomyCeiling: 'draft',
    playbooks: ['Win back lapsed quotes'],
  },
];

// ── Audit sample (hash-chained; deterministic short digests) ────────────────
export interface FixtureAudit {
  minOffset: number;
  actor: string;
  action: string;
  reason: string;
  hash: string;
}
export const AUDIT_SAMPLE: FixtureAudit[] = [
  { minOffset: -95, actor: 'system', action: 'message.received', reason: 'Dana inbound', hash: '3af11c9e' },
  { minOffset: -90, actor: 'renewals_agent', action: 'draft.created', reason: 'renewal_reminder', hash: '77b0d2a4' },
  { minOffset: -240, actor: 'system', action: 'route.human', reason: 'advice_requires_licensed_human', hash: 'c19e8f30' },
  { minOffset: -238, actor: 'send_gate', action: 'send.blocked', reason: 'advice_never_auto', hash: 'a4d7712b' },
  { minOffset: -8670, actor: 'send_gate', action: 'send.allow', reason: 'allow', hash: 'e2c55901' },
  { minOffset: -8669, actor: 'owner', action: 'outcome.recorded', reason: 'renewal_won_back', hash: 'b8130caf' },
];

export function auditTime(minOffset: number): string {
  return tsMin(minOffset);
}

// Most-recent-activity timestamp per contact (drives Contacts "last activity").
export function lastActivityFor(contactId: string): string {
  const t = threadByContactId(contactId);
  if (!t || t.messages.length === 0) return tsMin(-100000);
  return t.messages[t.messages.length - 1].created_at;
}

// ── Voice/tone profile — how the agents were tuned to Hartley's voice ────────
// The tuned example should sound like the existing Hartley drafts (plain,
// names the human, one ask).
export const TONE_PROFILE = {
  trainedOn: '412 conversations from your two highest-retention producers',
  traits: [
    'Plain answers before paperwork',
    "Names the human ('Tom will call you')",
    'Never more than one question per text',
  ],
  example: {
    generic:
      'Dear valued customer, your policy is approaching its renewal date. Please contact our office at your earliest convenience to discuss your coverage options and any applicable rate adjustments.',
    tuned:
      'Hi Dana — your auto+home renews Jul 28. Rates shifted this year, so Tom’s set aside time to go over your options first. Want Thursday at 5:30, after work?',
  },
} as const;

// ── Booking connection (drafts already propose times; this is the wiring) ────
export const BOOKING_CONNECTION = {
  provider: 'Calendly',
  status: 'connected',
  calendar: 'Tom Hartley — Renewal reviews',
} as const;
