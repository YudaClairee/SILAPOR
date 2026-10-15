
import { useState, type FormEvent } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
// @ts-expect-error CSS is handled by the Vite bundler at runtime.
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
    <section className="login-page" aria-labelledby="login-title">
      <header className="institutional-header">
        <div className="institutional-brand">
          <img src="/assets/login/upi-tasikmalaya.png" alt="Logo UPI Kampus Tasikmalaya" />
          <div>
            <strong>UNIVERSITAS PENDIDIKAN INDONESIA</strong>
            <span>Kampus Daerah Tasikmalaya</span>
          </div>
        </div>
        <div className="header-actions">
          <span className="connection-status">
            <span aria-hidden="true" />
            Sistem Terhubung SSO
          </span>
          <a href="#helpdesk">Bantuan Teknis</a>
        </div>
      </header>

      <div className="login-main">
        <div className="login-column">
          <div className="auth-card">
            <div className="auth-accent" aria-hidden="true" />
            <div className="auth-logo-shell">
              <img src="/assets/login/upi-tasikmalaya.png" alt="" />
            </div>
            <div className="auth-heading">
              <h1 id="login-title">Smart Campus Maintenance System</h1>
              <p>UPI KAMPUS TASIKMALAYA</p>
            </div>
            <p className="auth-description">
              Portal terpadu sivitas akademika (Mahasiswa, Dosen, dan Tenaga Kependidikan) untuk
              pelaporan kerusakan, inspeksi aset, dan monitoring pemeliharaan fasilitas kampus
              secara berkala.
            </p>
            <div className="role-preview" aria-label="Cakupan akses">
              <div>
                <span>Mahasiswa, Dosen, &amp; Tendik</span>
                <strong>Pelapor Fasilitas</strong>
              </div>
              <span className="role-divider" aria-hidden="true" />
              <div>
                <span>Unit UMPER</span>
                <strong>Tim Operasional</strong>
              </div>
            </div>

            <form onSubmit={(event: FormEvent<HTMLFormElement>) => void onSubmit(event)}>
              <label className="username-field" htmlFor="login-username">
                <span>ID SSO UPI</span>
                <input
                  id="login-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  maxLength={128}
                  placeholder="Masukkan ID SSO UPI"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  disabled={pending}
                />
              </label>
              {error !== null ? <p className="login-error" role="alert">{error}</p> : null}
              <button className="sso-button" type="submit" disabled={pending}>
                <img src="/assets/login/sso.svg" alt="" aria-hidden="true" />
                <span>{pending ? 'Memeriksa…' : 'Masuk dengan Akun SSO UPI'}</span>
              </button>
            </form>

            <div className="security-note">
              <span>
                Autentikasi terenkripsi resmi melalui protokol SSO Universitas
                <br />
                Pendidikan Indonesia.
              </span>
            </div>
          </div>

          <div className="login-guidance" id="helpdesk">
            <p>
              Mengalami kendala saat login akun UPI? Hubungi{' '}
              <a href="mailto:helpdesk@upi.edu">Layanan Helpdesk TIK Kampus Tasikmalaya</a>.
            </p>
            <small>© 2025 Universitas Pendidikan Indonesia Kampus Daerah Tasikmalaya. All rights reserved.</small>
          </div>
        </div>
      </div>

      <footer className="login-footer">
        <span>Unit Manajemen Pengelolaan Aset &amp; Fasilitas (UMPER) Kampus Tasikmalaya</span>
        <nav aria-label="Tautan footer">
          <a href="#guide">Panduan Sistem</a>
          <span aria-hidden="true">•</span>
          <a href="#privacy">Kebijakan Privasi</a>
          <span aria-hidden="true">•</span>
          <a href="#status">Status Server</a>
        </nav>
      </footer>
    </section>
  );
}
