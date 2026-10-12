// Login page (Phase 2 P2-4). Minimal username form: POST /api/auth/login
// (cookie included) then navigate to '/' on 200. Server messages are generic
// by contract (`Kredensial salah`), so displaying them cannot enumerate
// accounts; anything unparseable falls back to a generic failure line.
// Accessible (label, role=alert error, disabled-while-pending) with
// Indonesian copy. Styled per DESIGN.md (Task D-3): centered lg-radius auth
// card with institutional header; D-1 Input + primary Button.
import { useState, type FormEvent } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, Input } from '../components/index.js';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

const GENERIC_FAILURE = 'Login gagal. Silakan coba lagi.';

interface ErrorBody {
  readonly error?: { readonly message?: unknown };
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as ErrorBody;
    if (typeof data.error?.message === 'string' && data.error.message !== '') {
      return data.error.message;
    }
  } catch {
    // Unparseable body — keep the generic message below.
  }
  return GENERIC_FAILURE;
}

function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) {
      return;
    }
    const trimmed = username.trim();
    if (trimmed === '') {
      setError('Isi nama pengguna terlebih dahulu.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: trimmed }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response));
        return;
      }
      await navigate({ to: '/' });
    } catch {
      setError(GENERIC_FAILURE);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center justify-center bg-background px-4 py-16">
      <section
        aria-labelledby="login-title"
        className="w-full max-w-md rounded-lg border border-border bg-surface px-6 py-8 shadow-sm"
      >
        <div>
          <p className="text-lg font-semibold tracking-tight text-text">SILAPOR</p>
          <p className="mt-1 text-sm text-muted">UPI Kampus Tasikmalaya</p>
        </div>
        <h1 id="login-title" className="mt-6 text-2xl font-semibold text-text">
          Masuk SILAPOR
        </h1>
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => void onSubmit(event)}
          className="mt-6 flex flex-col gap-4"
        >
          <div>
            <label
              htmlFor="login-username"
              className="mb-1 block text-sm font-medium text-text"
            >
              Nama pengguna
            </label>
            <Input
              id="login-username"
              name="username"
              type="text"
              autoComplete="username"
              required
              maxLength={128}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={pending}
            />
          </div>
          {error !== null ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? 'Memeriksa…' : 'Masuk'}
          </Button>
        </form>
      </section>
    </div>
  );
}
