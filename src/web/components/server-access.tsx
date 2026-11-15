import { useState, type FormEvent } from 'react';
import { apiResponse } from '../lib/api';
import { NodGlyph } from './motion';
import { Button, Field, Input, Notice } from './ui';

export function ServerAccess({ onConnected }: { onConnected(): Promise<boolean> }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !email.trim() || !password) return;
    if (mode === 'signup' && !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/signin';
      const payload =
        mode === 'signup'
          ? { name: name.trim(), email: email.trim(), password }
          : { email: email.trim(), password };
      const response = await apiResponse(endpoint, {
        method: 'POST',
        redirect: 'error',
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(
          body?.error ||
            (mode === 'signup'
              ? 'Could not create your account. Please try again.'
              : 'Invalid email or password.'),
        );
        return;
      }
      if (!(await onConnected())) throw new Error('The session could not be opened.');
      setPassword('');
    } catch {
      setError('Could not connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="server-access-page">
      <form
        className="server-access"
        aria-labelledby="server-access-title"
        onSubmit={(event) => void submit(event)}
      >
        <header className="server-access-header">
          <NodGlyph size={72} mode="still" />
          <h1 id="server-access-title">
            {mode === 'signup' ? 'Create your ieAnod account' : 'Sign in to ieAnod'}
          </h1>
          <p>
            {mode === 'signup'
              ? 'Enroll below to start using your ieAnod workspace.'
              : 'Enter your email and password to open your assistant.'}
          </p>
        </header>
        {mode === 'signup' && (
          <Field label="Full name">
            <Input
              type="text"
              autoComplete="name"
              name="name"
              placeholder="Jane Doe"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              disabled={busy}
            />
          </Field>
        )}
        <Field label="Email address">
          <Input
            type="email"
            autoComplete="email"
            name="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={busy}
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            name="password"
            placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={busy}
          />
        </Field>
        {error && <Notice>{error}</Notice>}
        <Button
          type="submit"
          disabled={busy || !email.trim() || !password || (mode === 'signup' && !name.trim())}
        >
          {busy
            ? mode === 'signup'
              ? 'Creating account…'
              : 'Signing in…'
            : mode === 'signup'
              ? 'Sign up'
              : 'Sign in'}
        </Button>
        <p className="server-access-note" style={{ textAlign: 'center', marginTop: '12px' }}>
          {mode === 'signup' ? 'Already have an account? ' : 'New to ieAnod? '}
          <button
            type="button"
            className="ob-link"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              font: 'inherit',
              cursor: 'pointer',
              color: 'var(--accent)',
              textDecoration: 'underline',
            }}
            onClick={() => {
              setMode(mode === 'signup' ? 'signin' : 'signup');
              setError('');
            }}
          >
            {mode === 'signup' ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </form>
    </main>
  );
}
