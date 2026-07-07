// Home — the agent workspace (Manus/Sauna-shaped; DESIGN.md §5, "Agent
// workspace (r11)"; chat history moved INTO the app sidebar in r12).
//
// Home is the product's main control panel: a general greeting and a command
// channel that performs governed actions, researches contacts, and reroutes you.
// Chat-session history no longer lives here — it lives in the app Sidebar
// (Sauna/ChatGPT-shape). Home reads the open session from the URL (?s=<id>):
//
//   idle    — no ?s=: general greeting (Fraunces) + one quiet sub-line → 720px
//             composer → "Today" briefing band. Full centered width.
//   active  — ?s=<id> or a live turn owns the transcript; the composer docks at
//             the bottom; a slim pulse strip rides above. The FIRST submitted
//             command CREATES a session, morphs the composer (View Transition),
//             and replaces the URL with ?s=<new id>.
//
// Session store lives on the DataClient seam (localStorage in demo). Only the
// TRANSCRIPT is persisted — each user line verbatim + the assistant's PLAIN
// narration; reopening a session replays those texts WITHOUT re-running actions
// (live turns keep rich artifact cards; replayed history is plain bubbles). The
// briefing / asks / pulse are live-recursive: a single shell-level subscription
// (LiveData) debounce-refetches them on any feed event, so the Today band + the
// topbar badge update together.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useClient, useKillSwitch } from '../../shell/ClientContext.tsx';
import { useLiveData } from '../../shell/LiveData.tsx';
import { useData } from '../../data/useData.ts';
import type { Contact } from '../../data/types.ts';
import styles from './HomeScreen.module.css';
import { parseIntent, smellsLikeComplianceOverride } from './parseIntent.ts';
import type { Intent } from './parseIntent.ts';
import {
  BookCard,
  EnrollCard,
  CampaignCard,
  BriefCard,
  SearchCard,
  CallListCard,
  MissedCallReply,
  WaterfallCard,
  ResearchMissReply,
  NavigateCard,
  NavigateMissReply,
  HelpCard,
  FallbackCard,
  TeachCard,
} from './ReplyCards.tsx';
import type { ReplyMeta } from './ReplyCards.tsx';
import { disclosureFor } from './gateChecks.ts';
import KillSwitchCard from './KillSwitchCard.tsx';
import type { KillSwitchMode } from './KillSwitchCard.tsx';
import {
  BriefingBand,
  PulseStrip,
} from './PulseRow.tsx';
import { IconSend } from './icons.tsx';

// ── Transcript model ──────────────────────────────────────────────────────────
// Live turns carry rich nodes; replayed history is plain text (per replay
// semantics). A dispatch also yields the PLAIN narration string to persist.
type Turn =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'thinking'; label: string }
  | { id: number; role: 'reply'; node: React.ReactNode }
  // A replayed transcript line — plain text, styled like user / assistant.
  | { id: number; role: 'replay'; who: 'user' | 'assistant'; text: string };

// A dispatch produces the reply NODE (rich, for the live transcript) and the
// PLAIN narration line to store in the session log (replayed later as text).
interface Dispatched {
  node: React.ReactNode;
  narration: string;
}

// Suggestion chips inside the composer footer (a curated slice of the catalogue,
// now including the r11 research + navigate families).
const SUGGESTIONS = [
  'Show renewals',
  'Research Dana',
  'Enroll win-back',
  'Take me to the Inbox',
];

// ── Greeting — general control-panel voice (r11) ──────────────────────────────
// The needs-your-eyes greeting is gone; Home now opens with a calm time-of-day
// salutation + one quiet sub-line inviting a command. Time-of-day comes from the
// DataClient clock (never Date.now()).
function timeOfDay(nowMs: number): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date(nowMs).getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function greetingLine(nowMs: number): string {
  const part = timeOfDay(nowMs);
  if (part === 'morning') return 'Good morning.';
  if (part === 'afternoon') return 'Good afternoon.';
  return 'Good evening.';
}

// The thinking-row label per intent — honest about which read is running.
function thinkingLabel(intent: Intent): string {
  switch (intent.kind) {
    case 'renewals':
    case 'lapsed':
      return 'Checking the book…';
    case 'enroll_winback':
      return 'Enrolling — running each contact through the send gate…';
    case 'campaign_status':
      return 'Pulling campaign status…';
    case 'brief':
      return 'Building the brief…';
    case 'search':
      return 'Searching conversations and memory…';
    case 'call_list':
      return 'Ranking the book for calls…';
    case 'missed_call':
      return 'Capturing the missed call…';
    case 'research':
      return 'Running the enrichment waterfall…';
    case 'navigate':
      return 'Finding where to take you…';
    case 'teach':
      return 'Teaching the agent…';
    case 'pause':
    case 'resume':
      return 'Preparing the confirmation…';
    case 'help':
      return 'One moment…';
    case 'fallback':
      return 'One moment…';
  }
}

// Bounded Levenshtein — mirrors parseIntent's; early-exits over `max`. Local so
// the name resolver can tolerate a typo ("dna" → "dana") without a dependency.
function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

// Resolve a spoken name ("dana", "dana whitfield", "dna") to a contact. Exact →
// first-name → substring → typo-tolerant (Levenshtein ≤2 on a name token).
// Returns the best single match or null.
function resolveContact(name: string, contacts: Contact[]): Contact | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const exact = contacts.find((c) => c.display_name.toLowerCase() === needle);
  if (exact) return exact;
  const firstName = contacts.find(
    (c) => c.display_name.toLowerCase().split(' ')[0] === needle,
  );
  if (firstName) return firstName;
  const contains = contacts.filter((c) =>
    c.display_name.toLowerCase().includes(needle),
  );
  if (contains.length > 0) return contains[0];
  // Typo tolerance: match the needle against each name token within a small,
  // length-scaled edit budget. Deterministic — the closest, first-fixture wins.
  if (needle.length >= 3) {
    const max = needle.length <= 5 ? 1 : 2;
    let best: { c: Contact; d: number } | null = null;
    for (const c of contacts) {
      for (const tok of c.display_name.toLowerCase().split(/\s+/)) {
        if (tok.length < 3) continue;
        const d = editDistance(needle, tok, max);
        if (d <= max && (best === null || d < best.d)) best = { c, d };
      }
    }
    if (best) return best.c;
  }
  return null;
}

// Scan a free-text line for a known contact name (or a close typo of one) so the
// fallback card can bias its suggestions toward that contact. Only exact
// name-token or a tight typo counts — NOT substring — so a common word never
// masquerades as a contact ("same" must not resolve to "Sam"). Returns the
// display name of the first hit, or null.
function findContactHint(text: string, contacts: Contact[]): string | null {
  if (contacts.length === 0) return null;
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  const tokensOf = (c: Contact) =>
    c.display_name.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  for (const w of words) {
    for (const c of contacts) {
      for (const tok of tokensOf(c)) {
        if (tok === w) return c.display_name;
        const max = w.length <= 5 ? 1 : 2;
        if (w.length >= 4 && editDistance(w, tok, max) <= max)
          return c.display_name;
      }
    }
  }
  return null;
}

export default function HomeScreen() {
  const client = useClient();
  const { setKillSwitch } = useKillSwitch();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Pulse + briefing + asks are live-recursive: the shell's single subscription
  // (LiveData) debounce-refetches them on any feed event. refreshLive() forces an
  // immediate refetch after a local mutating command so the numbers react at once.
  const { pulse, briefing, refreshLive, refreshSessions } = useLiveData();
  const book = useData(() => client.contacts(), [client]);
  const contacts = book.data ?? [];

  // General greeting from the client clock (no pulse dependency now).
  const greeting = useMemo(() => greetingLine(client.now()), [client]);
  // The licensed producer's first name for the sub-line, if cleanly available.
  // Sourced from the booking calendar ("<Name> — Renewal reviews"); no vendor
  // name, no new fixture — falls back to no name when unavailable.
  const booking = useData(() => client.bookingConnection(), [client]);
  const firstName = useMemo(() => {
    const cal = booking.data?.calendar ?? '';
    const name = cal.split('—')[0]?.trim() ?? '';
    const first = name.split(/\s+/)[0] ?? '';
    return /^[A-Za-z]{2,}$/.test(first) ? first : null;
  }, [booking.data]);

  // ── Session state ───────────────────────────────────────────────────────────
  // The open session is URL state (?s=<id>). activeSessionId mirrors it; null →
  // idle (a fresh new-chat, no session yet). The sidebar owns the history list.
  const sessionParam = searchParams.get('s');
  // Start null so the sync effect below ALWAYS loads the ?s= session on mount
  // (a fresh mount arriving at /?s=<id> — e.g. a sidebar click that remounted
  // Home — must replay that transcript, not short-circuit as "already open").
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Transcript state.
  const seqRef = useRef(0);
  const nextId = () => (seqRef.current += 1);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The transcript scroll viewport (active state). In active state the TRANSCRIPT
  // scrolls, not the document — so auto-scroll pins its scrollTop, not the page.
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = turns.length > 0;
  // Read active/session inside stable callbacks without adding them to deps.
  const activeRef = useRef(active);
  activeRef.current = active;
  const activeSessionRef = useRef(activeSessionId);
  activeSessionRef.current = activeSessionId;

  // Keep the newest turn in view. The transcript is its own scroll viewport in
  // active state (bottom-anchored), so pin ITS scrollTop to the bottom on every
  // new turn — never the document. On the first turn (viewport just mounted) jump
  // instantly; afterward glide. Bottom-anchoring (margin-top:auto on the inner
  // wrapper) means a short transcript already sits flush above the composer, so
  // this only does real work once the content overflows.
  const prevLenRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || turns.length === 0) return;
    const instant = prevLenRef.current === 0;
    prevLenRef.current = turns.length;
    el.scrollTo({ top: el.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
  }, [turns]);

  // Replace the trailing thinking row with a reply node.
  const resolveThinking = useCallback((node: React.ReactNode) => {
    setTurns((prev) => {
      const next = prev.slice();
      const last = next[next.length - 1];
      if (last && last.role === 'thinking') {
        next[next.length - 1] = { id: last.id, role: 'reply', node };
      } else {
        next.push({ id: seqRef.current++, role: 'reply', node });
      }
      return next;
    });
  }, []);

  // The confirm handler shared by pause/resume cards: mutate, sync shell, refetch.
  const runKillSwitch = useCallback(
    async (on: boolean) => {
      await client.setKillSwitch(on);
      setKillSwitch(on); // sync the shell context → red topbar band appears/clears
      refreshLive();
    },
    [client, setKillSwitch, refreshLive],
  );

  // ── Session ↔ URL sync ────────────────────────────────────────────────────
  // The URL (?s=<id>) is the source of truth for which session is open. When it
  // changes (sidebar click, new chat → /, or a delete that dropped us to idle),
  // load or clear the transcript. Live turns already in flight for the SAME
  // session must not be clobbered — guard on a mismatch with activeSessionRef.
  // Replay renders the stored texts as PLAIN bubbles (no re-execution).
  useEffect(() => {
    // Same session already loaded (e.g. we just created it) → nothing to do.
    if (sessionParam === activeSessionRef.current) return;

    let live = true;
    if (sessionParam === null) {
      // New chat / idle.
      setActiveSessionId(null);
      setTurns([]);
      setInput('');
      inputRef.current?.focus();
      return;
    }
    // Open the requested session: load + replay its transcript.
    void client.agentSessionMessages(sessionParam).then((msgs) => {
      if (!live) return;
      setActiveSessionId(sessionParam);
      setTurns(
        msgs.map((m) => ({
          id: nextId(),
          role: 'replay' as const,
          who: m.role,
          text: m.body,
        })),
      );
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionParam, client]);

  // Build the capability-fallback reply (never a dead-end). Shared by the
  // top-level `fallback` intent and the brief/research "no such contact" paths so
  // an unrecognized OR unresolved line always lands on the same honest card:
  // the honest miss line, the (optional) general-question note, a contact-biased
  // row when a real name appears in the text, and grouped capability chips.
  const buildFallback = useCallback(
    (text: string, general: boolean): Dispatched => {
      const hint = findContactHint(text, contacts);
      const narration = general
        ? 'I didn’t catch that one. General questions run on the live model with the platform connection; here I handle your book, campaigns, research and navigation.'
        : hint
          ? `I didn’t catch that one. Here’s what I can do, including a few things on ${hint.split(' ')[0]}.`
          : 'I didn’t catch that one. Here’s what I can do.';
      return {
        node: (
          <FallbackCard
            general={general}
            contactName={hint}
            onRun={(t) => void submit(t)}
          />
        ),
        narration,
      };
    },
    // submit via ref pattern (defined below); contacts is the only real dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contacts],
  );

  // Dispatch a parsed intent to its governed tool + build the reply node AND the
  // plain narration line to persist. Each tool call is wrapped in a real
  // performance.now() delta so the gate disclosure shows an HONEST run duration.
  const dispatch = useCallback(
    async (intent: Intent): Promise<Dispatched> => {
      switch (intent.kind) {
        case 'renewals': {
          const t0 = performance.now();
          const rows = await client.queryBook('renewals');
          const meta: ReplyMeta = {
            disclosure: disclosureFor(intent),
            durationMs: performance.now() - t0,
          };
          const n = rows.length;
          const narration =
            n === 0
              ? 'No renewals fall in the next 30 days right now.'
              : `${n} ${n === 1 ? 'contact comes' : 'contacts come'} up for renewal in the next 30 days.`;
          return { node: <BookCard kind="renewals" rows={rows} meta={meta} />, narration };
        }
        case 'lapsed': {
          const t0 = performance.now();
          const rows = await client.queryBook('lapsed');
          const meta: ReplyMeta = {
            disclosure: disclosureFor(intent),
            durationMs: performance.now() - t0,
          };
          const n = rows.length;
          const narration =
            n === 0
              ? 'No lapsed quotes past the win-back window right now.'
              : `${n} ${n === 1 ? 'contact' : 'contacts'} lapsed past the win-back window.`;
          return { node: <BookCard kind="lapsed" rows={rows} meta={meta} />, narration };
        }
        case 'enroll_winback': {
          const t0 = performance.now();
          const result = await client.enrollPlaybook('winback_lapsed');
          const meta: ReplyMeta = {
            disclosure: disclosureFor(intent, {
              enrolledCount: result.enrolled.length,
              excludedReasons: result.excluded.map((e) => e.reason),
            }),
            durationMs: performance.now() - t0,
          };
          refreshLive();
          const narration =
            result.enrolled.length > 0
              ? `Enrolled ${result.enrolled.length} and held ${result.excluded.length} back at the gate.`
              : `No one was eligible to enroll — ${result.excluded.length} held back at the gate.`;
          return { node: <EnrollCard result={result} meta={meta} />, narration };
        }
        case 'campaign_status': {
          const t0 = performance.now();
          const rows = await client.campaignStatus();
          const meta: ReplyMeta = {
            disclosure: disclosureFor(intent),
            durationMs: performance.now() - t0,
          };
          const totalEnrolled = rows.reduce((s, r) => s + r.enrolled, 0);
          const totalPending = rows.reduce((s, r) => s + r.drafts_pending, 0);
          const narration = `${totalEnrolled} enrolled across ${rows.length} playbooks · ${totalPending} drafts awaiting your approval.`;
          return { node: <CampaignCard rows={rows} meta={meta} />, narration };
        }
        case 'brief': {
          const contact = resolveContact(intent.name, contacts);
          if (!contact) {
            // "who is X" / "brief X" that resolves to nobody: fall through to the
            // capability card rather than dead-ending. A multi-word argument with
            // no name in it ("who is the best carrier") reads as a general
            // question; a single mistyped token stays a near-miss.
            const general =
              findContactHint(intent.name, contacts) === null &&
              intent.name.trim().split(/\s+/).length > 1;
            return buildFallback(intent.name, general);
          }
          const t0 = performance.now();
          const brief = await client.threadBrief(contact.id);
          const meta: ReplyMeta = {
            disclosure: disclosureFor(intent),
            durationMs: performance.now() - t0,
          };
          const narration = `Here’s the brief on ${contact.display_name.split(' ')[0]}.`;
          return { node: <BriefCard brief={brief} meta={meta} />, narration };
        }
        case 'search': {
          const t0 = performance.now();
          const hits = await client.searchConversations(intent.query);
          const meta: ReplyMeta = {
            disclosure: disclosureFor(intent),
            durationMs: performance.now() - t0,
          };
          const n = hits.length;
          const narration =
            n === 0
              ? `Nothing in the book mentions “${intent.query}” yet.`
              : `${n} ${n === 1 ? 'match' : 'matches'} for “${intent.query}” across conversations and memory.`;
          return {
            node: <SearchCard query={intent.query} hits={hits} meta={meta} />,
            narration,
          };
        }
        case 'call_list': {
          const t0 = performance.now();
          const rows = await client.callList();
          const meta: ReplyMeta = {
            disclosure: disclosureFor(intent),
            durationMs: performance.now() - t0,
          };
          const n = rows.length;
          const narration =
            n === 0
              ? 'No one in the book needs a call today.'
              : `Ranked your book — ${n} ${n === 1 ? 'person' : 'people'} worth a call today.`;
          return { node: <CallListCard rows={rows} meta={meta} />, narration };
        }
        case 'missed_call': {
          const t0 = performance.now();
          const { conversationId } = await client.simulateMissedCall();
          const meta: ReplyMeta = {
            disclosure: disclosureFor(intent),
            durationMs: performance.now() - t0,
          };
          refreshLive();
          return {
            node: <MissedCallReply conversationId={conversationId} meta={meta} />,
            narration:
              'Missed call captured — the text-back playbook answered inside the gate.',
          };
        }
        case 'research': {
          const t0 = performance.now();
          const report = await client.researchContact(intent.name);
          const meta: ReplyMeta = {
            disclosure: disclosureFor(intent),
            durationMs: performance.now() - t0,
          };
          if (!report) {
            return {
              node: <ResearchMissReply name={intent.name} meta={meta} />,
              narration: `I don’t have anyone by “${intent.name}” in the book.`,
            };
          }
          const first = report.name.split(' ')[0];
          const hits = report.steps.filter((s) => s.status === 'hit').length;
          const narration = `Ran the enrichment waterfall for ${first} — ${hits} of ${report.steps.length} sources hit.`;
          return { node: <WaterfallCard report={report} meta={meta} />, narration };
        }
        case 'navigate': {
          const t0 = performance.now();
          const target = await client.resolveNavigate(intent.query);
          const meta: ReplyMeta = {
            disclosure: disclosureFor(intent),
            durationMs: performance.now() - t0,
          };
          if (!target) {
            return {
              node: <NavigateMissReply query={intent.query} meta={meta} />,
              narration: `I couldn’t find anywhere to open for “${intent.query}”.`,
            };
          }
          // Motion-safe auto-navigate: instant under reduced motion, else a beat
          // so the operator sees the destination land in the transcript first.
          const reduce = window.matchMedia?.(
            '(prefers-reduced-motion: reduce)',
          ).matches;
          if (reduce) {
            navigate(target.href);
          } else {
            window.setTimeout(() => navigate(target.href), 600);
          }
          return {
            node: <NavigateCard label={target.label} href={target.href} />,
            narration: `Taking you to ${target.label}.`,
          };
        }
        case 'teach': {
          // Write to the agent's brain via the existing methods. add_rule/add_faq
          // → createKnowledgeDoc; rename_agent/add_trait/set_instructions →
          // updateAgentVoice. The knowledge.changed event (emitted by the client)
          // refreshes the Agent tab + briefing live; refreshLive() nudges Home too.
          const compliance = smellsLikeComplianceOverride(
            `${intent.title ?? ''} ${intent.body ?? ''}`,
          );
          let where = 'House rules';
          if (intent.op === 'add_rule') {
            await client.createKnowledgeDoc({
              kind: 'rules',
              title: intent.title ?? 'New house rule',
              body: intent.body ?? intent.title ?? '',
            });
            where = 'House rules';
          } else if (intent.op === 'add_faq') {
            await client.createKnowledgeDoc({
              kind: 'faq',
              title: intent.title ?? 'New question',
              body: intent.body ?? intent.title ?? '',
            });
            where = 'FAQs';
          } else if (intent.op === 'rename_agent') {
            await client.updateAgentVoice({ name: intent.title ?? '' });
            where = 'Voice';
          } else if (intent.op === 'add_trait') {
            const voice = await client.agentVoice();
            const next = [...voice.traits, intent.title ?? ''].filter(Boolean);
            await client.updateAgentVoice({ traits: next });
            where = 'Voice';
          } else {
            // set_instructions — APPEND to the existing house style (never clobber).
            const voice = await client.agentVoice();
            const addition = intent.title ?? '';
            const joined = voice.instructions.trim()
              ? `${voice.instructions.trim()}\n${addition}`
              : addition;
            await client.updateAgentVoice({ instructions: joined });
            where = 'Voice';
          }
          refreshLive();
          const confirm =
            intent.op === 'rename_agent'
              ? `Renamed your agent to ${intent.title}.`
              : intent.op === 'add_faq'
                ? 'Added to FAQs.'
                : intent.op === 'add_trait'
                  ? 'Added to your agent’s traits.'
                  : intent.op === 'set_instructions'
                    ? 'Added to your House style.'
                    : 'Added to House rules.';
          return {
            node: <TeachCard confirm={confirm} where={where} compliance={compliance} />,
            narration: compliance
              ? `${confirm} House rules shape tone and approach; the compliance guardrails are not editable.`
              : confirm,
          };
        }
        case 'pause': {
          return {
            node: (
              <KillSwitchCard
                mode={'pause' as KillSwitchMode}
                onConfirm={() => runKillSwitch(true)}
              />
            ),
            narration: 'Opened the pause confirmation — type “pause” to stop all sending.',
          };
        }
        case 'resume': {
          return {
            node: (
              <KillSwitchCard
                mode={'resume' as KillSwitchMode}
                onConfirm={() => runKillSwitch(false)}
              />
            ),
            narration: 'Opened the resume confirmation — type “resume” to start sending again.',
          };
        }
        case 'help': {
          return {
            node: <HelpCard onRun={(t) => void submit(t)} />,
            narration: 'Listed the commands I can run today.',
          };
        }
        case 'fallback':
          return buildFallback(intent.text, intent.general);
      }
    },
    // submit is referenced through the ref pattern (defined below) to avoid a
    // cycle; it is otherwise stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, contacts, runKillSwitch, refreshLive, navigate, buildFallback],
  );

  // Submit a line: render the user turn + thinking row, dispatch, then persist
  // the transcript (user verbatim + assistant plain narration). The FIRST submit
  // of an idle Home CREATES a session and morphs the composer.
  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (text.length === 0 || busy) return;
      setInput('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      const intent = parseIntent(text);

      const appendTurns = () =>
        setTurns((prev) => [
          ...prev,
          { id: nextId(), role: 'user', text },
          { id: nextId(), role: 'thinking', label: thinkingLabel(intent) },
        ]);

      // The idle→active flip is a feature: on the FIRST turn, morph the composer
      // from centre-stage to the docked bottom and fade the greeting away.
      const isFirstTurn = !activeRef.current;
      const startViewTransition = (
        document as Document & {
          startViewTransition?: (cb: () => void) => void;
        }
      ).startViewTransition;
      if (isFirstTurn && typeof startViewTransition === 'function') {
        startViewTransition.call(document, () => flushSync(appendTurns));
      } else {
        appendTurns();
      }

      // Lazily mint a session on the first submit of an idle Home. createAgentSession
      // + append the user line now (title auto-sets from it); the assistant
      // narration is appended after the reply resolves.
      let sessionId = activeSessionRef.current;
      if (sessionId === null) {
        const session = await client.createAgentSession();
        sessionId = session.id;
        setActiveSessionId(session.id);
        activeSessionRef.current = session.id;
        // Reflect the new session in the URL (replace — the idle Home wasn't a
        // history entry). The sync effect sees the param already matches
        // activeSessionRef and skips a reload of the in-flight transcript.
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set('s', session.id);
            return next;
          },
          { replace: true },
        );
      }
      await client.appendAgentMessage(sessionId, 'user', text);

      setBusy(true);
      try {
        const { node, narration } = await dispatch(intent);
        resolveThinking(node);
        await client.appendAgentMessage(sessionId, 'assistant', narration);
      } catch {
        resolveThinking(
          <div className={styles.reply}>
            <p className={styles.errorLine}>
              That command couldn’t complete. Nothing was sent — try again.
            </p>
          </div>,
        );
      } finally {
        void refreshSessions(); // float the touched session to the top + set title
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, dispatch, resolveThinking, client, refreshSessions, setSearchParams],
  );

  // Command-palette / one-shot deep link: /?cmd=<phrase> submits the phrase
  // through the real command path (creating a session too), then strips the
  // param. Fires once per distinct cmd value.
  const consumedCmdRef = useRef<string | null>(null);
  const cmd = searchParams.get('cmd');
  useEffect(() => {
    if (cmd === null || cmd.trim() === '') return;
    if (consumedCmdRef.current === cmd) return;
    consumedCmdRef.current = cmd;
    void submit(cmd);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('cmd');
        return next;
      },
      { replace: true },
    );
  }, [cmd, submit, setSearchParams]);

  // Auto-grow the textarea to its content, capped by CSS max-height.
  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    setInput(el.value);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  // The composer — one node, reused idle (centered) and active (sticky dock).
  const composer = (
    <div className={`${styles.composerCard} ${styles.composerMorph}`}>
      <textarea
        ref={inputRef}
        className={styles.input}
        value={input}
        onInput={onInput}
        onChange={() => {
          /* controlled via onInput to co-manage auto-grow */
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit(input);
          }
        }}
        placeholder="Ask the agent — e.g. “show renewals”, “research Dana”, “take me to the Inbox”"
        rows={active ? 1 : 3}
        aria-label="Command input"
        spellCheck={false}
      />
      <div className={styles.composerFoot}>
        <div className={styles.suggestions}>
          {SUGGESTIONS.map((s) => (
            <button
              type="button"
              className={styles.chip}
              key={s}
              onClick={() => void submit(s)}
              disabled={busy}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.sendBtn}
          onClick={() => void submit(input)}
          disabled={busy || input.trim().length === 0}
          aria-label="Send command"
        >
          <IconSend size={16} />
        </button>
      </div>
    </div>
  );

  // Transcript renderer — live (rich) + replayed (plain) turns. The scroll
  // viewport (.transcript) holds an inner wrapper (.transcriptInner) that carries
  // `margin-top: auto`, so when the content is shorter than the viewport the
  // FIRST message is pushed down and the newest sits flush above the composer
  // (ChatGPT/Manus bottom-anchoring — no justify-content:flex-end scroll bug).
  const transcript = (
    <div
      className={styles.transcript}
      ref={scrollRef}
      aria-live="polite"
      aria-label="Command transcript"
    >
      <div className={styles.transcriptInner}>
      {turns.map((t) => {
        if (t.role === 'user' || (t.role === 'replay' && t.who === 'user')) {
          return (
            <div className={`${styles.turn} ${styles.turnUser}`} key={t.id}>
              <div className={styles.userBubble}>{t.text}</div>
            </div>
          );
        }
        if (t.role === 'replay') {
          // Replayed assistant line — plain text, left-aligned (no rich card).
          return (
            <div className={`${styles.turn} ${styles.turnSystem}`} key={t.id}>
              <div className={styles.assistantBubble}>{t.text}</div>
            </div>
          );
        }
        if (t.role === 'thinking') {
          return (
            <div className={`${styles.turn} ${styles.turnSystem}`} key={t.id}>
              <div className={styles.thinking}>
                <span className={styles.thinkingDots}>
                  <span />
                  <span />
                  <span />
                </span>
                {t.label}
              </div>
            </div>
          );
        }
        // live reply
        return (
          <div className={`${styles.turn} ${styles.turnSystem}`} key={t.id}>
            <div className={styles.systemWrap}>{t.node}</div>
          </div>
        );
      })}
      </div>
    </div>
  );

  // ── Idle — a definite-height flex column that fits one viewport (≥720px tall).
  // Full centered width now that chat history lives in the app sidebar.
  if (!active) {
    return (
      <div className={`${styles.page} ${styles.pageIdle}`}>
        <div className={styles.idleSpacer} />
        <header className={`${styles.greetBlock} ${styles.greetMorph}`}>
          <h1 className={styles.greeting}>{greeting}</h1>
          <p className={styles.subline}>
            What should we get done{firstName ? `, ${firstName}` : ''}?
          </p>
        </header>

        <div className={styles.composerSlotIdle}>{composer}</div>

        <div className={styles.bandIdle}>
          <BriefingBand
            briefing={briefing}
            pulse={pulse}
            loading={briefing === undefined}
            onRun={(c) => void submit(c)}
          />
        </div>

        <div className={styles.idleSpacer} />
      </div>
    );
  }

  // ── Active — a clean chat: slim pulse strip, transcript, docked composer.
  return (
    <div className={`${styles.page} ${styles.pageActive}`}>
      <div className={styles.pulseStripSlot}>
        <PulseStrip pulse={pulse} />
      </div>

      {transcript}

      <div className={styles.composerDock}>{composer}</div>
    </div>
  );
}
