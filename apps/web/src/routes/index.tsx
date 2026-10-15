import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <div>
      <h1>SILAPOR — Smart Campus Maintenance</h1>
      <p>Portal pelaporan perawatan kampus (placeholder Task 2).</p>

      <section aria-labelledby="state-loading">
        <h2 id="state-loading">Memuat</h2>
        <p role="status">Memuat data laporan…</p>
      </section>

      <section aria-labelledby="state-empty">
        <h2 id="state-empty">Belum ada laporan</h2>
        <p>Belum ada laporan perawatan. Buat laporan pertama Anda.</p>
      </section>

      <section aria-labelledby="state-error">
        <h2 id="state-error">Gagal memuat</h2>
        <p role="alert">
          Data tidak dapat dimuat. <a href="/">Coba lagi</a>.
        </p>
      </section>

      <section aria-labelledby="state-forbidden">
        <h2 id="state-forbidden">Akses ditolak (403)</h2>
        <p>Anda tidak memiliki izin untuk melihat halaman ini.</p>
      </section>

      <section aria-labelledby="state-success">
        <h2 id="state-success">Laporan terkirim</h2>
        <p role="status">Laporan berhasil dibuat. Nomor tiket akan tampil di sini.</p>
      </section>
    </div>
  );
}
