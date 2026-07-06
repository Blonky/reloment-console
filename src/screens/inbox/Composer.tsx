// Composer — the thread's bottom anchor (messages-first v4). A normal iMessage-
// family composer: pill-radius auto-growing textarea (1–4 rows) on --surface with
// a hairline border, a circular ＋ menu on the LEFT-inside (attach / send a link),
// and a circular accent send button (↑) inside on the right. Enter sends /
// Shift+Enter newlines. Sends via sendManual → the message.sent event lands the
// bubble live. Replaces the DraftCard as the bottom anchor.
//
// The ＋ menu (r9) opens an upward popover — Request a document ▸ (dec page /
// license / damage photos), Send booking link, Send payment link — each routing
// through sendLink(). Escape / outside-click closes; focus returns to the input.
//
// The Edit / Use suggestion actions load their body here via an imperative
// handle (setBody + focus) so the human edits then sends as the business.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  ArrowUpIcon,
  CalendarIcon,
  CardIcon,
  ChevronRightIcon,
  DocumentIcon,
  PlusIcon,
} from './icons.tsx';
import styles from './InboxScreen.module.css';

export interface ComposerHandle {
  // Load a suggestion's body into the input and focus it (Edit / Use actions).
  loadDraft: (body: string) => void;
}

// The kind of link the composer can send through the ＋ menu.
export type LinkKind = 'booking' | 'payment' | 'document_request';

export interface ComposerProps {
  // First name for the placeholder ("Text Dana…").
  firstName: string;
  // Sends the body via sendManual; resolves false if the gate blocked it.
  onSend: (body: string) => Promise<boolean>;
  // Sends a rich link (booking / payment / document-request) via sendLink().
  onSendLink: (kind: LinkKind, docType?: string) => Promise<boolean>;
}

// The three offered document types (§7), shown in the ＋ menu's document submenu.
const DOC_TYPES: { label: string; docType: string }[] = [
  { label: 'Declarations page', docType: 'declarations page' },
  { label: "Driver's license", docType: "driver's license" },
  { label: 'Damage photos', docType: 'photos of the damage' },
];

const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { firstName, onSend, onSendLink },
  ref,
) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);

  // Auto-size the textarea to its content, 1–4 rows (~24–96px), then scroll.
  const autosize = useCallback(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  useEffect(() => {
    autosize();
  }, [autosize, value]);

  useImperativeHandle(
    ref,
    () => ({
      loadDraft: (body: string) => {
        setValue(body);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (el) {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
          }
        });
      },
    }),
    [],
  );

  // Close the ＋ menu, returning focus to the input (a11y: focus never lost).
  const closeMenu = useCallback((refocus = true) => {
    setMenuOpen(false);
    setDocsOpen(false);
    if (refocus) textareaRef.current?.focus();
  }, []);

  // Escape closes the menu; outside-click (mousedown outside the wrap) closes it.
  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeMenu();
      }
    }
    function onDown(e: MouseEvent) {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        closeMenu(false);
      }
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
    };
  }, [menuOpen, closeMenu]);

  const send = useCallback(async () => {
    const body = value.trim();
    if (body === '' || sending) return;
    setSending(true);
    try {
      const ok = await onSend(body);
      // Clear only on a clean send; a blocked send keeps the text so the human
      // can see what was refused (the GateReason surfaces in the thread).
      if (ok) setValue('');
    } finally {
      setSending(false);
    }
  }, [value, sending, onSend]);

  // Send a link from the ＋ menu, then close it. The link-preview bubble (and any
  // GateReason on a block) lands via the thread refetch — nothing to clear here.
  const sendLink = useCallback(
    async (kind: LinkKind, docType?: string) => {
      if (sending) return;
      closeMenu();
      setSending(true);
      try {
        await onSendLink(kind, docType);
      } finally {
        setSending(false);
      }
    },
    [sending, onSendLink, closeMenu],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const canSend = value.trim() !== '' && !sending;

  return (
    <div className={styles.composer}>
      <div className={styles.composerField}>
        {/* ＋ menu — left-inside the field. Opens an upward popover. */}
        <div className={styles.plusWrap} ref={menuWrapRef}>
          <button
            type="button"
            ref={plusRef}
            className={styles.composerPlus}
            onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
            disabled={sending}
            aria-label="Attach or send a link"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <PlusIcon size={18} />
          </button>

          {menuOpen && (
            <div className={styles.plusMenu} role="menu" aria-label="Send a link">
              {/* Request a document ▸ — expands to the three doc types. */}
              <button
                type="button"
                role="menuitem"
                className={styles.plusMenuRow}
                aria-haspopup="menu"
                aria-expanded={docsOpen}
                onClick={() => setDocsOpen((v) => !v)}
              >
                <span className={styles.plusMenuIcon}>
                  <DocumentIcon size={16} />
                </span>
                <span className={styles.plusMenuLabel}>Request a document</span>
                <span className={`${styles.plusMenuChevron} ${docsOpen ? styles.plusMenuChevronOpen : ''}`}>
                  <ChevronRightIcon size={14} />
                </span>
              </button>
              {docsOpen &&
                DOC_TYPES.map((d) => (
                  <button
                    key={d.docType}
                    type="button"
                    role="menuitem"
                    className={`${styles.plusMenuRow} ${styles.plusMenuRowSub}`}
                    onClick={() => void sendLink('document_request', d.docType)}
                  >
                    <span className={styles.plusMenuLabel}>{d.label}</span>
                  </button>
                ))}

              <div className={styles.plusMenuDivider} />

              <button
                type="button"
                role="menuitem"
                className={styles.plusMenuRow}
                onClick={() => void sendLink('booking')}
              >
                <span className={styles.plusMenuIcon}>
                  <CalendarIcon size={16} />
                </span>
                <span className={styles.plusMenuLabel}>Send booking link</span>
              </button>

              <button
                type="button"
                role="menuitem"
                className={styles.plusMenuRow}
                onClick={() => void sendLink('payment')}
              >
                <span className={styles.plusMenuIcon}>
                  <CardIcon size={16} />
                </span>
                <span className={styles.plusMenuLabel}>Send payment link</span>
              </button>
            </div>
          )}
        </div>

        <textarea
          ref={textareaRef}
          className={styles.composerInput}
          value={value}
          rows={1}
          placeholder={`Text ${firstName}…`}
          aria-label={`Message to ${firstName}`}
          disabled={sending}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className={styles.composerSend}
          onClick={() => void send()}
          disabled={!canSend}
          aria-label="Send message"
        >
          {sending ? (
            <span className={styles.composerSpinner} aria-hidden="true" />
          ) : (
            <ArrowUpIcon size={18} />
          )}
        </button>
      </div>
    </div>
  );
});

export default Composer;
