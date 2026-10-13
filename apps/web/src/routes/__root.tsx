// Root route: layout + error boundary + not-found (Task 2, step 19).
// The error component shows a generic, accessible message with a retry link
// and never leaks stacks to the client. Full UX lands in later phases.
import type { ReactNode } from 'react';
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
// Global stylesheet (Task D-1): Tailwind v4 theme + base layer. Imported here
// so TanStack Start applies it to SSR + dev + build output alike.
import '../styles.css';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'SILAPOR — Smart Campus Maintenance',
      },
    ],
  }),
  component: RootComponent,
  errorComponent: RootError,
  notFoundComponent: RootNotFound,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="id">
      <head>
        <HeadContent />
      </head>
      <body>
        <a href="#main">Lewati ke konten utama</a>
        <main id="main">{children}</main>
        <Scripts />
      </body>
    </html>
  );
}

function RootError({ reset }: { error: unknown; reset: () => void }) {
  return (
    <RootDocument>
      <section role="alert" aria-labelledby="root-error-title">
        <h1 id="root-error-title">Terjadi kesalahan</h1>
        <p>Maaf, halaman tidak dapat dimuat. Silakan coba lagi.</p>
        <p>
          <button type="button" onClick={reset}>
            Muat ulang halaman
          </button>{' '}
          <a href="/">Kembali ke beranda</a>
        </p>
      </section>
    </RootDocument>
  );
}

function RootNotFound() {
  return (
    <RootDocument>
      <section aria-labelledby="root-not-found-title">
        <h1 id="root-not-found-title">Halaman tidak ditemukan (404)</h1>
        <p>Alamat yang diminta tidak tersedia.</p>
        <p>
          <a href="/">Kembali ke beranda</a>
        </p>
      </section>
    </RootDocument>
  );
}
