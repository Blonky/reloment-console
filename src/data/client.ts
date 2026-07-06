// The DataClient seam. Everything renders against this interface; the console
// never fetches directly. createClient() returns HttpClient iff VITE_API_URL is
// set, else the deterministic DemoClient (the default open-source experience).

import type {
  AgentAsk,
  AgentChatMessage,
  AgentProfile,
  AgentSession,
  ApproveResult,
  AuditRow,
  BookRow,
  CallListRow,
  CampaignRow,
  ConnectionRow,
  Contact,
  ConversationBrief,
  EnrollResult,
  FeedEvent,
  HomeBriefing,
  HomePulse,
  InboundResult,
  LineAgent,
  OutcomeRow,
  PlaybookFlow,
  QueueItem,
  ResearchReport,
  SearchHit,
  SteerGoal,
  Suggestion,
  ThreadBrief,
  ThreadDetail,
  ToneProfile,
} from './types.ts';

export interface DataClient {
  // Identifies the backing implementation for the Topbar "Demo data" pill.
  readonly mode: 'demo' | 'http';

  // The clock for every time-derived display. Demo pins it to DEMO_NOW so what
  // the UI shows (a contact's local time) always agrees with what the demo
  // gate decides (quiet hours); http returns the real clock.
  now(): number;

  // Live event feed (models the provider's SSE stream). subscribe() returns an
  // unsubscribe function; the feed carries notifications (typing, inbound,
  // drafts, sends, consent changes), not the store — reads remain authoritative.
  subscribe(handler: (e: FeedEvent) => void): () => void;

  // Home
  home(): Promise<HomePulse>;

  // Inbox (hero — Wave 2 builds the UI against these)
  queue(): Promise<QueueItem[]>;
  thread(conversationId: string): Promise<ThreadDetail>;
  approve(conversationId: string, messageId: string): Promise<ApproveResult>;
  edit(conversationId: string, messageId: string, body: string): Promise<void>;
  // Messages-first thread (v4): the per-conversation Agent ON/OFF switch. A human
  // message never disables the agent; only this toggle does. takeover() is now a
  // thin alias for setAgentEnabled(false), kept for compatibility.
  setAgentEnabled(conversationId: string, enabled: boolean): Promise<void>;
  takeover(conversationId: string): Promise<void>;
  // The agent's next-best message for the composer's suggestion slot (v4). null
  // when the honest move is silence (opted out / a nudge would be pushy).
  suggestion(conversationId: string): Promise<Suggestion | null>;
  simulateInbound(conversationId: string, text: string): Promise<InboundResult>;

  // Steering (r10): the human sets (or clears with null) a per-conversation goal
  // the agent should work toward — book a time, take a payment, collect a missing
  // fact, or request a document — with an optional free-text note woven in. The
  // suggestion engine incorporates it NATURALLY (never a canned line) and still
  // respects the follow-up ladder + anti-repeat rule. Emits steer.changed +
  // suggestion.updated so the composer's suggestion re-weaves the goal.
  steer(conversationId: string, goal: SteerGoal | null, note?: string): Promise<void>;

  // Operations (round 7) — missed-call text-back, human follow-up, documents.
  // A missed call on the messaging-only line arrives via a voice-capture
  // forward; the text-back is auto-sent (inquiry basis) but still passes the
  // gate. sendManual is a human-controlled outbound, gated the same way (fail-
  // closed). requestDocument sends a gated ask, then simulates a media reply.
  simulateMissedCall(): Promise<{ conversationId: string }>;
  sendManual(conversationId: string, body: string): Promise<{ ok: boolean; blockedReason?: string }>;
  requestDocument(conversationId: string, docType: string): Promise<void>;
  // Send a rich-link message (booking / payment / document-request) from the
  // business's side. Gated exactly like sendManual (opted out / kill switch →
  // blocked). The provider natively unfurls the link as a preview card; the
  // outbound carries a LinkPart. document_request delegates to requestDocument.
  sendLink(
    conversationId: string,
    kind: 'booking' | 'payment' | 'document_request',
    docType?: string,
  ): Promise<{ ok: boolean; blockedReason?: string }>;

  // The agent reaches back to the business: 3–5 deterministic asks (things it
  // needs to keep a conversation or the tenant moving), recomputed on read.
  agentAsks(): Promise<AgentAsk[]>;
  // Home as a daily briefing — one composed read over existing session state.
  homeBriefing(): Promise<HomeBriefing>;

  // Command channel / tools
  queryBook(kind: 'renewals' | 'lapsed'): Promise<BookRow[]>;
  enrollPlaybook(playbookKey: string): Promise<EnrollResult>;
  // Home artifact still reads campaignStatus(); the merged Agent tab reads the
  // reshaped playbookFlows() — both derive from the SAME playbook/enrollment
  // store (single source of truth).
  campaignStatus(): Promise<CampaignRow[]>;
  playbookFlows(): Promise<PlaybookFlow[]>;
  // Turn a playbook on/off for the whole tenant (session state; default all on).
  // A disabled playbook stops producing drafts/acks in the inbound + missed-call
  // choreography and drops out of homeBriefing. Emits playbook.toggled.
  setPlaybookEnabled(key: string, enabled: boolean): Promise<void>;
  threadBrief(contactId: string): Promise<ThreadBrief>;
  searchConversations(q: string): Promise<SearchHit[]>;
  setKillSwitch(on: boolean): Promise<void>;

  // Conversation brief / ask-the-thread (grounded in real thread state).
  conversationBrief(conversationId: string): Promise<ConversationBrief>;
  askThread(conversationId: string, question: string): Promise<{ answer: string }>;

  // Read-model surfaces for the structured-skeleton screens.
  contacts(): Promise<Contact[]>;
  outcomes(): Promise<OutcomeRow[]>;
  agents(): Promise<LineAgent[]>;
  auditSample(): Promise<AuditRow[]>;
  optOuts(): Promise<Contact[]>;

  // Producer worklist + tuning / scheduling read-models (round 7).
  callList(): Promise<CallListRow[]>;
  toneProfile(): Promise<ToneProfile>;
  // The single "Agent" surface's identity card (r10): name, line, voice, and the
  // fixed guardrails it operates under. Composed from the tone profile + line.
  agentProfile(): Promise<AgentProfile>;
  bookingConnection(): Promise<{ provider: string; status: 'connected'; calendar: string }>;

  // The Connections surface (Trust & Settings): the five wires the agency
  // connects, each with status + what it powers + the detail it provides.
  // Composed from existing fixtures so the grid reads in one call.
  connections(): Promise<ConnectionRow[]>;

  // ── Agent workspace (r11) — Home as a real agent chat with sessions ─────────
  // The Home command channel becomes a Manus/Sauna-style workspace: named chat
  // SESSIONS with history + delete, backed by localStorage in demo and the
  // platform's /api/agent/sessions CRUD in production. The session store only
  // persists the TRANSCRIPT (role + body); the demo intent pipeline stays
  // UI-side. Replayed sessions are a faithful LOG, not re-executed commands.
  agentSessions(): Promise<AgentSession[]>; // newest-first (by updated_at)
  createAgentSession(): Promise<AgentSession>; // a fresh 'New chat'
  deleteAgentSession(id: string): Promise<void>;
  agentSessionMessages(id: string): Promise<AgentChatMessage[]>; // oldest-first
  // Append one transcript line. In demo, the first USER message auto-sets the
  // title (truncated) while it is still 'New chat', and bumps updated_at.
  appendAgentMessage(id: string, role: 'user' | 'assistant', body: string): Promise<void>;
  renameAgentSession(id: string, title: string): Promise<void>;

  // Research / waterfall enrichment (r11): a first-party-only waterfall over a
  // contact (book → conversations → carrier → web). Demo mode NEVER fabricates
  // web facts — the carrier + web steps report 'needs_platform'. Unknown name →
  // null. The consentNote states the standing boundary (research ≠ texting).
  researchContact(nameOrId: string): Promise<ResearchReport | null>;

  // Navigation intent (r11): resolve a "take me to…" query to a console target.
  // Deterministic — contact names route to their conversation, section words to
  // their surface. Returns null when nothing matches. Both clients compute this
  // locally (no server round-trip needed).
  resolveNavigate(query: string): Promise<{ label: string; href: string } | null>;
}

// Wave-1 note: HttpClient implements the full DataClient (routes exist for the
// hero surfaces; the read-model methods reuse the same governed reads). The
// factory selects it only when an API URL is configured.
import { HttpClient } from './http.ts';
import { DemoClient } from './demo.ts';

export function createClient(): DataClient {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl) {
    return new HttpClient(apiUrl, import.meta.env.VITE_TENANT_ID ?? '');
  }
  return new DemoClient();
}
