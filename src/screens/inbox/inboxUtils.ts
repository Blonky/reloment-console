// Private Inbox helpers — formatting, ordering, and the small vocabulary the
// cockpit needs to map raw message/queue status into triage tags and timeline
// entries. Kept inside src/screens/inbox/ (screen-private, per the build spec).

import type { StatusTone } from '../../components/index.ts';
import type {
  MessageStatus,
  QueueItem,
  ThreadMessage,
} from '../../data/types.ts';

// ── Time ────────────────────────────────────────────────────────────────────

/** Relative "3m", "2h", "5d" for triage rows — compact, tabular-friendly. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, now - then);
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.round(day / 7);
  return `${wk}w`;
}

/** "2:14 PM" clock time for a bubble's timestamp. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** A stable day key ("2026-07-07") for grouping messages into day sections. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

/** "Today" / "Yesterday" / "Mon, Jul 7" day divider label. */
export function dayLabel(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const startOf = (t: number): number => {
    const x = new Date(t);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const days = Math.round((startOf(now) - startOf(d.getTime())) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** The contact's local wall-clock time, given an IANA timezone. */
export function localTimeIn(timezone: string, now: number = Date.now()): string {
  try {
    return new Date(now).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
    });
  } catch {
    return '';
  }
}

/** Renewal date like "Jul 28" for the contact card. x_date is a date-only
 * string parsed as UTC midnight — format in UTC too, or the local zone shifts
 * it back a day (Jul 28 rendering as Jul 27). */
export function shortDate(iso: string | null): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ── Triage tag vocabulary ─────────────────────────────────────────────────────

export interface TriageTag {
  label: string;
  tone: StatusTone;
}

/**
 * Map a conversation's headline state to its triage StatusPill.
 * `optedOut` wins over everything; then the pending draft / routed states; then
 * a fallback derived from the last message.
 */
export function triageTag(args: {
  optedOut: boolean;
  hasPendingDraft: boolean;
  routedToHuman: boolean;
  wonBack: boolean;
  missedCall: boolean;
  lastDirection: 'inbound' | 'outbound' | null;
}): TriageTag {
  if (args.optedOut) return { label: 'Opted out', tone: 'block' };
  if (args.hasPendingDraft) return { label: 'Awaiting approval', tone: 'hold' };
  if (args.routedToHuman) return { label: 'Routed to human', tone: 'info' };
  if (args.missedCall) return { label: 'Missed call', tone: 'info' };
  if (args.wonBack) return { label: 'Won back', tone: 'ok' };
  return { label: 'Replied', tone: 'neutral' };
}

/** The marker body a session-minted missed-call conversation opens with. */
export const MISSED_CALL_MARKER = 'forwarded to text-back';

/** Sort weight for needs-you-first ordering (lower = higher in the list). */
export function triageWeight(tag: TriageTag): number {
  switch (tag.tone) {
    case 'hold':
      return 0; // awaiting approval — the operator's job, first
    case 'info':
      return 1; // routed to human — attention, not action
    case 'neutral':
      return 2; // replied / in-flight
    case 'ok':
      return 3; // won back — settled, good
    case 'block':
      return 4; // opted out — settled, closed
    default:
      return 5;
  }
}

// ── Message classification for rendering ──────────────────────────────────────

/** Is this message a system/timeline event rather than a chat bubble? */
export function isSystemEvent(m: ThreadMessage): boolean {
  if (m.status === 'routed_to_human') return true;
  if (m.status === 'held') return true;
  if (m.status === 'opted_out') return true;
  if (m.status === 'opted_back_in') return true;
  if (m.status === 'missed_call') return true;
  if (typeof m.status === 'string' && m.status.startsWith('blocked_')) return true;
  if (m.advice_verdict === 'advice_adjacent' && m.direction === 'outbound') return true;
  return false;
}

/** A calm centered timeline label for a system-event message, if it has one. */
export function systemEventLabel(m: ThreadMessage): string | null {
  if (m.status === 'opted_out') return 'Opted out — will never be texted again';
  if (m.status === 'opted_back_in') return 'Opted back in — transactional messages resumed';
  if (m.status === 'missed_call') return 'Missed call · forwarded to text-back';
  return null;
}

/** First name for narration ("Dana Whitfield" → "Dana"). */
export function firstNameOf(fullName: string): string {
  return fullName.split(' ')[0] ?? fullName;
}

/** The auditReason embedded in a dynamic `blocked_<reason>` status, if any. */
export function blockedReason(status: MessageStatus): string | null {
  if (typeof status === 'string' && status.startsWith('blocked_')) {
    return status.slice('blocked_'.length);
  }
  return null;
}

/** Does a queue row represent an actionable draft awaiting the operator? */
export function isAwaitingApproval(status: MessageStatus): boolean {
  return status === 'awaiting_approval';
}

/** One-line preview: collapse whitespace, keep it short for the triage row. */
export function previewText(body: string): string {
  return body.replaceAll(/\s+/g, ' ').trim();
}

/** Group the queue by conversation, keeping the earliest (most urgent) first. */
export function queueByConversation(queue: QueueItem[]): Map<string, QueueItem[]> {
  const byConv = new Map<string, QueueItem[]>();
  for (const item of queue) {
    const list = byConv.get(item.conversation_id) ?? [];
    list.push(item);
    byConv.set(item.conversation_id, list);
  }
  return byConv;
}
