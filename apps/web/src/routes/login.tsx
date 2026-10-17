import { useState, type FormEvent } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import '../styles/login.css';

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
  } catch {}
  return GENERIC_FAILURE;
}

function EyeIcon({ off }: { off: boolean }) {
  if (off) {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
        <line x1="2" y1="2" x2="22" y2="22" />
      </svg>
    );
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const trimmed = username.trim();
    if (trimmed === '') {
      setError('Isi nama pengguna terlebih dahulu.');
      return;
    }
    if (password === '') {
      setError('Isi kata sandi terlebih dahulu.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: trimmed, password }),
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
    <section className="login-page" aria-labelledby="login-title">
      <header className="login-header">
        <div className="login-brand">
          <img
            src="/assets/login/upi-tasikmalaya.png"
            alt="Logo UPI Kampus Tasikmalaya"
            width={36}
            height={36}
          />
          <div className="login-brand-text">
            <strong>UNIVERSITAS PENDIDIKAN INDONESIA</strong>
            <span>Kampus Tasikmalaya · Smart Campus Maintenance System</span>
          </div>
        </div>
        <span className="portal-pill">
          <span className="portal-dot" aria-hidden="true" />
          Portal Layanan Terpadu
        </span>
      </header>
      <main className="login-main">
        <div className="login-card">
          <h1 id="login-title">Masuk ke Akun</h1>
          <p className="login-subtitle">Silakan masukkan kredensial akun SSO UPI Anda.</p>
          <form onSubmit={(e: FormEvent<HTMLFormElement>) => void onSubmit(e)}>
            <label className="login-label" htmlFor="login-username">
              Nama pengguna
            </label>
            <input
              id="login-username"
              name="username"
              type="text"
              autoComplete="username"
              required
              maxLength={128}
              placeholder="NIM / NIP / email institusi"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={pending}
              className="login-input"
            />
            <div className="password-row">
              <label className="login-label" htmlFor="login-password">
                Kata sandi
              </label>
              <a className="forgot-link" href="#lupa-kata-sandi">
                Lupa kata sandi?
              </a>
            </div>
            <div className="password-wrap">
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={pending}
                className="login-input password-input"
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
                disabled={pending}
              >
                <EyeIcon off={showPassword} />
              </button>
            </div>
            {error !== null ? (
              <p className="login-error" role="alert">
                {error}
              </p>
            ) : null}
            <button className="login-submit" type="submit" disabled={pending}>
              <span>{pending ? 'Memeriksa…' : 'Masuk'}</span>
              <ArrowIcon />
            </button>
          </form>
          <div className="login-card-foot">
            <Link to="/kebijakan-privasi">Kebijakan Privasi</Link>
          </div>
        </div>
      </main>
      <footer className="login-footer">
        <span>© 2025 Universitas Pendidikan Indonesia. Seluruh hak cipta dilindungi.</span>
        <span>SCMS v1.0 · UMPER UPI Kampus Tasikmalaya</span>
      </footer>
    </section>
  );
}
