// Composer — the thread's bottom anchor (messages-first v4). A normal iMessage-
// family composer: pill-radius auto-growing textarea (1–4 rows) on --surface with
// a hairline border, and a circular accent send button (↑) inside on the right.
// Enter sends / Shift+Enter newlines. Sends via sendManual → the message.sent
// event lands the bubble live. Replaces the DraftCard as the bottom anchor.
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
import { ArrowUpIcon } from './icons.tsx';
import styles from './InboxScreen.module.css';

export interface ComposerHandle {
  // Load a suggestion's body into the input and focus it (Edit / Use actions).
  loadDraft: (body: string) => void;
}

export interface ComposerProps {
  // First name for the placeholder ("Text Dana…").
  firstName: string;
  // Sends the body via sendManual; resolves false if the gate blocked it.
  onSend: (body: string) => Promise<boolean>;
}

const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { firstName, onSend },
  ref,
) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
