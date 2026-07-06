// Inbox — the approval cockpit (DESIGN.md §5). Three-pane: triage 300px | thread
// flex | context rail 280px, each filling the viewport height under the topbar
// and scrolling independently. The product's hero screen.
//
// Data flow:
//   - The triage list is built from every contact's conversation (discovered via
//     threadBrief, which returns each contact's conversationId) merged with the
//     live queue() so awaiting-approval rows carry the right tag and sort first.
//   - Selection is URL state (?c=<conversationId>) so threads deep-link.
//   - After approve / edit / takeover / simulateInbound we refetch the selected
//     thread AND the discovery set so pills and ordering stay truthful.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useClient } from '../../shell/ClientContext.tsx';
import { useData } from '../../data/useData.ts';
import type {
  ApproveResult,
  Contact,
  QueueItem,
  ThreadBrief,
  ThreadMessage,
} from '../../data/types.ts';
import TriagePane, { type TriageRowModel } from './TriagePane.tsx';
import ThreadPane from './ThreadPane.tsx';
import ContextRail from './ContextRail.tsx';
import {
  previewText,
  triageTag,
  triageWeight,
  type TriageTag,
} from './inboxUtils.ts';
import styles from './InboxScreen.module.css';

// Playbook labels for the DraftCard "from …" line, keyed by the draft id prefix
// the DemoClient mints (msg_pb_<playbookKey>_…) with a fallback for seeded drafts.
const PLAYBOOK_LABELS: Record<string, string> = {
  renewal_reminder: 'Renewal reminder',
  speed_to_lead: 'Speed to lead',
  winback_lapsed: 'Win back lapsed quotes',
};

function playbookLabelFor(draft: ThreadMessage | undefined): string {
  if (draft === undefined) return 'Renewal reminder';
  // Playbook-minted drafts encode their key: msg_pb_<playbookKey>_ct_<contact>.
  const m = /^msg_pb_([a-z_]+?)_ct_/.exec(draft.id);
  if (m !== null && PLAYBOOK_LABELS[m[1]] !== undefined) return PLAYBOOK_LABELS[m[1]];
  // Seeded drafts (e.g. Dana's renewal reminder) don't carry a playbook key.
  return 'Renewal reminder';
}

interface Discovery {
  contacts: Contact[];
  briefs: Map<string, ThreadBrief>; // contactId → brief (conversationId + recent)
  queue: QueueItem[];
}

export default function InboxScreen() {
  const client = useClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('c');

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

      const tag: TriageTag = triageTag({
        optedOut: c.optedOut,
        hasPendingDraft: pendingByConv.has(convId),
        routedToHuman: routedByConv.has(convId),
        wonBack,
        lastDirection: last?.direction ?? null,
      });

      rows.push({
        conversationId: convId,
        contactId: c.id,
        name: c.display_name,
        preview: last ? previewText(last.body) : 'No messages yet',
        lastAt: last?.created_at ?? c.lastActivity,
        // Unread = an inbound the operator hasn't actioned (pending or routed).
        unread: pendingByConv.has(convId) || routedByConv.has(convId),
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
  useEffect(() => {
    if (selectedId === null && triageRows.length > 0) {
      setSearchParams({ c: triageRows[0].conversationId }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, triageRows]);

  const onSelect = useCallback(
    (conversationId: string) => {
      setSearchParams({ c: conversationId });
    },
    [setSearchParams],
  );

  // ── Thread detail for the selected conversation ─────────────────────────────
  const thread = useData(
    () => (selectedId !== null ? client.thread(selectedId) : Promise.resolve(undefined)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, selectedId, discoveryNonce],
  );

  const detail = thread.data ?? undefined;

  const pendingDraft = useMemo<ThreadMessage | undefined>(
    () => detail?.messages.find((m) => m.status === 'awaiting_approval'),
    [detail],
  );

  // Refetch discipline: bump the nonce so discovery (queue + briefs + tags) and
  // the thread detail both reload after any mutation.
  const refetchAll = useCallback(() => {
    setDiscoveryNonce((n) => n + 1);
  }, []);

  const onApprove = useCallback(
    async (draftId: string): Promise<ApproveResult> => {
      if (selectedId === null) throw new Error('no conversation selected');
      const res = await client.approve(selectedId, draftId);
      refetchAll();
      return res;
    },
    [client, selectedId, refetchAll],
  );

  const onEdit = useCallback(
    async (draftId: string, body: string): Promise<void> => {
      if (selectedId === null) return;
      await client.edit(selectedId, draftId, body);
      refetchAll();
    },
    [client, selectedId, refetchAll],
  );

  const onTakeover = useCallback(async (): Promise<void> => {
    if (selectedId === null) return;
    await client.takeover(selectedId);
    refetchAll();
  }, [client, selectedId, refetchAll]);

  const onSimulate = useCallback(
    async (text: string): Promise<void> => {
      if (selectedId === null) return;
      await client.simulateInbound(selectedId, text);
      refetchAll();
    },
    [client, selectedId, refetchAll],
  );

  const triageLoading = discovery.loading && discovery.data === undefined;
  const threadLoading = selectedId !== null && thread.loading && thread.data === undefined;

  return (
    <div className={styles.cockpit}>
      <TriagePane
        rows={triageRows}
        loading={triageLoading}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      <ThreadPane
        detail={detail}
        loading={threadLoading}
        pendingDraft={pendingDraft}
        playbookLabel={playbookLabelFor(pendingDraft)}
        onApprove={onApprove}
        onEdit={onEdit}
        onTakeover={onTakeover}
      />
      <ContextRail detail={detail} loading={threadLoading} onSimulate={onSimulate} />
    </div>
  );
}
