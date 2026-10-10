// Login page (Phase 2 P2-4). Minimal username form: POST /api/auth/login
// (cookie included) then navigate to '/' on 200. Server messages are generic
// by contract (`Kredensial salah`), so displaying them cannot enumerate
// accounts; anything unparseable falls back to a generic failure line.
// Accessible (label, role=alert error, disabled-while-pending) with
// Indonesian copy. No styling dependencies.
import { useState, type FormEvent } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

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
    <section aria-labelledby="login-title">
      <h1 id="login-title">Masuk SILAPOR</h1>
      <form onSubmit={(event: FormEvent<HTMLFormElement>) => void onSubmit(event)}>
        <div>
          <label htmlFor="login-username">Nama pengguna</label>
          <input
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
        {error !== null ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={pending}>
          {pending ? 'Memeriksa…' : 'Masuk'}
        </button>
      </form>
    </section>
  );
}
