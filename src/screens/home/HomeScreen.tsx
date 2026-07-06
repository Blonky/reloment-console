// Home — the command channel. "Command a governed fleet in plain language."
//
// A full-height two-column cockpit (DESIGN.md §5): the command channel is the
// hero (left, full height — head / transcript / composer), and a quiet pulse
// rail sits to its right (four compact tiles + derived signals). The channel
// routes plain-language intents through a deterministic parser (parseIntent) to
// governed DataClient tool calls, rendering each result as a card in the
// transcript. After enroll and kill-switch actions the pulse refetches live —
// the pulse reacting to a command is the demo moment.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useClient, useKillSwitch } from '../../shell/ClientContext.tsx';
import { useData } from '../../data/useData.ts';
import type { Contact } from '../../data/types.ts';
import { Button } from '../../components/index.ts';
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
  PulseTiles,
  SignalsCard,
  deriveSignals,
} from './PulseRow.tsx';
import { IconSend } from './icons.tsx';

// ── Transcript model ──────────────────────────────────────────────────────────
type Turn =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'welcome' }
  | { id: number; role: 'thinking'; label: string }
  | { id: number; role: 'reply'; node: React.ReactNode };

// Suggestion chips at the composer foot (a curated slice of the catalogue).
const SUGGESTIONS = ['Show renewals', 'Enroll win-back', 'Campaign status', 'Brief me on Dana'];

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

  // Transcript state.
  const seqRef = useRef(0);
  const nextId = () => (seqRef.current += 1);
  const [turns, setTurns] = useState<Turn[]>(() => [
    { id: 0, role: 'welcome' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the transcript pinned to the latest turn.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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

  // Auto-grow the textarea to its content, capped by CSS max-height.
  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    setInput(el.value);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const paused = pulse.data?.killSwitch ?? false;

  return (
    <div className={styles.page}>
      {/* Command channel — the hero, full-height left column */}
      <section className={styles.channel} aria-label="Command channel">
        <div className={styles.channelHead}>
          <span className={styles.channelTitle}>
            <span
              className={`${styles.channelTitleDot} ${
                paused ? styles.channelTitleDotPaused : ''
              }`}
            />
            Command channel
          </span>
          <span className={styles.channelSub}>
            {paused
              ? 'All sending paused — resume to let the agents send'
              : 'Deterministic router · governed tools'}
          </span>
        </div>

        <div
          className={styles.transcript}
          ref={transcriptRef}
          aria-live="polite"
          aria-label="Command transcript"
        >
          <div className={styles.transcriptInner}>
          {turns.map((t) => {
            if (t.role === 'user') {
              return (
                <div className={`${styles.turn} ${styles.turnUser}`} key={t.id}>
                  <div className={styles.userBubble}>{t.text}</div>
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
            if (t.role === 'welcome') {
              return (
                <div className={`${styles.turn} ${styles.turnSystem}`} key={t.id}>
                  <div className={styles.welcome}>
                    <p className={styles.welcomeLede}>
                      This is your command channel. Tell the fleet what to do in
                      plain language — pull the book, enroll a campaign, brief
                      yourself on a contact, or pause everything. Every action runs
                      through the same governed send gate, and the reply shows you
                      exactly what it did, including who it excluded and why.
                    </p>
                    <p className={styles.welcomeHint}>
                      Deterministic router today — the language-model planner ships
                      with the platform connection.
                    </p>
                  </div>
                </div>
              );
            }
            // reply
            return (
              <div className={`${styles.turn} ${styles.turnSystem}`} key={t.id}>
                <div className={styles.systemWrap}>{t.node}</div>
              </div>
            );
          })}
          </div>
        </div>

        {/* Composer */}
        <div className={styles.composer}>
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
          <div className={styles.composerRow}>
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
              rows={1}
              aria-label="Command input"
              spellCheck={false}
            />
            <Button
              variant="primary"
              className={styles.sendBtn}
              onClick={() => void submit(input)}
              disabled={busy || input.trim().length === 0}
              aria-label="Send command"
            >
              <IconSend size={15} />
              Send
            </Button>
          </div>
        </div>
      </section>

      {/* Pulse rail — quiet metrics + derived signals, right column */}
      <aside className={styles.rail} aria-label="Pulse">
        <PulseTiles pulse={pulse.data} />
        <SignalsCard
          signals={signals}
          loading={book.loading}
          onRun={(cmd) => void submit(cmd)}
        />
      </aside>
    </div>
  );
}
