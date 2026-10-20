# Lampiran A. Spesifikasi Teknologi SILAPOR

## A.1 Ruang Lingkup

Lampiran ini mencatat bahasa pemrograman, framework, basis data, pustaka, dan perangkat yang digunakan pada prototipe SILAPOR (Smart Campus Maintenance System). Seluruh versi diambil dari berkas konfigurasi pada repositori, yaitu `package.json`, `pnpm-lock.yaml`, `.moon/toolchains.yml`, `docker-compose.yml`, dan `packages/database/drizzle.config.ts`.

Lampiran ini melengkapi bab perancangan sistem. Isinya menjelaskan teknologi yang benar-benar dipakai pada kode, bukan daftar teknologi yang direncanakan.

## A.2 Arsitektur Ringkas

SILAPOR dibangun sebagai **modular monolith** di dalam satu repositori. Antarmuka reporter, antarmuka admin, SSR, dan endpoint API berada pada satu aplikasi web. Proses worker dipisahkan hanya untuk pekerjaan asinkron, dan memakai source code, aturan domain, serta skema basis data yang sama.

```text
        Reporter / Admin (browser)
                   |
                   | HTTP
                   v
    +--------------------------------------+
    | apps/web                             |
    | TanStack Start + React 19 (SSR)      |
    |  - halaman  : src/routes/*.tsx       |
    |  - REST API : src/routes/api/*       |
    +------+---------------+---------------+
           |               |               |
           v               v               v
   PostgreSQL 16      Garage (S3)     OpenRouter API
   Drizzle ORM        sharp           verifikasi AI
           ^
           | tabel outbox_events
    +------+-------------------------------+
    | apps/worker (Node.js, tsx)           |
    | notifikasi dan pekerjaan asinkron    |
    +--------------------------------------+
```

Pembagian paket pada repositori:

| Paket | Tanggung jawab |
|---|---|
| `apps/web` | Halaman reporter dan admin, SSR, endpoint API |
| `apps/worker` | Konsumen antrean, pemrosesan outbox, penulisan beat |
| `packages/domain` | Entitas, aturan transisi status, aturan prioritas, kontrak use case |
| `packages/shared` | Konfigurasi runtime, logging, pemetaan error, redaksi data sensitif |
| `packages/database` | Skema Drizzle, migrasi, seed, repositori |
| `packages/auth` | Sesi, kontrak SSO, kebijakan akses, pembatas laju login |
| `packages/ai` | Pemanggilan OpenRouter dan validasi output |
| `packages/storage` | Adapter penyimpanan filesystem dan S3, pemrosesan gambar |
| `packages/jobs` | Kontrak pesan antrean dan antrean in-memory |
| `packages/analytics` | Agregasi dashboard dan laporan maintenance |

## A.3 Tumpukan Teknologi Utama

Tabel A.1. Teknologi utama dan perannya

| Lapisan | Teknologi | Versi | Peran dalam sistem |
|---|---|---|---|
| Bahasa pemrograman | TypeScript | 5.9.3 | Seluruh kode aplikasi, dengan mode `strict` |
| Runtime | Node.js | 24.18.0 | Menjalankan web, worker, skrip migrasi, dan seed |
| Manajer paket | pnpm workspaces | 11.21.0 | Mengelola monorepo `apps/*` dan `packages/*` |
| Orkestrasi task | Moonrepo | 2.2.1 | Menjalankan `lint`, `typecheck`, `build`, `test` dengan cache |
| Framework web | TanStack Start | 1.168.61 | SSR, server route, integrasi Vite |
| Routing | TanStack Router | 1.170.42 | Routing berbasis berkas dan bertipe |
| Pustaka UI | React + React DOM | 19.3.0 | Komponen antarmuka reporter dan admin |
| Bundler | Vite | 8.3.4 | Server pengembangan dan build produksi |
| Styling | Tailwind CSS + `@tailwindcss/vite` | 4.3.3 | Utility CSS dan design token |
| Basis data | PostgreSQL | 16 (image resmi) | Data transaksional, audit, dan agregasi |
| Driver basis data | postgres.js (`postgres`) | 3.4.9 | Koneksi dan connection pool |
| ORM | Drizzle ORM | 0.45.4 | Query bertipe dan pemetaan skema |
| Migrasi | drizzle-kit | 0.31.11 | Generate dan apply migrasi SQL |
| Penyimpanan objek | Garage (S3 compatible) | 2.3.0 | Penyimpanan lampiran foto |
| Verifikasi AI | OpenRouter Chat Completions | API v1 | Verifikasi laporan saat submit |
| Worker | Node.js + tsx | 4.23.15 | Menjalankan TypeScript tanpa langkah build |
| CI | GitHub Actions | workflow | Lint, typecheck, build, dan test otomatis |

## A.4 Pustaka dan Perangkat Pendukung

Tabel A.2. Pustaka pendukung

| Pustaka | Versi | Fungsi |
|---|---|---|
| `zod` | 4.6.5 | Validasi skema output AI dan kontrak data |
| `@aws-sdk/client-s3` | 3.1150.0 | Klien S3 untuk adapter Garage |
| `sharp` | 0.34.5 | Validasi, resize, dan kompresi gambar lampiran |
| `@fontsource/ibm-plex-sans` | 5.3.0 | Font antarmuka, disajikan dari aplikasi |
| `@fontsource/ibm-plex-mono` | 5.3.0 | Font monospace untuk nomor tiket |
| `vitest` | 5.0.3 | Pengujian unit per paket |
| `@testing-library/react` | 16.3.3 | Pengujian komponen React |
| `@testing-library/jest-dom` | 7.0.1 | Matcher tambahan untuk DOM |
| `jsdom` | 30.1.2 | Lingkungan DOM untuk pengujian route |
| `@playwright/test` | 1.64.0 | Pengujian end-to-end |
| `eslint` + `typescript-eslint` | 9.x + 8.x | Analisis statis dan penegakan batas modul |
| `prettier` | 3.x | Format kode |

## A.5 Alasan Pemilihan Teknologi

**TypeScript dan monorepo.** Satu bahasa untuk web, worker, dan library. Tipe yang sama dipakai pada kontrak API, pesan antrean, dan skema basis data. pnpm memisahkan paket berdasarkan tanggung jawab, sedangkan Moonrepo menjalankan task berdasarkan graf dependensi sehingga `build` dan `test` hanya dijalankan pada paket yang berubah.

**TanStack Start dan React.** Aplikasi membutuhkan SSR, endpoint API, dan satu basis kode untuk reporter serta admin. TanStack Start menyediakan ketiganya di atas Vite, dengan routing berbasis berkas dan pemeriksaan tipe pada setiap route. Next.js tidak dipilih karena pemisahan server dan klien menambah lapisan konfigurasi yang tidak diperlukan pada skala pilot, sedangkan Express atau NestJS akan memisahkan frontend dan backend menjadi dua aplikasi.

**PostgreSQL dan Drizzle ORM.** Alur laporan melibatkan relasi antar entitas, transaksi, constraint, dan agregasi untuk analytics. PostgreSQL menangani kebutuhan tersebut, termasuk tipe `jsonb`, `uuid`, dan enum. Drizzle dipilih karena skema didefinisikan dalam TypeScript dan tipe query diturunkan langsung dari skema, tanpa generator model terpisah seperti pada Prisma. drizzle-kit menyimpan migrasi sebagai berkas SQL yang dapat ditinjau manual.

**Sesi kustom di `packages/auth`.** Login memakai session cookie `HttpOnly` dengan token acak 32 byte, disimpan sebagai hash SHA-256 di tabel `sessions`. Pendekatan ini menjaga dependensi tetap kecil dan memberi kendali penuh atas atribut cookie, masa berlaku, serta pencabutan sesi. Better Auth atau NextAuth tidak dipakai karena keduanya membawa asumsi framework dan alur provider yang belum dibutuhkan pada pilot yang masih memakai `MockSsoProvider`.

**Garage dan sharp.** Lampiran foto disimpan melalui antarmuka `AttachmentStorage` dengan dua implementasi: filesystem untuk pengembangan dan S3 untuk produksi. Garage dipilih sebagai penyimpanan S3-compatible lokal karena citranya tersedia publik dan ringan, menggantikan MinIO yang citranya tidak lagi dapat ditarik. `sharp` menangani orientasi, ukuran maksimum, dan pembuatan checksum SHA-256 sebelum berkas disimpan.

**Worker terpisah dengan pola outbox.** Notifikasi dan pekerjaan asinkron tidak boleh menggagalkan submit laporan. Perubahan data dan penulisan `outbox_events` terjadi dalam satu transaksi, lalu worker membaca tabel tersebut. Pola ini tidak memerlukan broker tambahan seperti Redis atau RabbitMQ, dan pesan tetap dapat dipulihkan setelah proses berhenti.

**OpenRouter dengan `fetch` dan Zod.** Verifikasi berjalan sinkron pada jalur submit, sehingga hasilnya dapat langsung menentukan status tiket. Endpoint OpenRouter bersifat OpenAI-compatible, cukup dipanggil dengan `fetch` tanpa SDK tambahan. Output model divalidasi dengan Zod sebelum disimpan, dan model dipin melalui `OPENROUTER_MODEL` untuk menghindari alias yang berubah sewaktu-waktu.

**Vitest dan Playwright.** Vitest memakai konfigurasi Vite yang sama sehingga test dapat mengimpor modul TypeScript tanpa build terpisah. Playwright dipakai untuk alur browser pada endpoint kesehatan dan submit laporan.

## A.6 Ketertelusuran Kebutuhan ke Teknologi

Tabel A.3. Kebutuhan fungsional dan komponen pendukungnya

| Kebutuhan | Teknologi atau komponen | Berkas rujukan |
|---|---|---|
| Login dan kendali akses berbasis peran | Session cookie, hash SHA-256, kebijakan akses di `packages/auth` | `packages/auth/src/session.ts`, `packages/auth/src/policy.ts`, `apps/web/src/server/guard.ts` |
| Master data lokasi, kategori, issue type, aset, teknisi | Tabel relasional dan endpoint admin | `packages/database/src/schema.ts`, `apps/web/src/routes/api/admin/` |
| Submit laporan dengan 1 sampai 3 foto | Server route, adapter storage, `sharp` | `apps/web/src/routes/api/reports.ts`, `packages/storage/src/attachments.ts` |
| Nomor tiket unik | Tabel `ticket_counters` dan transaksi | `packages/database/src/schema.ts` |
| Deteksi duplikasi dan penggabungan laporan | Aturan domain dan endpoint pemeriksaan duplikat | `apps/web/src/routes/api/reports.duplicate-check.ts` |
| Verifikasi laporan dengan AI | OpenRouter dan validasi Zod | `packages/ai/src/verify.ts`, `packages/ai/src/schema.ts` |
| Penugasan teknisi, transisi status, progress, timeline | Aturan transisi dan tabel append-only | `packages/database/src/workflow.ts`, tabel `report_events` |
| Notifikasi dalam aplikasi | Tabel `notifications`, outbox, worker | `packages/database/src/notifications.ts`, `apps/worker/src/outbox-loop.ts` |
| Dashboard dan laporan maintenance | Agregasi Drizzle dan halaman admin | `packages/analytics/src/dashboard.ts`, `apps/web/src/routes/admin.analytics.tsx` |
| Jejak audit | Tabel `audit_logs` dan `report_events` | `packages/database/src/schema.ts` |
| Pemantauan kesehatan sistem | Endpoint `/api/health` dengan pemeriksaan fail-open | `apps/web/src/routes/api/health.ts` |

## A.7 Lingkungan Pengembangan dan Operasional

Tabel A.4. Kebutuhan perangkat lunak

| Komponen | Kebutuhan |
|---|---|
| Node.js | 24.18.0, disediakan melalui Moonrepo dan proto |
| pnpm | 11.21.0 |
| Docker Compose | Untuk PostgreSQL 16 dan Garage 2.3.0 |
| Peramban | Chromium, Firefox, atau WebKit untuk Playwright |
| Port lokal | 3000 (web), 5432 (PostgreSQL), 3900 (S3 API), 3903 (admin Garage) |

Tabel A.5. Variabel lingkungan utama

| Variabel | Fungsi |
|---|---|
| `DATABASE_URL` | Connection string PostgreSQL |
| `PORT` | Port server web, default 3000 |
| `STORAGE_DIR` | Direktori penyimpanan lampiran pada adapter filesystem |
| `STORAGE_ENDPOINT` | Endpoint S3 untuk adapter Garage |
| `WORKER_BEAT_FILE` | Berkas penanda liveness worker |
| `AUTH_PROVIDER` | Pemilih provider SSO, nilai pilot `mock` |
| `OPENROUTER_API_KEY` | Kunci API, hanya dibaca di sisi server |
| `OPENROUTER_MODEL` | Slug model yang dipin |
| `AI_VERIFY_TIMEOUT_MS` | Batas waktu verifikasi AI, default 10000 ms |

Perintah utama:

```bash
pnpm install
docker compose up -d
pnpm --filter @silapor/database run db:migrate
pnpm --filter @silapor/database run db:seed
pnpm exec moon run :lint :typecheck :build :test
pnpm --filter @silapor/web run dev
```

## A.8 Lisensi dan Biaya

Tabel A.6. Lisensi perangkat lunak yang digunakan

| Perangkat | Lisensi |
|---|---|
| TypeScript | Apache-2.0 |
| Node.js | MIT |
| pnpm | MIT |
| Moonrepo | MIT |
| TanStack Start dan TanStack Router | MIT |
| React dan React DOM | MIT |
| Vite | MIT |
| Tailwind CSS | MIT |
| PostgreSQL | PostgreSQL License |
| Drizzle ORM dan drizzle-kit | Apache-2.0 |
| postgres.js | Unlicense |
| Zod | MIT |
| AWS SDK for JavaScript v3 | Apache-2.0 |
| sharp | Apache-2.0 |
| Vitest dan ESLint | MIT |
| Playwright | Apache-2.0 |
| Garage | AGPL-3.0 |
| IBM Plex | SIL Open Font License 1.1 |

Seluruh komponen inti bersifat open source sehingga tidak ada biaya lisensi. Biaya operasional hanya muncul dari pemakaian OpenRouter, yang ditagih berdasarkan token dan model yang dipilih, serta dari penyediaan server bila prototipe dipindahkan dari mesin pengembangan.


## A.9 Status Implementasi dan Catatan Penyimpangan

Tabel A.7. Status komponen pada repositori

| Komponen | Status |
|---|---|
| Aplikasi web, halaman reporter, halaman admin | Tersedia |
| Endpoint API laporan, lampiran, notifikasi, analytics, kesehatan | Tersedia |
| Skema basis data 19 tabel dan 11 berkas migrasi | Tersedia |
| Layanan worker dan pemrosesan outbox | Tersedia |
| Adapter penyimpanan filesystem dan S3 | Tersedia |
| Verifikasi laporan dengan OpenRouter | Tersedia, memerlukan kunci API |
| SSO UPI | Belum, masih memakai `MockSsoProvider` |
| Cloudflare Workers, Queues, R2, Hyperdrive | Ditunda |
| Portal teknisi, aplikasi mobile, integrasi IoT | Di luar lingkup MVP |

Beberapa teknologi pada rencana awal tidak dipakai pada implementasi. Perbedaan ini dicatat agar lampiran sesuai dengan kode yang diserahkan.

Tabel A.8. Perbedaan rencana awal dan implementasi

| Rencana awal | Implementasi | Alasan |
|---|---|---|
| TanStack Query | Belum dipakai, data diambil melalui loader dan server route | Kebutuhan cache klien belum muncul pada alur yang sudah berjalan |
| TanStack Table | Belum dipakai, tabel admin dibuat dengan komponen sendiri | Jumlah kolom dan interaksi masih terbatas |
| Better Auth | Sesi kustom di `packages/auth` | Menghindari dependensi framework tambahan |
| Cloudflare Workers, Queues, R2, Hyperdrive | Node.js, PostgreSQL, Garage | Deployment pilot masih lokal |
| MinIO | Garage | Citra MinIO tidak lagi tersedia untuk penarikan publik |
| pg-boss | Tabel `outbox_events` dan worker Node | Tidak memerlukan layanan tambahan |

## A.10 Cara Memeriksa Kembali

Versi pada Tabel A.1 dan Tabel A.2 dapat diverifikasi dengan perintah berikut:

```bash
cat package.json
cat apps/web/package.json
cat packages/database/package.json
grep -E "^  (react|vite|drizzle-orm)@" pnpm-lock.yaml
cat .moon/toolchains.yml
cat docker-compose.yml
```

