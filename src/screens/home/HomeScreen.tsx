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
import { parseIntent } from './parseIntent.ts';
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
    case 'pause':
    case 'resume':
      return 'Preparing the confirmation…';
    case 'help':
      return 'One moment…';
  }
}

// Resolve a spoken name ("dana", "dana whitfield") to a contact. First-name and
// substring tolerant; returns the best single match or null.
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
  return contains.length === 1 ? contains[0] : (contains[0] ?? null);
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
  const lastTurnRef = useRef<HTMLDivElement>(null);

  const active = turns.length > 0;
  // Read active/session inside stable callbacks without adding them to deps.
  const activeRef = useRef(active);
  activeRef.current = active;
  const activeSessionRef = useRef(activeSessionId);
  activeSessionRef.current = activeSessionId;

  // Keep the newest turn in view — scroll the shell's document, not a nested box.
  useEffect(() => {
    if (turns.length > 0) {
      lastTurnRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
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
            return {
              node: <HelpCard onRun={(t) => void submit(t)} />,
              narration: `I couldn’t find “${intent.name}” in the book.`,
            };
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
      }
    },
    // submit is referenced through the ref pattern (defined below) to avoid a
    // cycle; it is otherwise stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, contacts, runKillSwitch, refreshLive, navigate],
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

  // Transcript renderer — live (rich) + replayed (plain) turns.
  const transcript = (
    <div
      className={styles.transcript}
      aria-live="polite"
      aria-label="Command transcript"
    >
      {turns.map((t, i) => {
        const isLast = i === turns.length - 1;
        const refProp = isLast ? { ref: lastTurnRef } : {};
        if (t.role === 'user' || (t.role === 'replay' && t.who === 'user')) {
          return (
            <div className={`${styles.turn} ${styles.turnUser}`} key={t.id} {...refProp}>
              <div className={styles.userBubble}>{t.text}</div>
            </div>
          );
        }
        if (t.role === 'replay') {
          // Replayed assistant line — plain text, left-aligned (no rich card).
          return (
            <div className={`${styles.turn} ${styles.turnSystem}`} key={t.id} {...refProp}>
              <div className={styles.assistantBubble}>{t.text}</div>
            </div>
          );
        }
        if (t.role === 'thinking') {
          return (
            <div className={`${styles.turn} ${styles.turnSystem}`} key={t.id} {...refProp}>
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
          <div className={`${styles.turn} ${styles.turnSystem}`} key={t.id} {...refProp}>
            <div className={styles.systemWrap}>{t.node}</div>
          </div>
        );
      })}
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
