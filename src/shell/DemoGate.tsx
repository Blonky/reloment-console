// A quiet access gate for the hosted demo. It keeps the preview from being
// openly browsable / indexed and lets us share one code with a prospect — it is
// NOT security (any client-side gate can be bypassed by someone technical; the
// real product authenticates server-side per install). Because this repo is
// PUBLIC, the passcode is never stored in plaintext: we compare a SHA-256 hash,
// so neither the source nor the shipped bundle reveals the word.
//
// The gate is DEMO-ONLY. A real install sets VITE_API_URL, and then this
// component renders its children immediately — production auth is the backend's
// job, not a shared code.

import { useEffect, useRef, useState } from 'react';
import styles from './DemoGate.module.css';

// SHA-256 of the normalized (trimmed, lower-cased) access code. Safe to keep in
// a public repo: it is a one-way hash, not the code. To rotate the code, replace
// this with `sha256(newCodeLowercased)`.
const CODE_HASH = '5aa4771811f50b4e57872486ccd50299b671b411e4817a4bb175c14ef52c8b76';
const STORAGE_KEY = 'reloment.demo.access.v1';

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function alreadyPassed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function DemoGate({ children }: { children: React.ReactNode }) {
  // Production installs (VITE_API_URL set) never see the gate.
  const gated = !import.meta.env.VITE_API_URL;

  const [passed, setPassed] = useState(() => !gated || alreadyPassed());
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!passed) inputRef.current?.focus();
  }, [passed]);

  if (passed) return <>{children}</>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const code = value.trim().toLowerCase();
    if (code === '' || checking) return;
    setChecking(true);
    setError(false);
    const hash = await sha256Hex(code);
    if (hash === CODE_HASH) {
      try {
        localStorage.setItem(STORAGE_KEY, '1');
      } catch {
        /* private mode — the gate simply re-asks next visit */
      }
      setPassed(true);
    } else {
      setError(true);
      setValue('');
      setChecking(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.wordmark}>Reloment</div>
        <p className={styles.sub}>A private preview. Enter your access code to continue.</p>
        <form className={styles.form} onSubmit={submit}>
          <input
            ref={inputRef}
            type="password"
            className={`${styles.input} ${error ? styles.inputError : ''}`}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(false);
            }}
            placeholder="Access code"
            aria-label="Access code"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className={styles.enter}
            disabled={value.trim() === '' || checking}
            aria-label="Enter"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 9h9M9 5l4 4-4 4" />
            </svg>
          </button>
        </form>
        <div className={styles.errorLine} aria-live="polite">
          {error ? "That code doesn't match. Try again." : ''}
        </div>
      </div>
      <div className={styles.footer}>Reloment — a personal account manager for every client</div>
    </div>
  );
}
