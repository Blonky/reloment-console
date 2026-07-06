// Deterministic helpers for the Contacts screen. Locale-pinned, no Math.random,
// no `new Date()` at render time — everything is computed against a fixed demo
// clock so the roster renders identically everywhere (DESIGN.md §6).

import type { MemoryAtom } from '../../data/types.ts';

// The demo clock. Relative timestamps ("2h ago") are measured against this.
export const DEMO_NOW = new Date('2026-07-07T19:20:00.000Z');

/** ISO → "2h ago" / "3d ago" / "just now", measured against the demo clock. */
export function relativeFrom(iso: string, now: Date = DEMO_NOW): string {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  if (Number.isNaN(then)) return '—';
  if (diffMs < 0) return 'just now';

  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;

  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Map a raw policy_status to a StatusPill tone. */
export function policyTone(status: string | null): 'ok' | 'info' | 'hold' | 'neutral' {
  switch (status) {
    case 'active':
      return 'ok';
    case 'new_lead':
      return 'info';
    case 'lapsed_quote':
      return 'hold';
    default:
      return 'neutral';
  }
}

/** snake_case → "Lapsed quote". */
export function humanizeLabel(s: string | null): string {
  if (s === null || s.length === 0) return '—';
  const words = s.replaceAll('_', ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ── Memory board grouping ───────────────────────────────────────────────────

// Human labels for each memory `source`, keyed by the raw source value. Plural
// so they read as group headings ("Call notes", "Preferences", …).
const SOURCE_LABEL: Record<string, string> = {
  call_note: 'Call notes',
  preference: 'Preferences',
  quote: 'Quotes',
  inbound_message: 'Inbound messages',
  lead_source: 'Lead source',
  outcome: 'Outcomes',
};

// Singular provenance phrasing for the per-atom sublabel ("from a call note").
const SOURCE_PROVENANCE: Record<string, string> = {
  call_note: 'from a call note',
  preference: 'noted as a preference',
  quote: 'from a quote',
  inbound_message: 'from an inbound message',
  lead_source: 'from the lead source',
  outcome: 'from an outcome',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? humanizeLabel(source);
}

export function sourceProvenance(source: string): string {
  return SOURCE_PROVENANCE[source] ?? `from ${source.replaceAll('_', ' ')}`;
}

// Fixtures carry no per-atom date, so derive a stable pseudo-date per atom by
// stepping backwards from the demo clock by a fixed amount keyed on the atom's
// global index. Deterministic — same atom, same date, everywhere.
const ATOM_DAY_STEPS = [4, 9, 16, 25, 33, 41, 52, 60];

export function atomDate(index: number): string {
  const step = ATOM_DAY_STEPS[index % ATOM_DAY_STEPS.length] + Math.floor(index / ATOM_DAY_STEPS.length) * 7;
  const d = new Date(DEMO_NOW.getTime() - step * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export interface MemoryGroup {
  source: string;
  label: string;
  atoms: { atom: MemoryAtom; index: number }[];
}

/** Group memory atoms by their `source`, preserving first-seen order. */
export function groupMemory(memory: MemoryAtom[]): MemoryGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, { atom: MemoryAtom; index: number }[]>();

  memory.forEach((atom, index) => {
    if (!buckets.has(atom.source)) {
      buckets.set(atom.source, []);
      order.push(atom.source);
    }
    buckets.get(atom.source)!.push({ atom, index });
  });

  return order.map((source) => ({
    source,
    label: sourceLabel(source),
    atoms: buckets.get(source)!,
  }));
}
