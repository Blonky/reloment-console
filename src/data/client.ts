// The DataClient seam. Everything renders against this interface; the console
// never fetches directly. createClient() returns HttpClient iff VITE_API_URL is
// set, else the deterministic DemoClient (the default open-source experience).

import type {
  ApproveResult,
  AuditRow,
  BookRow,
  CampaignRow,
  Contact,
  EnrollResult,
  HomePulse,
  InboundResult,
  LineAgent,
  OutcomeRow,
  QueueItem,
  SearchHit,
  ThreadBrief,
  ThreadDetail,
} from './types.ts';

export interface DataClient {
  // Identifies the backing implementation for the Topbar "Demo data" pill.
  readonly mode: 'demo' | 'http';

  // Home
  home(): Promise<HomePulse>;

  // Inbox (hero — Wave 2 builds the UI against these)
  queue(): Promise<QueueItem[]>;
  thread(conversationId: string): Promise<ThreadDetail>;
  approve(conversationId: string, messageId: string): Promise<ApproveResult>;
  edit(conversationId: string, messageId: string, body: string): Promise<void>;
  takeover(conversationId: string): Promise<void>;
  simulateInbound(conversationId: string, text: string): Promise<InboundResult>;

  // Command channel / tools
  queryBook(kind: 'renewals' | 'lapsed'): Promise<BookRow[]>;
  enrollPlaybook(playbookKey: string): Promise<EnrollResult>;
  campaignStatus(): Promise<CampaignRow[]>;
  threadBrief(contactId: string): Promise<ThreadBrief>;
  searchConversations(q: string): Promise<SearchHit[]>;
  setKillSwitch(on: boolean): Promise<void>;

  // Read-model surfaces for the structured-skeleton screens.
  contacts(): Promise<Contact[]>;
  outcomes(): Promise<OutcomeRow[]>;
  agents(): Promise<LineAgent[]>;
  auditSample(): Promise<AuditRow[]>;
  optOuts(): Promise<Contact[]>;
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
