// The sign-in screen for a real install.
//
// Deliberately plain: this is the first thing an agency owner sees each morning
// and the last thing that should feel clever. No "forgot password" link yet —
// accounts are provisioned by the install (npm run user:create), so a reset is a
// call to their FDE, and a self-serve reset flow would be a lie until there's an
// email sender behind it.
//
// The password never leaves this component except in the login POST, and no
// token ever comes back to JS: the server replies with an httpOnly cookie.

import { useEffect, useRef, useState } from 'react';
import { useClient } from './ClientContext.tsx';
import styles from './LoginScreen.module.css';

const MESSAGES: Record<string, string> = {
  invalid_credentials: "That email and password don't match.",
  account_locked: 'Too many attempts. This account is locked for a few minutes.',
  forbidden_origin: 'This console is not authorised to sign in against that API.',
};

export default function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const client = useClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await client.login(email.trim(), password);
      if (res.ok) {
        setPassword('');
        onSignedIn();
        return;
      }
      const extra =
        res.retryAfterSec && res.retryAfterSec > 0
          ? ` Try again in about ${Math.ceil(res.retryAfterSec / 60)} minute${res.retryAfterSec > 90 ? 's' : ''}.`
          : '';
      setError((MESSAGES[res.error] ?? 'Sign-in failed.') + extra);
      setPassword('');
    } catch {
      // A network/backend failure is NOT a credential problem — say so, so the
      // owner calls their FDE instead of retyping a correct password.
      setError("Couldn't reach the platform. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.brand}>Reloment</div>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.sub}>Your account manager is waiting.</p>

        <form className={styles.form} onSubmit={submit}>
          <label className={styles.label} htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            ref={emailRef}
            className={styles.input}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
          />

          <label className={styles.label} htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className={styles.input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />

          <button className={styles.submit} type="submit" disabled={busy || !email.trim() || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className={styles.errorLine} role="alert" aria-live="polite">
          {error ?? ''}
        </div>
      </div>
    </div>
  );
}
