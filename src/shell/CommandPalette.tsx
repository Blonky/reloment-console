// Command palette (⌘K / Ctrl+K) — the flagship global launcher (DESIGN.md §4).
//
// Opens on ⌘K/Ctrl+K, closes on Escape or scrim click. Traps focus while open,
// arrow keys + Enter select, type-to-filter (case-insensitive substring over
// label + keywords). Two groups:
//   Go to    — the 7 screens (navigate to their route)
//   Commands — plain-language commands that navigate to /?cmd=<phrase>; Home
//              reads the cmd param and submits it through the real command path,
//              so it renders as a governed turn.
// Rendered in a portal; role="dialog" aria-modal, the input is labelled.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import styles from './CommandPalette.module.css';

// ── Icons — 16px, stroke 1.5. The seven "Go to" icons mirror the sidebar so a
// user recognizes the same glyph in both places. Command icons follow.
const strokeProps = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" {...strokeProps} aria-hidden="true">
      {children}
    </svg>
  );
}

const IconHome = (
  <Svg>
    <path d="M2.5 7 8 2.5 13.5 7" />
    <path d="M4 6.5V13h8V6.5" />
  </Svg>
);
const IconInbox = (
  <Svg>
    <path d="M2.5 3.5h11v9h-11z" />
    <path d="M2.5 9.5h3l1 1.5h3l1-1.5h3" />
  </Svg>
);
const IconContacts = (
  <Svg>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3.5 13c0-2.2 2-3.5 4.5-3.5s4.5 1.3 4.5 3.5" />
  </Svg>
);
const IconCampaigns = (
  <Svg>
    <path d="M3 6.5 11.5 3v10L3 9.5z" />
    <path d="M3 6.5H2.5v3H3" />
    <path d="M5 10v2.5" />
  </Svg>
);
const IconAgents = (
  <Svg>
    <rect x="3.5" y="5.5" width="9" height="7" rx="1.5" />
    <path d="M8 5.5V3" />
    <circle cx="8" cy="2.5" r="0.75" />
    <path d="M6 8.5v1.5M10 8.5v1.5" />
  </Svg>
);
const IconInsights = (
  <Svg>
    <path d="M2.5 13.5h11" />
    <path d="M4.5 11.5V8M8 11.5V4.5M11.5 11.5V6.5" />
  </Svg>
);
const IconTrust = (
  <Svg>
    <path d="M8 2 13 4v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" />
    <path d="M6 8l1.5 1.5L10.5 6.5" />
  </Svg>
);

const IconCalendar = (
  <Svg>
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
    <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" />
  </Svg>
);
const IconLapsing = (
  <Svg>
    <path d="M8 4.5v3.5l2 1.5" />
    <circle cx="8" cy="8" r="5.5" />
  </Svg>
);
const IconEnroll = (
  <Svg>
    <circle cx="6" cy="6" r="2.2" />
    <path d="M2.5 13c0-2 1.6-3 3.5-3 1 0 1.9.3 2.5.8" />
    <path d="M11.5 8.5v4M13.5 10.5h-4" />
  </Svg>
);
const IconCampaignStatus = (
  <Svg>
    <path d="M2.5 13.5h11" />
    <rect x="3.5" y="8" width="2" height="4" rx="0.5" />
    <rect x="7" y="5.5" width="2" height="6.5" rx="0.5" />
    <rect x="10.5" y="3.5" width="2" height="8.5" rx="0.5" />
  </Svg>
);
const IconBrief = (
  <Svg>
    <path d="M4 2.5h5l3 3v8H4z" />
    <path d="M9 2.5v3h3" />
    <path d="M6 8.5h4M6 10.5h3" />
  </Svg>
);
const IconPause = (
  <Svg>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M6.5 6v4M9.5 6v4" />
  </Svg>
);
const IconResume = (
  <Svg>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M6.5 5.5 10.5 8l-4 2.5z" />
  </Svg>
);

// ── Item model ────────────────────────────────────────────────────────────────
type PaletteItem = {
  id: string;
  label: string;
  group: 'Go to' | 'Commands';
  icon: ReactNode;
  keywords: string;
} & ({ kind: 'nav'; to: string } | { kind: 'command'; phrase: string });

const ITEMS: PaletteItem[] = [
  // Go to — the seven surfaces.
  { id: 'nav-home', kind: 'nav', to: '/', label: 'Home', group: 'Go to', icon: IconHome, keywords: 'command channel pulse dashboard start' },
  { id: 'nav-inbox', kind: 'nav', to: '/inbox', label: 'Inbox', group: 'Go to', icon: IconInbox, keywords: 'approvals queue threads triage cockpit drafts' },
  { id: 'nav-contacts', kind: 'nav', to: '/contacts', label: 'Contacts', group: 'Go to', icon: IconContacts, keywords: 'book customers people memory roster' },
  { id: 'nav-campaigns', kind: 'nav', to: '/campaigns', label: 'Campaigns', group: 'Go to', icon: IconCampaigns, keywords: 'playbooks runs marketing enrolled excluded' },
  { id: 'nav-agents', kind: 'nav', to: '/agents', label: 'Agents', group: 'Go to', icon: IconAgents, keywords: 'roster autonomy ceiling line number fleet' },
  { id: 'nav-insights', kind: 'nav', to: '/insights', label: 'Insights', group: 'Go to', icon: IconInsights, keywords: 'outcomes recovered revenue ledger analytics' },
  { id: 'nav-trust', kind: 'nav', to: '/trust', label: 'Trust & Settings', group: 'Go to', icon: IconTrust, keywords: 'kill switch opt-out audit compliance settings pause' },

  // Commands — routed to /?cmd=<phrase>; Home submits them through the real path.
  { id: 'cmd-renewals', kind: 'command', phrase: 'Show renewals', label: 'Show renewals', group: 'Commands', icon: IconCalendar, keywords: 'renewal due upcoming 30 days book' },
  { id: 'cmd-lapsing', kind: 'command', phrase: "Who's lapsing", label: "Who's lapsing", group: 'Commands', icon: IconLapsing, keywords: 'lapsed cold dropped off win-back candidates' },
  { id: 'cmd-enroll', kind: 'command', phrase: 'Enroll win-back', label: 'Enroll win-back', group: 'Commands', icon: IconEnroll, keywords: 'winback playbook enroll re-engage lapsed run' },
  { id: 'cmd-campaign', kind: 'command', phrase: 'Campaign status', label: 'Campaign status', group: 'Commands', icon: IconCampaignStatus, keywords: 'campaigns progress enrolled excluded sent replied' },
  { id: 'cmd-brief', kind: 'command', phrase: 'Brief me on Dana', label: 'Brief me on Dana', group: 'Commands', icon: IconBrief, keywords: 'brief contact story background dana memory consent' },
  { id: 'cmd-pause', kind: 'command', phrase: 'Pause all sending', label: 'Pause all sending', group: 'Commands', icon: IconPause, keywords: 'kill switch stop halt freeze emergency pause everything' },
  { id: 'cmd-resume', kind: 'command', phrase: 'Resume sending', label: 'Resume sending', group: 'Commands', icon: IconResume, keywords: 'unpause resume start again re-enable clear' },
];

// Ranked match: an exact label hit must always beat a keyword hit (typing
// "enroll" should select the "Enroll win-back" command, not Campaigns via its
// "enrolled" keyword). Lower score = better; -1 = no match.
function score(item: PaletteItem, q: string): number {
  if (q === '') return 0;
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (label.includes(q)) return 1;
  if (`${item.keywords} ${item.group}`.toLowerCase().includes(q)) return 2;
  return -1;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Filtered flat list in RANK order (used for keyboard indexing and, when a
  // query is present, for display order too). Stable within a rank tier.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ITEMS.map((it) => ({ it, s: score(it, q) }))
      .filter(({ s }) => s >= 0)
      .sort((a, b) => a.s - b.s)
      .map(({ it }) => it);
  }, [query]);

  // Reset transient state each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Focus the input after the portal mounts.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  // Keep the active index in range as the filter narrows.
  useEffect(() => {
    setActive((a) => (a >= filtered.length ? Math.max(0, filtered.length - 1) : a));
  }, [filtered.length]);

  // Scroll the active row into view on keyboard movement.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const run = useCallback(
    (item: PaletteItem) => {
      onClose();
      if (item.kind === 'nav') {
        navigate(item.to);
      } else {
        // Deep-link the command into Home; Home reads ?cmd and submits it.
        navigate(`/?cmd=${encodeURIComponent(item.phrase)}`);
      }
    },
    [navigate, onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => (filtered.length === 0 ? 0 : (a + 1) % filtered.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (filtered.length === 0 ? 0 : (a - 1 + filtered.length) % filtered.length));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[active];
        if (item) run(item);
        return;
      }
      // Focus trap: Tab cycles within the card only (input is the sole tabbable).
      if (e.key === 'Tab') {
        e.preventDefault();
      }
    },
    [filtered, active, run, onClose],
  );

  if (!open) return null;

  // Render groups in fixed order; each item carries its flat index for keyboard.
  const groups: Array<PaletteItem['group']> = ['Go to', 'Commands'];

  return createPortal(
    <div
      className={styles.scrim}
      onMouseDown={(e) => {
        // Scrim click (outside the card) closes.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
      >
        <div className={styles.inputRow}>
          <span className={styles.searchIcon}>
            <svg width="16" height="16" viewBox="0 0 16 16" {...strokeProps} aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M13.5 13.5 10.5 10.5" />
            </svg>
          </span>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Search screens and commands…"
            aria-label="Search commands"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div className={styles.results} ref={listRef}>
          {filtered.length === 0 ? (
            <p className={styles.empty}>No matches. Try “inbox”, “renewals”, or “pause”.</p>
          ) : query.trim() !== '' ? (
            // Searching: one flat list in rank order, so what you see is the
            // exact order the arrow keys walk (each row keeps its group kicker).
            filtered.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                data-idx={idx}
                className={`${styles.row} ${idx === active ? styles.rowActive : ''}`}
                onMouseMove={() => setActive(idx)}
                onClick={() => run(item)}
              >
                <span className={styles.rowIcon}>{item.icon}</span>
                <span className={styles.rowMain}>
                  <span className={styles.rowLabel}>{item.label}</span>
                  <span className={styles.rowKicker}>{item.group}</span>
                </span>
              </button>
            ))
          ) : (
            groups.map((group) => {
              const groupItems = filtered.filter((it) => it.group === group);
              if (groupItems.length === 0) return null;
              return (
                <div key={group}>
                  <div className={styles.groupKicker}>{group}</div>
                  {groupItems.map((item) => {
                    const idx = filtered.indexOf(item);
                    const isActive = idx === active;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-idx={idx}
                        className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
                        onMouseMove={() => setActive(idx)}
                        onClick={() => run(item)}
                      >
                        <span className={styles.rowIcon}>{item.icon}</span>
                        <span className={styles.rowMain}>
                          <span className={styles.rowLabel}>{item.label}</span>
                          <span className={styles.rowKicker}>{item.group}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.hint}>
            <span className={styles.kbd}>↑</span>
            <span className={styles.kbd}>↓</span>
            navigate
          </span>
          <span className={styles.hint}>
            <span className={styles.kbd}>↵</span>
            select
          </span>
          <span className={styles.hint}>
            <span className={styles.kbd}>esc</span>
            close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
