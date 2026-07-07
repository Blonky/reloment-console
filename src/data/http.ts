// HttpClient — the same DataClient interface over the real platform API.
// Uses VITE_API_URL as the base and sends x-tenant-id (VITE_TENANT_ID) on every
// request. Response shapes map 1:1 to the platform's /api/* routes (app.ts);
// this file does the thin unwrapping (e.g. { items } → QueueItem[]).

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
  ConnectionRow,
  ConnectionsCatalog,
  Contact,
  KnowledgeDoc,
  ConversationBrief,
  EnrollResult,
  FeedEvent,
  HomeBriefing,
  HomePulse,
  InboundResult,
  InsightsReport,
  PlaybookFlow,
  QueueItem,
  ResearchReport,
  SearchHit,
  SteerGoal,
  Suggestion,
  ThreadBrief,
  ThreadDetail,
  ThreadMessage,
  ToneProfile,
  OutcomeRow,
} from './types.ts';

export class HttpClient implements DataClient {
  readonly mode = 'http' as const;

  // Optional bearer-token auth (default OFF). The backend enables it only when it
  // sets API_AUTH_TOKEN; a real install then sets VITE_API_TOKEN to match. When
  // unset (the default, incl. the demo) we send nothing — behavior unchanged.
  private readonly authToken = import.meta.env.VITE_API_TOKEN;

  now(): number {
    return Date.now();
  }

  constructor(
    private readonly baseUrl: string,
    private readonly tenantId: string,
  ) {}

  // The tenant identity card — GET /api/tenant → { name, line } (line pre-
  // formatted for display). A missing/failing route degrades to a NEUTRAL
  // placeholder, never Hartley: a real install must never show the demo tenant.
  async tenant(): Promise<{ name: string; line: string }> {
    return this.req<{ name: string; line: string }>('/api/tenant').catch(() => ({
      name: '—',
      line: '',
    }));
  }

  // ── Live event feed (provider SSE feed) ─────────────────────────────────────
  // Connect an EventSource to the provider's stream lazily on the first
  // subscribe; map `message.received` events through to the FeedEvent shape.
  // A missing backend degrades to a silent no-op; the source closes when the
  // last unsubscriber leaves. Reconnect uses ?since=<iso> per the provider docs.
  private feedHandlers = new Set<(e: FeedEvent) => void>();
  private eventSource: EventSource | null = null;
  private lastEventAt: string | null = null;

  subscribe(handler: (e: FeedEvent) => void): () => void {
    this.feedHandlers.add(handler);
    this.ensureStream();
    return () => {
      this.feedHandlers.delete(handler);
      if (this.feedHandlers.size === 0) this.closeStream();
    };
  }

  private ensureStream(): void {
    if (this.eventSource) return;
    try {
      const base = this.baseUrl.replace(/\/$/, '');
      // The browser can't attach the x-tenant-id header to an EventSource, so the
      // tenant travels as a query param the backend reads instead. ?since resumes
      // the feed; ?token authenticates when optional bearer auth is enabled.
      const params = new URLSearchParams({ tenant: this.tenantId });
      if (this.lastEventAt) params.set('since', this.lastEventAt);
      if (this.authToken) params.set('token', this.authToken);
      const es = new EventSource(`${base}/api/v1/events/stream?${params.toString()}`);

      // provider SSE feed: `message.received` carries an inbound ThreadMessage.
      es.addEventListener('message.received', (ev: MessageEvent<string>) => {
        try {
          const data = JSON.parse(ev.data) as {
            conversationId: string;
            message: ThreadMessage;
            at?: string;
          };
          if (data.at) this.lastEventAt = data.at;
          this.emit({
            type: 'message.received',
            conversationId: data.conversationId,
            message: data.message,
          });
        } catch {
          // Malformed frame — ignore rather than tear the stream down.
        }
      });

      // The rest of the live vocabulary. Each frame carries { at? } for resume; we
      // map it to the matching FeedEvent (only names present in the union) so the
      // live surfaces refresh. Every parse is guarded — one malformed frame must
      // not tear the stream down.
      es.addEventListener('message.sent', (ev: MessageEvent<string>) => {
        try {
          const data = JSON.parse(ev.data) as {
            conversationId: string;
            message: ThreadMessage;
            at?: string;
          };
          if (data.at) this.lastEventAt = data.at;
          this.emit({
            type: 'message.sent',
            conversationId: data.conversationId,
            message: data.message,
          });
        } catch {
          // Malformed frame — ignore.
        }
      });

      es.addEventListener('draft.created', (ev: MessageEvent<string>) => {
        try {
          const data = JSON.parse(ev.data) as {
            conversationId: string;
            message: ThreadMessage;
            at?: string;
          };
          if (data.at) this.lastEventAt = data.at;
          this.emit({
            type: 'draft.created',
            conversationId: data.conversationId,
            message: data.message,
          });
        } catch {
          // Malformed frame — ignore.
        }
      });

      es.addEventListener('suggestion.updated', (ev: MessageEvent<string>) => {
        try {
          const data = JSON.parse(ev.data) as { conversationId: string; at?: string };
          if (data.at) this.lastEventAt = data.at;
          this.emit({ type: 'suggestion.updated', conversationId: data.conversationId });
        } catch {
          // Malformed frame — ignore.
        }
      });

      es.addEventListener('steer.changed', (ev: MessageEvent<string>) => {
        try {
          const data = JSON.parse(ev.data) as { conversationId: string; at?: string };
          if (data.at) this.lastEventAt = data.at;
          this.emit({ type: 'steer.changed', conversationId: data.conversationId });
        } catch {
          // Malformed frame — ignore.
        }
      });

      es.addEventListener('agent.toggled', (ev: MessageEvent<string>) => {
        try {
          const data = JSON.parse(ev.data) as {
            conversationId: string;
            enabled: boolean;
            at?: string;
          };
          if (data.at) this.lastEventAt = data.at;
          this.emit({
            type: 'agent.toggled',
            conversationId: data.conversationId,
            enabled: data.enabled,
          });
        } catch {
          // Malformed frame — ignore.
        }
      });

      es.addEventListener('playbook.toggled', (ev: MessageEvent<string>) => {
        try {
          const data = JSON.parse(ev.data) as {
            key: string;
            enabled: boolean;
            at?: string;
          };
          if (data.at) this.lastEventAt = data.at;
          this.emit({ type: 'playbook.toggled', key: data.key, enabled: data.enabled });
        } catch {
          // Malformed frame — ignore.
        }
      });

      es.addEventListener('consent.changed', (ev: MessageEvent<string>) => {
        try {
          const data = JSON.parse(ev.data) as {
            conversationId: string;
            contactId: string;
            optedOut: boolean;
            at?: string;
          };
          if (data.at) this.lastEventAt = data.at;
          this.emit({
            type: 'consent.changed',
            conversationId: data.conversationId,
            contactId: data.contactId,
            optedOut: data.optedOut,
          });
        } catch {
          // Malformed frame — ignore.
        }
      });

      es.addEventListener('call.missed', (ev: MessageEvent<string>) => {
        try {
          const data = JSON.parse(ev.data) as {
            conversationId: string;
            callerName: string;
            e164: string;
            at?: string;
          };
          if (data.at) this.lastEventAt = data.at;
          this.emit({
            type: 'call.missed',
            conversationId: data.conversationId,
            callerName: data.callerName,
            e164: data.e164,
          });
        } catch {
          // Malformed frame — ignore.
        }
      });

      es.addEventListener('knowledge.changed', (ev: MessageEvent<string>) => {
        try {
          const data = JSON.parse(ev.data) as { at?: string };
          if (data.at) this.lastEventAt = data.at;
          this.emit({ type: 'knowledge.changed' });
        } catch {
          // Malformed frame — ignore.
        }
      });

      es.addEventListener('memory.changed', (ev: MessageEvent<string>) => {
        try {
          const data = JSON.parse(ev.data) as { contactId: string; conversationId?: string; at?: string };
          if (data.at) this.lastEventAt = data.at;
          this.emit({ type: 'memory.changed', contactId: data.contactId, conversationId: data.conversationId });
        } catch {
          // Malformed frame — ignore.
        }
      });

      es.onerror = () => {
        // Missing/failing backend: degrade to a silent no-op.
        this.closeStream();
      };
      this.eventSource = es;
    } catch {
      // No EventSource / no backend — silent no-op.
      this.eventSource = null;
    }
  }

  private closeStream(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  private emit(event: FeedEvent): void {
    for (const h of this.feedHandlers) h(event);
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.baseUrl.replace(/\/$/, '') + path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': this.tenantId,
        // Optional bearer auth: only attached when VITE_API_TOKEN is set.
        ...(this.authToken ? { authorization: `Bearer ${this.authToken}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = JSON.stringify(await res.json());
      } catch {
        detail = res.statusText;
      }
      throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status} ${detail}`);
    }
    return (await res.json()) as T;
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.req<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  home(): Promise<HomePulse> {
    return this.req<HomePulse>('/api/home');
  }

  async queue(): Promise<QueueItem[]> {
    const { items } = await this.req<{ items: QueueItem[] }>('/api/queue');
    return items;
  }

  thread(conversationId: string): Promise<ThreadDetail> {
    return this.req<ThreadDetail>(`/api/threads/${encodeURIComponent(conversationId)}`);
  }

  approve(conversationId: string, messageId: string): Promise<ApproveResult> {
    return this.post<ApproveResult>(
      `/api/threads/${encodeURIComponent(conversationId)}/approve`,
      { messageId },
    );
  }

  async edit(conversationId: string, messageId: string, body: string): Promise<void> {
    await this.post<{ ok: boolean }>(
      `/api/threads/${encodeURIComponent(conversationId)}/edit`,
      { messageId, body },
    );
  }

  // Messages-first thread (v4): the Agent ON/OFF switch. POST the new state; a
  // missing/failing route degrades to a silent no-op rather than throwing at UI.
  async setAgentEnabled(conversationId: string, enabled: boolean): Promise<void> {
    await this.post<{ ok: boolean }>(
      `/api/threads/${encodeURIComponent(conversationId)}/agent`,
      { enabled },
    ).catch(() => undefined);
  }

  // takeover() is a thin alias for turning the agent OFF, kept for compatibility.
  async takeover(conversationId: string): Promise<void> {
    await this.setAgentEnabled(conversationId, false);
  }

  // The agent's next-best message for the composer. A missing route or a "no
  // suggestion" answer both resolve to null (the honest silence state).
  async suggestion(conversationId: string): Promise<Suggestion | null> {
    return this.req<Suggestion | null>(
      `/api/threads/${encodeURIComponent(conversationId)}/suggestion`,
    ).catch(() => null);
  }

  simulateInbound(conversationId: string, text: string): Promise<InboundResult> {
    return this.post<InboundResult>('/api/simulate/inbound', { conversationId, text });
  }

  // Steering (r10): POST the per-conversation goal (null clears). A missing or
  // failing route degrades to a silent no-op rather than throwing at the UI.
  async steer(conversationId: string, goal: SteerGoal | null, note?: string): Promise<void> {
    await this.post<{ ok: boolean }>(
      `/api/threads/${encodeURIComponent(conversationId)}/steer`,
      { goal, note },
    ).catch(() => undefined);
  }

  // ── Operations (round 7) ────────────────────────────────────────────────────
  // A missed call arrives via the voice-capture forward and the provider emits
  // it on the SSE stream; here we ask the backend to simulate one for the demo.
  simulateMissedCall(): Promise<{ conversationId: string }> {
    return this.post<{ conversationId: string }>('/api/simulate/missed_call', {});
  }

  // Human follow-up — the backend re-runs the send gate (fail-closed): a clear
  // gate returns { ok:true }; a block returns { ok:false, blockedReason }.
  sendManual(conversationId: string, body: string): Promise<{ ok: boolean; blockedReason?: string }> {
    return this.post<{ ok: boolean; blockedReason?: string }>(
      `/api/threads/${encodeURIComponent(conversationId)}/send`,
      { body },
    ).catch(() => ({ ok: false, blockedReason: 'gate_error' }));
  }

  // Gated document request (silently a no-op if blocked). The customer's media
  // reply arrives later over the SSE stream as a message.received with parts.
  async requestDocument(conversationId: string, docType: string): Promise<void> {
    await this.post<{ ok: boolean }>(
      `/api/threads/${encodeURIComponent(conversationId)}/request_document`,
      { docType },
    ).catch(() => undefined);
  }

  // Send a rich-link message (booking / payment / document_request). The backend
  // re-runs the send gate (fail-closed): a clear gate returns { ok:true }; a
  // block returns { ok:false, blockedReason }. The provider unfurls the link into
  // a preview card; the outbound carries a LinkPart on message.sent over the SSE
  // stream. A missing/failing route degrades to a gate_error rather than throwing.
  sendLink(
    conversationId: string,
    kind: 'booking' | 'payment' | 'document_request',
    docType?: string,
  ): Promise<{ ok: boolean; blockedReason?: string }> {
    return this.post<{ ok: boolean; blockedReason?: string }>(
      `/api/threads/${encodeURIComponent(conversationId)}/send_link`,
      { kind, docType },
    ).catch(() => ({ ok: false, blockedReason: 'gate_error' }));
  }

  // Agent asks — the agent's prompts back to the business. Served empty rather
  // than faked when the route is absent, so the briefing degrades honestly.
  async agentAsks(): Promise<AgentAsk[]> {
    return this.req<AgentAsk[]>('/api/agent-asks').catch(() => []);
  }

  // Home briefing — one composed read. A missing route degrades to an honest
  // empty briefing rather than throwing at the UI.
  async homeBriefing(): Promise<HomeBriefing> {
    return this.req<HomeBriefing>('/api/home-briefing').catch(() => ({
      needsYou: [],
      overnight: [],
      callOut: [],
      asks: [],
    }));
  }

  async queryBook(kind: 'renewals' | 'lapsed'): Promise<BookRow[]> {
    const { rows } = await this.post<{ rows: BookRow[] }>('/api/tools/query_book', { kind });
    return rows;
  }

  enrollPlaybook(playbookKey: string): Promise<EnrollResult> {
    return this.post<EnrollResult>('/api/tools/enroll_playbook', { playbookKey });
  }

  async campaignStatus(): Promise<CampaignRow[]> {
    const { playbooks } = await this.req<{ playbooks: CampaignRow[] }>(
      '/api/tools/campaign_status',
    );
    return playbooks;
  }

  // Playbook flows for the merged Agent tab — served empty rather than faked when
  // the route is absent, so the Agent surface degrades honestly against a backend.
  async playbookFlows(): Promise<PlaybookFlow[]> {
    return this.req<PlaybookFlow[]>('/api/playbook-flows').catch(() => []);
  }

  // Turn a playbook on/off for the tenant. A missing/failing route is a silent
  // no-op (the UI's optimistic toggle stands until the next read).
  async setPlaybookEnabled(key: string, enabled: boolean): Promise<void> {
    await this.post<{ ok: boolean }>('/api/playbook-flows/toggle', { key, enabled }).catch(
      () => undefined,
    );
  }

  async threadBrief(contactId: string): Promise<ThreadBrief> {
    const raw = await this.req<Omit<ThreadBrief, 'contactId' | 'conversationId'>>(
      `/api/tools/thread_brief/${encodeURIComponent(contactId)}`,
    );
    // conversationId: the thread_brief route keys on contactId and does not return
    // a conversationId, so deep-linking from a brief to the exact thread isn't
    // available on a live install until the backend surfaces one here.
    return { contactId, conversationId: null, ...raw };
  }

  async searchConversations(q: string): Promise<SearchHit[]> {
    const { messages, memory } = await this.post<{
      messages: { body: string; display_name: string }[];
      memory: { value: string; display_name: string }[];
    }>('/api/tools/search_conversations', { q });
    return [
      ...messages.map((m): SearchHit => ({ kind: 'message', ...m })),
      ...memory.map((m): SearchHit => ({ kind: 'memory', ...m })),
    ];
  }

  async setKillSwitch(on: boolean): Promise<void> {
    await this.post<{ ok: boolean; killSwitch: boolean }>('/api/tools/kill_switch', { on });
  }

  // Conversation brief / ask-the-thread. Graceful failure: a missing route
  // returns an empty-but-honest brief rather than throwing at the UI.
  async conversationBrief(conversationId: string): Promise<ConversationBrief> {
    return this.req<ConversationBrief>(
      `/api/v1/threads/${encodeURIComponent(conversationId)}/brief`,
    ).catch(() => ({
      summary: 'Brief unavailable — the backend has no brief for this conversation yet.',
      moments: [],
      askSuggestions: [],
    }));
  }

  async askThread(conversationId: string, question: string): Promise<{ answer: string }> {
    return this.post<{ answer: string }>(
      `/api/v1/threads/${encodeURIComponent(conversationId)}/ask`,
      { question },
    ).catch(() => ({
      answer: 'The backend could not answer this question right now.',
    }));
  }

  // Read-model surfaces. The platform exposes these via the same governed reads;
  // until a dedicated route lands they are served empty rather than faked, so the
  // structured-skeleton screens degrade honestly against a live backend.
  async contacts(): Promise<Contact[]> {
    return this.req<Contact[]>('/api/contacts').catch(() => []);
  }
  async outcomes(): Promise<OutcomeRow[]> {
    return this.req<OutcomeRow[]>('/api/outcomes').catch(() => []);
  }
  // The owner's report (r14). Degrades to an empty WORK band + empty PIPELINE when
  // the route is absent — never faked.
  async insightsReport(): Promise<InsightsReport> {
    return this.req<InsightsReport>('/api/insights-report').catch(() => ({
      activity: {
        conversations: 0,
        sent: 0,
        heldForReview: 0,
        blockedByGate: 0,
        missedCallsAnswered: 0,
        medianFirstReplyMin: null,
      },
      pipeline: {
        renewals30d: [],
        reactivation: [],
        bundle: [],
        more: { renewals30d: 0, reactivation: 0, bundle: 0 },
      },
    }));
  }
  async auditSample(): Promise<AuditRow[]> {
    return this.req<AuditRow[]>('/api/audit').catch(() => []);
  }
  async optOuts(): Promise<Contact[]> {
    return this.req<Contact[]>('/api/opt-outs').catch(() => []);
  }

  // Correct an opt-out record made in error (r16). The backend re-validates the
  // reason and restores the contact's full prior consent. A missing/failing route
  // degrades to { ok:false } (fail-closed — nothing changes) rather than throwing.
  async correctOptOut(contactId: string, reason: string): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>(
      `/api/opt-outs/${encodeURIComponent(contactId)}/correct`,
      { reason },
    ).catch(() => ({ ok: false }));
  }

  // Producer worklist — served empty rather than faked when the route is absent.
  async callList(): Promise<CallListRow[]> {
    return this.req<CallListRow[]>('/api/call-list').catch(() => []);
  }

  // Voice/tone tuning profile — degrades to an honest untuned placeholder.
  async toneProfile(): Promise<ToneProfile> {
    return this.req<ToneProfile>('/api/tone-profile').catch(() => ({
      trainedOn: 'Not yet tuned — connect the platform to train on your conversations.',
      traits: [],
      example: { generic: '', tuned: '' },
    }));
  }

  // Agent profile (r10) — the merged Agent surface's identity card. Degrades to
  // an honest untuned placeholder with the fixed guardrails still shown.
  async agentProfile(): Promise<AgentProfile> {
    return this.req<AgentProfile>('/api/agent-profile').catch(() => ({
      name: 'Your concierge',
      line: '—',
      trainedOn: 'Not yet tuned — connect the platform to train on your conversations.',
      traits: [],
      example: { generic: '', tuned: '' },
      guardrails: [
        'Never gives coverage or legal advice — routes to a licensed human',
        'Only texts people with consent on file — the gate refuses everything else',
        'Respects quiet hours in the customer’s timezone',
        'STOP always sticks — only the customer can opt back in',
      ],
    }));
  }

  // Booking connection — degrades to a not-connected honest state.
  async bookingConnection(): Promise<{ provider: string; status: 'connected'; calendar: string }> {
    return this.req<{ provider: string; status: 'connected'; calendar: string }>(
      '/api/booking-connection',
    ).catch(() => ({ provider: '—', status: 'connected', calendar: 'Not connected' }));
  }

  // The Connections surface — served empty when the route is absent, so the
  // Trust grid degrades honestly (nothing shown as connected without proof).
  async connections(): Promise<ConnectionRow[]> {
    return this.req<ConnectionRow[]>('/api/connections').catch(() => []);
  }

  // ── Agent brain (r13) — editable voice + knowledge base ─────────────────────
  // Maps 1:1 to the pinned platform routes. Reads that fail degrade to an honest
  // untuned/empty state; writes echo the server's response (or a local fallback so
  // the optimistic UI stands until the next read).
  async agentVoice(): Promise<AgentVoice> {
    return this.req<AgentVoice>('/api/agent/voice').catch(() => ({
      name: 'Your concierge',
      traits: [],
      instructions: '',
    }));
  }

  async updateAgentVoice(patch: Partial<AgentVoice>): Promise<AgentVoice> {
    return this.req<AgentVoice>('/api/agent/voice', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }).catch(() => this.agentVoice());
  }

  async knowledgeDocs(): Promise<KnowledgeDoc[]> {
    return this.req<KnowledgeDoc[]>('/api/knowledge').catch(() => []);
  }

  async createKnowledgeDoc(
    doc: Pick<KnowledgeDoc, 'kind' | 'title' | 'body'> &
      Partial<Pick<KnowledgeDoc, 'filename' | 'size_bytes'>>,
  ): Promise<KnowledgeDoc> {
    return this.post<KnowledgeDoc>('/api/knowledge', doc);
  }

  async updateKnowledgeDoc(
    id: string,
    patch: Partial<Pick<KnowledgeDoc, 'title' | 'body'>>,
  ): Promise<KnowledgeDoc> {
    return this.req<KnowledgeDoc>(`/api/knowledge/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  }

  async deleteKnowledgeDoc(id: string): Promise<void> {
    await this.req<{ ok: boolean }>(`/api/knowledge/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).catch(() => undefined);
  }

  // Upload a file (r19). The UI has already read the file into base64; we POST
  // { filename, mime_type, content_base64 } to /api/knowledge/upload, where the
  // platform decodes, parses (binaries), and chunks (long text) into `file` docs
  // and emits knowledge.changed on its stream. A missing/failing route degrades to
  // a silent no-op so the optimistic UI stands until the next knowledgeDocs() read.
  async uploadKnowledgeFile(file: {
    filename: string;
    mime_type: string;
    content_base64: string;
  }): Promise<void> {
    await this.post<{ ok: boolean }>('/api/knowledge/upload', file).catch(() => undefined);
  }

  // The Connections marketplace — GET the catalog; POST a request. A missing
  // catalog route degrades to just the connected rows with an empty available
  // list; a failing request resolves ok so the optimistic UI stands.
  async connectionsCatalog(): Promise<ConnectionsCatalog> {
    return this.req<ConnectionsCatalog>('/api/connections/catalog').catch(async () => ({
      connected: await this.connections(),
      available: [],
    }));
  }

  async requestConnection(key: string, note?: string): Promise<{ ok: true }> {
    return this.post<{ ok: true }>('/api/connections/request', { key, note }).catch(
      () => ({ ok: true as const }),
    );
  }

  // ── Agent workspace (r11) — maps to the platform's /api/agent/sessions CRUD ──
  // GET/POST/DELETE /api/agent/sessions(…)/messages, mirroring the real routes.
  // Reads that fail degrade to empty (an honest "no history yet"); writes fail
  // silently (the UI's optimistic transcript stands until the next read).
  async agentSessions(): Promise<AgentSession[]> {
    // Newest-first is the platform's contract; sort defensively regardless.
    const list = await this.req<AgentSession[]>('/api/agent/sessions').catch(() => []);
    return list.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async createAgentSession(): Promise<AgentSession> {
    return this.post<AgentSession>('/api/agent/sessions', {}).catch(() => ({
      // A local placeholder so the UI can open a chat even if the write failed;
      // it reconciles on the next agentSessions() read.
      id: `local_${Date.now()}`,
      title: 'New chat',
      updated_at: new Date().toISOString(),
    }));
  }

  async deleteAgentSession(id: string): Promise<void> {
    await this.req<{ ok: boolean }>(`/api/agent/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).catch(() => undefined);
  }

  async agentSessionMessages(id: string): Promise<AgentChatMessage[]> {
    return this.req<AgentChatMessage[]>(
      `/api/agent/sessions/${encodeURIComponent(id)}/messages`,
    ).catch(() => []);
  }

  async appendAgentMessage(id: string, role: 'user' | 'assistant', body: string): Promise<void> {
    await this.post<{ ok: boolean }>(
      `/api/agent/sessions/${encodeURIComponent(id)}/messages`,
      { role, body },
    ).catch(() => undefined);
  }

  async renameAgentSession(id: string, title: string): Promise<void> {
    // The platform patches the session title; POST keeps the client dependency-
    // free (no PATCH helper). A missing/failing route is a silent no-op.
    await this.post<{ ok: boolean }>(
      `/api/agent/sessions/${encodeURIComponent(id)}/rename`,
      { title },
    ).catch(() => undefined);
  }

  // Research / waterfall enrichment — POST /api/agent/enrich, mapping onto the
  // platform's enrich_contact response shape. A missing/failing route resolves
  // to null (the honest "no report" state) rather than throwing at the UI.
  async researchContact(nameOrId: string): Promise<ResearchReport | null> {
    return this.post<ResearchReport | null>('/api/agent/enrich', { query: nameOrId }).catch(
      () => null,
    );
  }

  // Navigation intent — computed LOCALLY, no server round-trip needed. Section
  // words route to their surface; a contact name routes to /contacts?c=<query>
  // (the HTTP client has no local thread map, so the contacts book is the honest
  // target — the UI can deep-link into the conversation from there).
  async resolveNavigate(query: string): Promise<{ label: string; href: string } | null> {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const sections: { match: string[]; label: string; href: string }[] = [
      { match: ['inbox', 'approvals'], label: 'Inbox', href: '/inbox' },
      { match: ['agent', 'flows', 'playbooks'], label: 'Agent', href: '/agent' },
      { match: ['insights', 'revenue'], label: 'Insights', href: '/insights' },
      { match: ['settings', 'trust', 'connections'], label: 'Settings', href: '/settings' },
      { match: ['contacts', 'book'], label: 'Contacts', href: '/contacts' },
    ];
    const words = q.split(/\s+/);
    for (const s of sections) {
      if (s.match.some((m) => words.includes(m))) return { label: s.label, href: s.href };
    }
    // No section matched — treat the query as a contact name search on Contacts.
    return { label: query.trim(), href: `/contacts?q=${encodeURIComponent(query.trim())}` };
  }
}
