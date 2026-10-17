import type { ReactNode } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import '../styles/kebijakan-privasi.css';

export const Route = createFileRoute('/kebijakan-privasi')({
  component: KebijakanPrivasiPage,
});

const COLLECTED_DATA: ReadonlyArray<{ readonly label: string; readonly detail: string }> = [
  {
    label: 'Identitas Akun',
    detail:
      'Username atau identitas akun pelapor (Mahasiswa, Dosen, Tenaga Kependidikan, atau Staf).',
  },
  {
    label: 'Lokasi & Aset Fasilitas',
    detail: 'Penunjukan gedung, lantai, ruangan, serta identifikasi aset yang dilaporkan rusak.',
  },
  {
    label: 'Deskripsi Kerusakan',
    detail: 'Keterangan naratif yang diketikkan pelapor terkait rincian kendala fasilitas fisik.',
  },
  {
    label: 'Foto Bukti Fisik',
    detail: 'Dokumentasi gambar kondisi fasilitas yang diunggah secara langsung oleh pelapor.',
  },
  {
    label: 'Riwayat Progres Tiket',
    detail:
      'Pencatatan stempel waktu dan pergantian status sejak tiket dibuat hingga selesai ditangani.',
  },
];

const USAGE_POINTS: ReadonlyArray<{ readonly title: string; readonly detail: string }> = [
  {
    title: 'Verifikasi Kelayakan',
    detail:
      'Memeriksa keabsahan dan urgensi laporan kerusakan yang masuk agar terhindar dari pelaporan ganda atau fiktif.',
  },
  {
    title: 'Koordinasi Perbaikan',
    detail:
      'Memfasilitasi Unit Manajemen Perlengkapan & Pemeliharaan (UMPER) serta teknisi lapangan dalam mengalokasikan tindakan perbaikan.',
  },
  {
    title: 'Transparansi Penanganan',
    detail: 'Menyajikan status penyelesaian secara berkala langsung pada linimasa akun pelapor.',
  },
];

const AI_PRINCIPLES: ReadonlyArray<{ readonly title: string; readonly detail: ReactNode }> = [
  {
    title: 'Data yang Dikirim',
    detail:
      'Hanya mencakup berkas foto bukti kerusakan dan teks deskripsi fisik yang Anda tuliskan.',
  },
  {
    title: 'Data yang TIDAK Dikirim',
    detail: (
      <>
        Sistem <em>tidak pernah</em> meneruskan identitas pelapor, seperti nama lengkap, username,
        NIM, maupun NIP ke layanan model AI.
      </>
    ),
  },
  {
    title: 'Tujuan Pemrosesan',
    detail:
      'AI semata-mata membantu penaksiran awal kelayakan kerusakan serta pengelompokan klasifikasi kategori fasilitas secara otomatis.',
  },
];

function KebijakanPrivasiPage() {
  return (
    <div className="policy-page">
      <header className="policy-header">
        <div className="policy-brand">
          <img
            src="/assets/login/upi-tasikmalaya.png"
            alt="Logo UPI Kampus Tasikmalaya"
            width={36}
            height={36}
          />
          <div className="policy-brand-text">
            <strong>UPI KAMPUS TASIKMALAYA</strong>
            <span>SMART CAMPUS MAINTENANCE SYSTEM</span>
          </div>
        </div>
        <span className="policy-pill">
          <span className="policy-dot" aria-hidden="true" />
          Portal Layanan Terpadu
        </span>
      </header>

      <main className="policy-main">
        <div className="policy-toolbar">
          <Link to="/login" className="policy-back">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Kembali ke Halaman Masuk
          </Link>
          <button
            type="button"
            className="policy-shield"
            aria-label="Salin tautan halaman"
            onClick={() => {
              void navigator.clipboard?.writeText(window.location.href);
            }}
          >
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
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </button>
        </div>

        <p className="policy-eyebrow">DOKUMEN KEBIJAKAN PRIVASI · UMPER UPI KAMPUS TASIKMALAYA</p>
        <h1 className="policy-title">Kebijakan Privasi</h1>
        <p className="policy-meta">
          Pembaruan Terakhir: Januari 2025 · UPI Kampus Tasikmalaya · Berlaku untuk Pelapor &amp;
          Sivitas Akademika
        </p>

        <blockquote className="policy-callout">
          Kebijakan ini menjelaskan bagaimana data dan informasi diproses saat Anda menyampaikan
          laporan kerusakan fasilitas di lingkungan Universitas Pendidikan Indonesia Kampus
          Tasikmalaya melalui Smart Campus Maintenance System (SCMS).
        </blockquote>

        <hr className="policy-rule" />

        <section className="policy-section" aria-labelledby="policy-01">
          <header className="policy-section-head">
            <span className="policy-index" aria-hidden="true">
              01
            </span>
            <div>
              <h2 id="policy-01">Data yang Dikumpulkan</h2>
              <p className="policy-section-sub">
                Komponen data yang dicatat untuk penanganan laporan fasilitas
              </p>
            </div>
          </header>
          <p className="policy-lede">
            Untuk memproses serta menindaklanjuti perbaikan secara tepat sasaran, sistem mencatat
            beberapa komponen data saat pembuatan laporan:
          </p>
          <dl className="policy-table">
            {COLLECTED_DATA.map((row) => (
              <div className="policy-row" key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="policy-section" aria-labelledby="policy-02">
          <header className="policy-section-head">
            <span className="policy-index" aria-hidden="true">
              02
            </span>
            <div>
              <h2 id="policy-02">Penggunaan Data</h2>
              <p className="policy-section-sub">
                Tujuan pemanfaatan informasi laporan dalam lingkup kampus
              </p>
            </div>
          </header>
          <p className="policy-lede">
            Data yang dihimpun hanya dimanfaatkan dalam lingkup penataan dan pemeliharaan sarana
            kampus dengan tujuan:
          </p>
          <ol className="policy-ordered">
            {USAGE_POINTS.map((point, index) => (
              <li key={point.title}>
                <span className="policy-ordered-num" aria-hidden="true">
                  {index + 1}.
                </span>
                <p>
                  <strong>{point.title}:</strong> {point.detail}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="policy-section" aria-labelledby="policy-03">
          <header className="policy-section-head">
            <span className="policy-index" aria-hidden="true">
              03
            </span>
            <div>
              <h2 id="policy-03">Pemrosesan dengan AI</h2>
              <p className="policy-section-sub">
                Batasan ketat privasi dan perlindungan identitas sivitas
              </p>
            </div>
          </header>
          <p className="policy-lede">
            SCMS memanfaatkan modul kecerdasan buatan (Artificial Intelligence) untuk mempercepat
            kategorisasi laporan kerusakan awal. Pemrosesan dilakukan dengan batasan ketat demi
            privasi sivitas:
          </p>
          <div className="policy-panel">
            <p className="policy-panel-title">Prinsip Minimasi Data ke Layanan AI</p>
            <dl>
              {AI_PRINCIPLES.map((item) => (
                <div className="policy-panel-row" key={item.title}>
                  <dt>{item.title}:</dt>
                  <dd>{item.detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="policy-section" aria-labelledby="policy-04">
          <header className="policy-section-head">
            <span className="policy-index" aria-hidden="true">
              04
            </span>
            <div>
              <h2 id="policy-04">Riwayat Laporan &amp; Akuntabilitas</h2>
              <p className="policy-section-sub">
                Transparansi audit trail dan alur perbaikan kampus
              </p>
            </div>
          </header>
          <p className="policy-lede">
            Setiap tiket pelaporan beserta pergantian statusnya dicatat secara berurutan dan
            kronologis di dalam basis data sistem SCMS.
          </p>
          <p className="policy-lede">
            Pencatatan berjenjang ini bertujuan untuk memastikan setiap tahapan perbaikan fasilitas
            memiliki alur yang dapat ditelusuri dengan jelas, transparan, serta dapat
            dipertanggungjawabkan kepada seluruh sivitas akademika UPI Kampus Tasikmalaya.
          </p>
        </section>

        <hr className="policy-rule" />

        <div className="policy-contact">
          <div>
            <p className="policy-contact-label">Ada pertanyaan seputar alur pemeliharaan?</p>
            <a className="policy-contact-link" href="mailto:umper@upi.edu">
              Hubungi Unit Pengelolaan &amp; Pemeliharaan Sarana Prasarana (UMPER) →
            </a>
          </div>
          <Link to="/login" className="policy-back policy-back-plain">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Kembali ke Halaman Masuk
          </Link>
        </div>
      </main>

      <footer className="policy-footer">
        <span>© 2025 Universitas Pendidikan Indonesia. Seluruh hak cipta dilindungi.</span>
        <span>SCMS v1.0 · UMPER UPI Kampus Tasikmalaya</span>
      </footer>
    </div>
  );
}
