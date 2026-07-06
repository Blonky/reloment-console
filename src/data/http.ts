// HttpClient — the same DataClient interface over the real platform API.
// Uses VITE_API_URL as the base and sends x-tenant-id (VITE_TENANT_ID) on every
// request. Response shapes map 1:1 to the platform's /api/* routes (app.ts);
// this file does the thin unwrapping (e.g. { items } → QueueItem[]).

import type { DataClient } from './client.ts';
import type {
  ApproveResult,
  AuditRow,
  BookRow,
  CampaignRow,
  Contact,
  ConversationBrief,
  EnrollResult,
  FeedEvent,
  HomePulse,
  InboundResult,
  QueueItem,
  SearchHit,
  ThreadBrief,
  ThreadDetail,
  ThreadMessage,
  OutcomeRow,
  LineAgent,
} from './types.ts';

export class HttpClient implements DataClient {
  readonly mode = 'http' as const;

  now(): number {
    return Date.now();
  }

  constructor(
    private readonly baseUrl: string,
    private readonly tenantId: string,
  ) {}

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
      const since = this.lastEventAt ? `?since=${encodeURIComponent(this.lastEventAt)}` : '';
      const es = new EventSource(`${base}/api/v1/events/stream${since}`);
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

  async takeover(conversationId: string): Promise<void> {
    await this.post<{ ok: boolean }>(
      `/api/threads/${encodeURIComponent(conversationId)}/takeover`,
      {},
    );
  }

  simulateInbound(conversationId: string, text: string): Promise<InboundResult> {
    return this.post<InboundResult>('/api/simulate/inbound', { conversationId, text });
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

  async threadBrief(contactId: string): Promise<ThreadBrief> {
    const raw = await this.req<Omit<ThreadBrief, 'contactId' | 'conversationId'>>(
      `/api/tools/thread_brief/${encodeURIComponent(contactId)}`,
    );
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
  async agents(): Promise<LineAgent[]> {
    return this.req<LineAgent[]>('/api/agents').catch(() => []);
  }
  async auditSample(): Promise<AuditRow[]> {
    return this.req<AuditRow[]>('/api/audit').catch(() => []);
  }
  async optOuts(): Promise<Contact[]> {
    return this.req<Contact[]>('/api/opt-outs').catch(() => []);
  }
}
