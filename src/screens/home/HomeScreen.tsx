// Home — the command surface (Sauna-pattern, v2; DESIGN.md §5).
//
// A CENTERED command surface, not a dashboard grid. One scrollable centered
// column on paper. Two states:
//   idle   — greeting (Fraunces, data-led) → 720px composer card → 980px
//            analytics band (4 stat cards + Signals) → honesty footer.
//   active — greeting collapses; the transcript takes the centered column, the
//            composer docks sticky at the viewport bottom, and the analytics
//            band tucks below the transcript (still live-updating).
//
// The page scrolls as a document (the shell's <main> scrolls). Behavior is
// unchanged from v1: parseIntent router, every reply card, the thinking row,
// the kill-switch typed-confirm card, aria-live, pulse refetch after mutations,
// Enter submits / Shift+Enter newline, chips submit.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { useClient, useKillSwitch } from '../../shell/ClientContext.tsx';
import { useData } from '../../data/useData.ts';
import type { Contact, HomePulse } from '../../data/types.ts';
import styles from './HomeScreen.module.css';
import { parseIntent } from './parseIntent.ts';
import type { Intent } from './parseIntent.ts';
import {
  BookCard,
  EnrollCard,
  CampaignCard,
  BriefCard,
  SearchCard,
  HelpCard,
} from './ReplyCards.tsx';
import KillSwitchCard from './KillSwitchCard.tsx';
import type { KillSwitchMode } from './KillSwitchCard.tsx';
import {
  AnalyticsBand,
  deriveSignals,
} from './PulseRow.tsx';
import { IconSend } from './icons.tsx';

// ── Transcript model ──────────────────────────────────────────────────────────
type Turn =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'thinking'; label: string }
  | { id: number; role: 'reply'; node: React.ReactNode };

// Suggestion chips inside the composer footer (a curated slice of the catalogue).
const SUGGESTIONS = ['Show renewals', 'Enroll win-back', 'Campaign status', 'Brief me on Dana'];

// ── Greeting — deterministic per the DataClient clock, derived from live pulse.
// Time-of-day comes from client.now() (never Date.now()); the sentence is
// composed from real pulse data so the surface reads back what the fleet is
// actually doing.
function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function timeOfDay(nowMs: number): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date(nowMs).getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function greetingLine(pulse: HomePulse | undefined, nowMs: number): string {
  const part = timeOfDay(nowMs);
  const salutation =
    part === 'morning' ? 'Morning.' : part === 'afternoon' ? 'Good afternoon.' : 'Good evening.';
  if (!pulse) return salutation;

  const needs = pulse.needsYourEyes;
  const running = pulse.conversationsRunning;

  // Something needs the operator → lead with it (the hero action).
  if (needs > 0) {
    return `${salutation} ${needs} ${needs === 1 ? 'conversation needs' : 'conversations need'} your eyes.`;
  }
  // Nothing pending but the fleet is holding threads → calm "all quiet".
  if (running > 0) {
    return `All quiet. The fleet is holding ${running} ${
      running === 1 ? 'conversation' : 'conversations'
    }.`;
  }
  // Nothing running at all → fall back to recovered revenue if any, else calm.
  if (pulse.wonBackCents > 0) {
    return `All quiet. ${dollars(pulse.wonBackCents)} recovered so far.`;
  }
  return `All quiet. Nothing needs you right now.`;
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
  const [searchParams, setSearchParams] = useSearchParams();

  // Pulse — refetched after mutating commands so the tiles react live.
  const pulse = useData(() => client.home(), [client]);
  // The book context for signals + name resolution (contacts, lapsed read).
  const book = useData(
    () => Promise.all([client.contacts(), client.queryBook('lapsed')]),
    [client],
  );
  const contacts = book.data?.[0] ?? [];
  const lapsed = book.data?.[1] ?? [];
  const signals = useMemo(
    () => (book.data ? deriveSignals(contacts, lapsed) : []),
    [book.data, contacts, lapsed],
  );

  // Deterministic greeting from the client clock + live pulse.
  const greeting = useMemo(
    () => greetingLine(pulse.data, client.now()),
    [pulse.data, client],
  );

  // Transcript state.
  const seqRef = useRef(0);
  const nextId = () => (seqRef.current += 1);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastTurnRef = useRef<HTMLDivElement>(null);

  const active = turns.length > 0;

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
      pulse.refetch();
    },
    [client, setKillSwitch, pulse],
  );

  // Dispatch a parsed intent to its governed tool + render the reply card.
  const dispatch = useCallback(
    async (intent: Intent) => {
      switch (intent.kind) {
        case 'renewals': {
          const rows = await client.queryBook('renewals');
          resolveThinking(<BookCard kind="renewals" rows={rows} />);
          break;
        }
        case 'lapsed': {
          const rows = await client.queryBook('lapsed');
          resolveThinking(<BookCard kind="lapsed" rows={rows} />);
          break;
        }
        case 'enroll_winback': {
          const result = await client.enrollPlaybook('winback_lapsed');
          resolveThinking(<EnrollCard result={result} />);
          pulse.refetch(); // "Needs your eyes" increments — the demo moment
          book.refetch();
          break;
        }
        case 'campaign_status': {
          const rows = await client.campaignStatus();
          resolveThinking(<CampaignCard rows={rows} />);
          break;
        }
        case 'brief': {
          const contact = resolveContact(intent.name, contacts);
          if (!contact) {
            resolveThinking(
              <HelpCard onRun={(t) => void submit(t)} />,
            );
            break;
          }
          const brief = await client.threadBrief(contact.id);
          resolveThinking(<BriefCard brief={brief} />);
          break;
        }
        case 'search': {
          const hits = await client.searchConversations(intent.query);
          resolveThinking(<SearchCard query={intent.query} hits={hits} />);
          break;
        }
        case 'pause': {
          resolveThinking(
            <KillSwitchCard
              mode={'pause' as KillSwitchMode}
              onConfirm={() => runKillSwitch(true)}
            />,
          );
          break;
        }
        case 'resume': {
          resolveThinking(
            <KillSwitchCard
              mode={'resume' as KillSwitchMode}
              onConfirm={() => runKillSwitch(false)}
            />,
          );
          break;
        }
        case 'help': {
          resolveThinking(<HelpCard onRun={(t) => void submit(t)} />);
          break;
        }
      }
    },
    // submit is defined below; it is stable via useCallback and referenced
    // through the ref pattern to avoid a cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, contacts, resolveThinking, runKillSwitch, pulse, book],
  );

  // Submit a line: render the user turn, a thinking row, then dispatch.
  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (text.length === 0 || busy) return;
      setInput('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      const intent = parseIntent(text);
      setTurns((prev) => [
        ...prev,
        { id: nextId(), role: 'user', text },
        { id: nextId(), role: 'thinking', label: thinkingLabel(intent) },
      ]);
      setBusy(true);
      try {
        await dispatch(intent);
      } catch {
        resolveThinking(
          <div className={styles.reply}>
            <div className={styles.replyBody}>
              <p className={styles.errorLine}>
                That command couldn’t complete. Nothing was sent — try again.
              </p>
            </div>
          </div>,
        );
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, dispatch, resolveThinking],
  );

  // Command-palette deep link: when arriving at /?cmd=<phrase> (from the ⌘K
  // palette's "Commands" group), submit the phrase through the real command
  // path so it renders as a governed turn, then strip the param via history
  // replace. Fires once per distinct cmd value.
  const consumedCmdRef = useRef<string | null>(null);
  const cmd = searchParams.get('cmd');
  useEffect(() => {
    if (cmd === null || cmd.trim() === '') return;
    if (consumedCmdRef.current === cmd) return;
    consumedCmdRef.current = cmd;
    void submit(cmd);
    // Strip ?cmd from the URL without adding a history entry.
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
    <div className={styles.composerCard}>
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
        placeholder="Command the fleet — e.g. “show renewals”, “enroll win-back”, “brief me on Dana”"
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

  return (
    <div className={styles.page}>
      {!active && (
        <>
          <div className={styles.greetSpacer} />
          <header className={styles.greetBlock}>
            <h1 className={styles.greeting}>{greeting}</h1>
            <p className={styles.subline}>
              Every command runs the governed send gate — replies show exactly
              who was excluded, and why.
            </p>
          </header>
        </>
      )}

      {/* Idle: composer centered at the top. Active: composer is rendered
          separately as a sticky dock below, so here it only appears when idle. */}
      {!active && <div className={styles.composerSlotIdle}>{composer}</div>}

      {/* Transcript — only in the active state; owns the centered column. */}
      {active && (
        <div
          className={styles.transcript}
          aria-live="polite"
          aria-label="Command transcript"
        >
          {turns.map((t, i) => {
            const isLast = i === turns.length - 1;
            const refProp = isLast ? { ref: lastTurnRef } : {};
            if (t.role === 'user') {
              return (
                <div
                  className={`${styles.turn} ${styles.turnUser}`}
                  key={t.id}
                  {...refProp}
                >
                  <div className={styles.userBubble}>{t.text}</div>
                </div>
              );
            }
            if (t.role === 'thinking') {
              return (
                <div
                  className={`${styles.turn} ${styles.turnSystem}`}
                  key={t.id}
                  {...refProp}
                >
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
            // reply
            return (
              <div
                className={`${styles.turn} ${styles.turnSystem}`}
                key={t.id}
                {...refProp}
              >
                <div className={styles.systemWrap}>{t.node}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sticky composer dock — active state only. */}
      {active && <div className={styles.composerDock}>{composer}</div>}

      {/* Analytics band — idle: below the composer; active: below the
          transcript. Same component, still live-updating either way. */}
      <div className={active ? styles.bandActive : styles.bandIdle}>
        <AnalyticsBand
          pulse={pulse.data}
          signals={signals}
          signalsLoading={book.loading}
          onRun={(cmd) => void submit(cmd)}
        />
      </div>

      {!active && (
        <p className={styles.honesty}>
          Deterministic router today — the language-model planner ships with the
          platform connection.
        </p>
      )}
    </div>
  );
}
