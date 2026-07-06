// Inbox — the approval cockpit (DESIGN.md §5). Three-pane: triage 300px | thread
// flex | context rail 280px, each filling the viewport height under the topbar
// and scrolling independently. The product's hero screen.
//
// Data flow:
//   - The triage list is built from every contact's conversation (discovered via
//     threadBrief, which returns each contact's conversationId) merged with the
//     live queue() so awaiting-approval rows carry the right tag and sort first.
//   - Selection is URL state (?c=<conversationId>) so threads deep-link.
//   - After approve / send / toggle / simulateInbound we refetch the selected
//     thread, the suggestion, AND the discovery set so pills/ordering stay true.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useClient } from '../../shell/ClientContext.tsx';
import { useData } from '../../data/useData.ts';
import type {
  ApproveResult,
  Contact,
  FeedEvent,
  QueueItem,
  Suggestion,
  ThreadBrief,
} from '../../data/types.ts';
import Inspector from '../../shell/Inspector.tsx';
import TriagePane, { type TriageRowModel } from './TriagePane.tsx';
import ThreadPane, { type TypingState } from './ThreadPane.tsx';
import ContextRail from './ContextRail.tsx';
import ConversationBrief from './ConversationBrief.tsx';
import {
  MISSED_CALL_MARKER,
  previewText,
  triageTag,
  triageWeight,
  type TriageTag,
} from './inboxUtils.ts';
import styles from './InboxScreen.module.css';

interface Discovery {
  contacts: Contact[];
  briefs: Map<string, ThreadBrief>; // contactId → brief (conversationId + recent)
  queue: QueueItem[];
}

// Track the mobile breakpoint (≤768px) so the cockpit can run a single-pane
// flow: the triage list and the thread pane never show at the same time.
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

export default function InboxScreen() {
  const client = useClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('c');
  const isMobile = useIsMobile();

  // A nonce that bumps after any mutation, forcing the discovery set to refetch.
  const [discoveryNonce, setDiscoveryNonce] = useState(0);

  // ── Discovery: contacts + their conversation briefs + the live queue ─────────
  const discovery = useData<Discovery>(async () => {
    const [contacts, queue] = await Promise.all([client.contacts(), client.queue()]);
    const briefEntries = await Promise.all(
      contacts.map(async (c): Promise<[string, ThreadBrief] | null> => {
        try {
          const brief = await client.threadBrief(c.id);
          return brief.conversationId !== null ? [c.id, brief] : null;
        } catch {
          return null;
        }
      }),
    );
    const briefs = new Map<string, ThreadBrief>();
    for (const entry of briefEntries) if (entry !== null) briefs.set(entry[0], entry[1]);
    return { contacts, briefs, queue };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, discoveryNonce]);

  // Build the triage rows: one per contact-with-a-conversation, tagged/sorted.
  const triageRows = useMemo<TriageRowModel[]>(() => {
    const d = discovery.data;
    if (d === undefined) return [];

    // Which conversations have a pending draft / are routed to a human, from queue.
    const pendingByConv = new Set<string>();
    const routedByConv = new Set<string>();
    for (const q of d.queue) {
      if (q.status === 'awaiting_approval') pendingByConv.add(q.conversation_id);
      else if (q.status === 'routed_to_human') routedByConv.add(q.conversation_id);
    }

    const rows: TriageRowModel[] = [];
    for (const c of d.contacts) {
      const brief = d.briefs.get(c.id);
      if (brief === undefined || brief.conversationId === null) continue;
      const convId = brief.conversationId;
      const last = brief.recent[0]; // recent is newest-first
      const wonBack = c.memory.some((m) => m.value.toLowerCase().includes('won back'));
      // Session-minted missed-call conversation (Ray) — detected by the marker
      // its opening system entry carries, so it tags as "Missed call".
      const missedCall = brief.recent.some((m) =>
        m.body.toLowerCase().includes(MISSED_CALL_MARKER),
      );

      const tag: TriageTag = triageTag({
        optedOut: c.optedOut,
        hasPendingDraft: pendingByConv.has(convId),
        routedToHuman: routedByConv.has(convId),
        wonBack,
        missedCall,
        lastDirection: last?.direction ?? null,
      });

      rows.push({
        conversationId: convId,
        contactId: c.id,
        name: c.display_name,
        preview: last ? previewText(last.body) : 'No messages yet',
        lastAt: last?.created_at ?? c.lastActivity,
        // Unread = an inbound the operator hasn't actioned (pending or routed),
        // or a fresh missed-call text-back that just landed.
        unread: pendingByConv.has(convId) || routedByConv.has(convId) || missedCall,
        tag,
        weight: triageWeight(tag),
      });
    }

    // Needs-you-first: by weight, then most-recent activity within a weight band.
    rows.sort((a, b) => {
      if (a.weight !== b.weight) return a.weight - b.weight;
      return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
    });
    return rows;
  }, [discovery.data]);

  // Default selection: first row (needs-you-first) once discovery resolves.
  // Skipped on mobile — phones open on the triage list; the thread is a push.
  useEffect(() => {
    if (!isMobile && selectedId === null && triageRows.length > 0) {
      setSearchParams({ c: triageRows[0].conversationId }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, triageRows, isMobile]);

  const onSelect = useCallback(
    (conversationId: string) => {
      setSearchParams({ c: conversationId });
    },
    [setSearchParams],
  );

  // Mobile back chevron: clear ?c= to return from the thread to the triage list.
  const onBack = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('c');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  // ── Thread detail for the selected conversation ─────────────────────────────
  const thread = useData(
    () => (selectedId !== null ? client.thread(selectedId) : Promise.resolve(undefined)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, selectedId, discoveryNonce],
  );

  const detail = thread.data ?? undefined;

  // ── The agent's next-best message for the suggestion slot ────────────────────
  // Refetched on conversation change and after every 'suggestion.updated' for the
  // selected conversation (a nonce bump). null = silence (opted out / pushy) →
  // the slot renders nothing and the composer stands alone.
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  // Track which conversation the current suggestion belongs to. On a selection
  // change we CLEAR the slot synchronously (below) so thread B never flashes
  // thread A's card during the ~250ms refetch.
  const suggestionConvRef = useRef(selectedId);
  // Clear immediately when the selection changes — before the async refetch —
  // so a stale suggestion from the previous thread never shows for a beat.
  if (suggestionConvRef.current !== selectedId) {
    suggestionConvRef.current = selectedId;
    if (suggestion !== null) setSuggestion(null);
  }
  useEffect(() => {
    if (selectedId === null) {
      setSuggestion(null);
      return;
    }
    let live = true;
    void client.suggestion(selectedId).then((s) => {
      // The cleanup flips `live` on any selection change, so a late resolve for
      // the previous conversation is discarded — no cross-thread leak.
      if (live) setSuggestion(s);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, selectedId, discoveryNonce]);

  // Refetch discipline: bump the nonce so discovery (queue + briefs + tags), the
  // thread detail, and the suggestion all reload after any mutation.
  const refetchAll = useCallback(() => {
    setDiscoveryNonce((n) => n + 1);
  }, []);

  // Whether sending is globally active (kill switch off). Feeds the thread's
  // quiet "Live" presence signal. consent.changed / mutations refresh it too.
  const pulse = useData(() => client.home(), [client, discoveryNonce]);
  const sendingActive = pulse.data ? !pulse.data.killSwitch : true;

  // ── Live event feed ─────────────────────────────────────────────────────────
  // A single subscription for the whole screen (unsubscribed on unmount). Events
  // for the SELECTED conversation drive the thread live (refetch it — the store
  // is authoritative) and set/clear the typing indicator; events for OTHER
  // conversations refresh the triage list (preview/time/unread) via the nonce.
  // typing state is per-conversation: keep a ref of the selected id so the stable
  // handler always compares against the current selection.
  const [typing, setTyping] = useState<TypingState>(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  useEffect(() => {
    const unsubscribe = client.subscribe((e: FeedEvent) => {
      const isSelected = e.conversationId === selectedRef.current;
      if (e.type === 'typing') {
        if (!isSelected) return; // typing only matters for the open thread
        setTyping(e.state === 'typing' ? { who: e.who } : null);
        return;
      }
      // A missed call mints a NEW conversation. Refresh triage so it appears,
      // and — so the operator WATCHES the text-back choreography — auto-select
      // it when nothing is open yet (deep links / an already-open thread win).
      if (e.type === 'call.missed') {
        refetchAll();
        if (selectedRef.current === null) {
          selectedRef.current = e.conversationId; // avoid a re-select race
          setSearchParams({ c: e.conversationId });
        }
        return;
      }
      // A concrete event landed: clear any typing bubble for that party and
      // reload. Selected → refetch the open thread (and discovery for the pill);
      // other → refetch discovery so the triage row updates.
      if (isSelected) setTyping(null);
      refetchAll();
    });
    return unsubscribe;
  }, [client, refetchAll, setSearchParams]);

  // Clear a stale typing bubble whenever the selection changes.
  useEffect(() => {
    setTyping(null);
  }, [selectedId]);

  const onApprove = useCallback(
    async (draftId: string): Promise<ApproveResult> => {
      if (selectedId === null) throw new Error('no conversation selected');
      const res = await client.approve(selectedId, draftId);
      refetchAll();
      return res;
    },
    [client, selectedId, refetchAll],
  );

  // A free-text composer send as the business (sendManual). Same fail-closed
  // gate as approve; a human send never changes agent_enabled and clears any
  // stale held draft (the data layer handles both). Resolves false when blocked
  // so the composer keeps the text.
  const onSend = useCallback(
    async (body: string): Promise<boolean> => {
      if (selectedId === null) return false;
      const res = await client.sendManual(selectedId, body);
      refetchAll();
      return res.ok;
    },
    [client, selectedId, refetchAll],
  );

  // Flip the per-conversation Agent ON/OFF switch. Optimistic in the toggle;
  // the store confirms via agent.toggled and refetchAll reconciles state.
  const onToggleAgent = useCallback(
    async (enabled: boolean): Promise<void> => {
      if (selectedId === null) return;
      await client.setAgentEnabled(selectedId, enabled);
      refetchAll();
    },
    [client, selectedId, refetchAll],
  );

  const onSimulate = useCallback(
    async (text: string): Promise<void> => {
      if (selectedId === null) return;
      await client.simulateInbound(selectedId, text);
      refetchAll();
    },
    [client, selectedId, refetchAll],
  );

  // Send a rich link (booking / payment / document-request) via the composer's
  // ＋ menu. Same fail-closed gate; the link-preview bubble (or a GateReason on a
  // block) lands via the thread refetch. Resolves false when blocked.
  const onSendLink = useCallback(
    async (kind: 'booking' | 'payment' | 'document_request', docType?: string): Promise<boolean> => {
      if (selectedId === null) return false;
      const res = await client.sendLink(selectedId, kind, docType);
      refetchAll();
      return res.ok;
    },
    [client, selectedId, refetchAll],
  );

  // Demo affordance: mint a missed call, then open its conversation so the
  // operator watches the text-back choreography (missed-call entry → agent
  // typing → auto-ack). The call.missed handler also auto-selects when nothing
  // is open; selecting here guarantees the watch even from another thread.
  const [simulatingMissedCall, setSimulatingMissedCall] = useState(false);
  const onSimulateMissedCall = useCallback(async (): Promise<void> => {
    if (simulatingMissedCall) return;
    setSimulatingMissedCall(true);
    try {
      const { conversationId } = await client.simulateMissedCall();
      setSearchParams({ c: conversationId });
      refetchAll();
    } finally {
      setSimulatingMissedCall(false);
    }
  }, [client, simulatingMissedCall, setSearchParams, refetchAll]);

  const triageLoading = discovery.loading && discovery.data === undefined;
  const threadLoading = selectedId !== null && thread.loading && thread.data === undefined;

  // Context sheet (shown <1100px). Close it whenever the selected thread changes
  // so it never lingers over a different conversation.
  const [contextSheetOpen, setContextSheetOpen] = useState(false);
  useEffect(() => {
    setContextSheetOpen(false);
  }, [selectedId]);

  // Conversation brief overlay (the shared Inspector). Close it on selection
  // change so it never renders a different conversation's brief.
  const [briefOpen, setBriefOpen] = useState(false);
  useEffect(() => {
    setBriefOpen(false);
  }, [selectedId]);

  // On mobile the cockpit is single-pane: showing the thread iff one is selected.
  const showThreadOnMobile = selectedId !== null;

  return (
    <div
      className={styles.cockpit}
      data-mobile-view={showThreadOnMobile ? 'thread' : 'list'}
    >
      <TriagePane
        rows={triageRows}
        loading={triageLoading}
        selectedId={selectedId}
        onSelect={onSelect}
        onSimulateMissedCall={onSimulateMissedCall}
        simulatingMissedCall={simulatingMissedCall}
      />
      <ThreadPane
        detail={detail}
        loading={threadLoading}
        suggestion={suggestion}
        typing={typing}
        sendingActive={sendingActive}
        onApprove={onApprove}
        onSend={onSend}
        onSendLink={onSendLink}
        onToggleAgent={onToggleAgent}
        onOpenContext={() => setContextSheetOpen(true)}
        onBack={onBack}
      />
      {/* Docked rail — the grid's third column; CSS hides it below 1100px. */}
      <div className={styles.railDocked}>
        <ContextRail
          detail={detail}
          loading={threadLoading}
          onSimulate={onSimulate}
          onOpenBrief={() => setBriefOpen(true)}
          refreshKey={discoveryNonce}
        />
      </div>
      {/* Context sheet — the same rail as a right slide-over below 1100px. */}
      {contextSheetOpen && (
        <>
          <div
            className={styles.sheetScrim}
            onMouseDown={() => setContextSheetOpen(false)}
            aria-hidden="true"
          />
          <div className={styles.sheet}>
            <ContextRail
              detail={detail}
              loading={threadLoading}
              onSimulate={onSimulate}
              onOpenBrief={() => setBriefOpen(true)}
              refreshKey={discoveryNonce}
              variant="sheet"
              onClose={() => setContextSheetOpen(false)}
            />
          </div>
        </>
      )}

      {/* Conversation brief — the shared Inspector overlay. */}
      <Inspector
        open={briefOpen && selectedId !== null}
        onClose={() => setBriefOpen(false)}
        title="Conversation brief"
      >
        {selectedId !== null && <ConversationBrief conversationId={selectedId} />}
      </Inspector>
    </div>
  );
}
