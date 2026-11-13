import { useState, type FormEvent } from 'react';
import { ArrowRight, LockKeyhole, UserRound } from 'lucide-react';
import { requestJson, type AuthSession } from './apiClient';

type AccountGateProps = {
  initialError: string;
  onAuthenticated: (session: AuthSession) => void;
  onRetry: () => void;
};

export function AccountGate({ initialError, onAuthenticated, onRetry }: AccountGateProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const session = await requestJson<AuthSession>(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onAuthenticated(session);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="account-gate">
    <section className="account-card" aria-labelledby="account-title">
      <div className="account-mark" aria-hidden="true"><UserRound size={20} /></div>
      <p className="account-eyebrow">C3CANVAS WORKSPACE</p>
      <h1 id="account-title">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
      <p className="account-description">Sign in to access your private character projects.</p>
      <form className="account-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="account-username">Username</label>
        <input
          id="account-username"
          name="username"
          autoComplete="username"
          required
          minLength={mode === 'register' ? 3 : 1}
          maxLength={32}
          pattern={mode === 'register' ? '[A-Za-z0-9_-]+' : undefined}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={submitting}
        />
        <label htmlFor="account-password">Password</label>
        <input
          id="account-password"
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'register' ? 12 : 1}
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={submitting}
        />
        {mode === 'register' && <small className="account-password-hint">Use at least 12 characters. Passwords are stored as scrypt hashes.</small>}
        {(error || initialError) && <p className="account-error" role="alert">{error || initialError}</p>}
        {initialError && <button className="account-retry" type="button" onClick={onRetry}>Retry account check</button>}
        <button className="account-submit" type="submit" disabled={submitting}>
          <LockKeyhole size={15} />
          {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          {!submitting && <ArrowRight size={15} />}
        </button>
      </form>
      <button
        type="button"
        className="account-mode-toggle"
        disabled={submitting}
        onClick={() => { setError(''); setMode((current) => current === 'login' ? 'register' : 'login'); }}
      >{mode === 'login' ? 'New to this workspace? Create an account' : 'Already have an account? Sign in'}</button>
      <p className="account-local-note">Accounts and project data stay on this C3Canvas server.</p>
    </section>
  </main>;
}
