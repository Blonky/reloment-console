// AuthGate — decides whether this install needs a sign-in, and blocks the app
// until it has one.
//
// It asks the BACKEND rather than guessing from build vars: GET /api/auth/me
// answers { authRequired, user }. A demo/dev install answers authRequired:false
// and renders straight through; a real install answers 401 until there's a
// session. That means the console cannot be tricked into skipping the login
// screen by editing a bundled flag — the server decides, and the server is the
// thing holding the data.
//
// While the check is in flight we render NOTHING (not the login screen): a
// signed-in owner refreshing their console must never see a login flash.

import { useCallback, useEffect, useState } from 'react';
import { useClient } from './ClientContext.tsx';
import LoginScreen from './LoginScreen.tsx';

type Status =
  | { kind: 'checking' }
  | { kind: 'open' } // no auth required (demo / dev install)
  | { kind: 'authed' }
  | { kind: 'anonymous' }
  | { kind: 'unreachable' };

export default function AuthGate({
  children,
  onAuthed,
}: {
  children: React.ReactNode;
  onAuthed?: () => void;
}) {
  const client = useClient();
  const [status, setStatus] = useState<Status>({ kind: 'checking' });

  const check = useCallback(async () => {
    try {
      const me = await client.me();
      if (!me.authRequired) return setStatus({ kind: 'open' });
      setStatus(me.user ? { kind: 'authed' } : { kind: 'anonymous' });
    } catch {
      // The platform is unreachable. This is NOT "logged out" — telling the
      // owner to sign in when the backend is down sends them chasing a password
      // that was never wrong.
      setStatus({ kind: 'unreachable' });
    }
  }, [client]);

  useEffect(() => {
    void check();
  }, [check]);

  if (status.kind === 'checking') return null;

  if (status.kind === 'unreachable') {
    return (
      <div style={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <p style={{ maxWidth: '42ch', textAlign: 'center', color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Couldn't reach the platform. Your sign-in is fine — the connection isn't. Refresh once it's back.
        </p>
      </div>
    );
  }

  if (status.kind === 'anonymous') {
    return (
      <LoginScreen
        onSignedIn={() => {
          setStatus({ kind: 'authed' });
          onAuthed?.();
        }}
      />
    );
  }

  return <>{children}</>;
}
