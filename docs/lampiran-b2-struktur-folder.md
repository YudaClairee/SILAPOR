# Lampiran B.2. Struktur Folder Source Code

## B.2.1 Ruang Lingkup dan Notasi

Lampiran ini menjelaskan organisasi berkas dan modul pada repositori SILAPOR. Isinya mencakup direktori `apps/`, `packages/`, `infra/`, serta berkas konfigurasi pada tingkat akar repositori.

Beberapa direktori tidak ditampilkan karena dihasilkan otomatis atau bersifat lokal:

| Direktori | Alasan tidak ditampilkan |
|---|---|
| `node_modules/` | Hasil pemasangan dependency |
| `dist/`, `.output/` | Hasil build |
| `.tanstack/`, `routeTree.gen.ts` | Hasil generate TanStack Router |
| `test-results/` | Artefak Playwright |
| `.data/` | Data lokal worker dan lampiran |
| `pnpm-lock.yaml` | Lockfile, ditampilkan sebagai satu berkas |

Notasi pohon memakai karakter `├──` dan `└──`. Nama direktori diakhiri garis miring. Data pada lampiran ini diambil dari repositori commit `18b7611`.

## B.2.2 Pohon Folder Tingkat Atas

```text
silapor/
├── apps/
│   ├── web/                     Aplikasi TanStack Start (halaman dan API)
│   └── worker/                  Proses Node untuk pekerjaan asinkron
├── packages/
│   ├── domain/                  Entitas dan aturan bisnis murni
│   ├── shared/                  Konfigurasi, logging, error, utilitas
│   ├── database/                Skema Drizzle, migrasi, repositori
│   ├── auth/                    Sesi, SSO, kebijakan akses, rate limit
│   ├── ai/                      Klien OpenRouter dan validasi output
│   ├── storage/                 Adapter filesystem/S3 dan pemrosesan gambar
│   ├── jobs/                    Kontrak pesan antrean
│   └── analytics/               Agregasi dashboard dan laporan
├── infra/
│   └── garage/                  Konfigurasi object storage lokal
├── docs/                        Dokumen teknis dan keputusan produk
├── .moon/                       Konfigurasi task runner
├── .github/
│   └── workflows/               Pipeline integrasi berkelanjutan
├── docker-compose.yml           PostgreSQL dan Garage
├── pnpm-workspace.yaml          Daftar workspace
├── pnpm-lock.yaml               Lockfile dependency
├── tsconfig.base.json           Konfigurasi TypeScript bersama
├── eslint.config.mjs            Aturan lint dan batas modul
├── .prettierrc.json             Aturan format kode
└── package.json                 Skrip root dan devDependency
```

## B.2.3 Penjelasan Direktori Tingkat Atas

Tabel B.2.1. Fungsi direktori tingkat atas

| Path | Isi | Alasan pemisahan |
|---|---|---|
| `apps/web/` | Halaman reporter dan admin, SSR, 35 endpoint API | Satu aplikasi untuk seluruh antarmuka dan transport HTTP |
| `apps/worker/` | Loop outbox, penulisan beat, titik masuk proses worker | Pekerjaan asinkron berjalan di proses terpisah agar tidak memperlambat request |
| `packages/domain/` | Status laporan, aturan transisi, aturan prioritas, verdict AI | Aturan bisnis tidak bergantung pada framework atau basis data |
| `packages/shared/` | Konfigurasi runtime, logging, pemetaan error, redaksi | Dipakai lapisan domain dan infrastruktur tanpa membuat siklus |
| `packages/database/` | Skema, migrasi, seed, repositori | Semua akses SQL berada di satu paket |
| `packages/auth/` | Token sesi, kebijakan akses, SSO mock, pembatas laju | Keamanan sesi diuji terpisah dari HTTP |
| `packages/ai/` | Pemanggilan OpenRouter, skema verdict | Provider AI dapat diganti tanpa mengubah alur laporan |
| `packages/storage/` | Adapter filesystem dan S3, pemrosesan gambar | Penyimpanan lampiran dapat berpindah tanpa mengubah route |
| `packages/jobs/` | Tipe pesan antrean, antrean in-memory | Kontrak antrean sama untuk worker lokal dan deployment lain |
| `packages/analytics/` | Query agregasi dashboard dan laporan maintenance | Logika agregasi tidak bercampur dengan komponen UI |
| `infra/garage/` | `garage.toml` | Konfigurasi layanan eksternal dipisahkan dari kode aplikasi |
| `docs/` | Kontrak API, keputusan produk, batas modul | Dokumentasi ikut berversi bersama kode |
| `.moon/` | `workspace.yml`, `tasks.yml`, `toolchains.yml` | Definisi task dan versi toolchain terpusat |
| `.github/workflows/` | Pipeline CI | Pemeriksaan otomatis pada setiap push dan pull request |

Berkas konfigurasi pada akar repositori memiliki peran masing-masing:

Tabel B.2.2. Berkas konfigurasi akar

| Berkas | Fungsi |
|---|---|
| `package.json` | Skrip `lint`, `typecheck`, `test`, `build`, serta versi pnpm dan Node |
| `pnpm-workspace.yaml` | Menetapkan `apps/*` dan `packages/*` sebagai workspace |
| `tsconfig.base.json` | Target ES2022, mode `strict`, `noEmit` |
| `eslint.config.mjs` | Aturan TypeScript dan larangan impor lintas lapisan |
| `.prettierrc.json` | Kutip tunggal, lebar 100, trailing comma |
| `docker-compose.yml` | Layanan PostgreSQL 16 dan Garage 2.3.0 |

## B.2.4 Struktur dan Organisasi `apps/web`

```text
apps/web/
├── e2e/
│   ├── health.spec.ts           Uji endpoint kesehatan
│   └── reports.spec.ts          Uji alur laporan
├── public/
│   └── assets/login/            Gambar halaman login
├── src/
│   ├── components/              16 berkas komponen presentasional
│   ├── lib/                     3 helper sisi klien
│   ├── routes/                  22 route halaman
│   │   ├── api/                 35 route API
│   │   ├── admin.*.tsx          Halaman admin
│   │   ├── reporter.*.tsx       Halaman reporter
│   │   ├── __root.tsx           Layout akar
│   │   ├── index.tsx            Halaman publik
│   │   ├── login.tsx            Halaman login
│   │   └── kebijakan-privasi.tsx
│   ├── server/                  14 modul logika server
│   ├── styles/                  CSS khusus halaman
│   ├── router.tsx               Konfigurasi router
│   ├── routeTree.gen.ts         Hasil generate plugin
│   ├── styles.css               Tailwind dan design token
│   └── vite-env.d.ts            Tipe lingkungan Vite
├── moon.yml                     Task `test-e2e`
├── vite.config.ts               Plugin Start, React, Tailwind
├── vitest.config.ts             Konfigurasi unit test
├── playwright.config.ts         Konfigurasi e2e
└── tsconfig.json                Konfigurasi TypeScript
```

Tabel B.2.3. Peran direktori pada `apps/web/src`

| Direktori | Isi | Aturan organisasi |
|---|---|---|
| `components/` | `AppShell`, `Button`, `Input`, `Select`, `Textarea`, `StatusBadge`, `Timeline`, `TicketMono`, `BarChart`, `AttachmentGallery`, `EmptyState`, `ErrorPanel`, `FieldError`, `LoadingState`, `formControls.ts`, dan `index.ts` | Hanya menerima props. Tidak memanggil basis data atau `fetch` langsung |
| `lib/` | `report-helpers.ts`, `admin-reports.ts`, `attachments.ts` | Helper yang dipakai klien dan server, tanpa akses `process.env` |
| `routes/` | Satu berkas per halaman atau endpoint | Berkas route tipis. Validasi dan akses data didelegasikan ke `server/` |
| `routes/api/` | Satu berkas per resource atau aksi | Setiap handler mengembalikan `Response` dan memetakan error melalui `toHttpResponse` |
| `server/` | `auth.ts`, `guard.ts`, `reports.ts`, `workflow.ts`, `attachments.ts`, `uploads.ts`, `notifications.ts`, `analytics.ts`, `facilities.ts`, `master-data.ts`, `held.ts`, `health.ts`, `services.ts`, `runtime-config.ts` | Satu-satunya lapisan yang mengakses `@silapor/database` dan `@silapor/storage` |
| `styles/` | `login.css`, `kebijakan-privasi.css` | CSS khusus halaman. Gaya global berada di `styles.css` |
| `e2e/` | Skenario Playwright | Tidak termasuk pipeline `test` default |

Pemisahan ini membuat route hanya menangani HTTP: membaca request, memanggil layanan, lalu menyusun respons. Contohnya, `routes/api/reports.ts` memanggil `requireUser`, `submitVerifiedReport`, dan `listCampusReportsRoute` dari direktori `server/`.

## B.2.5 Konvensi Penamaan Route

TanStack Router memakai nama berkas sebagai definisi URL. Titik memisahkan segmen, `$nama` menandai parameter dinamis, dan `index` menandai halaman utama suatu segmen.

Tabel B.2.4. Pemetaan berkas route ke URL

| Berkas | URL | Jenis |
|---|---|---|
| `routes/__root.tsx` | Semua halaman | Layout akar |
| `routes/index.tsx` | `/` | Halaman publik |
| `routes/login.tsx` | `/login` | Halaman login |
| `routes/admin.tsx` | `/admin` | Layout admin |
| `routes/admin.index.tsx` | `/admin` | Dashboard admin |
| `routes/admin.reports.index.tsx` | `/admin/reports` | Daftar laporan |
| `routes/admin.reports.$ticket.tsx` | `/admin/reports/:ticket` | Detail laporan |
| `routes/admin.facilities.$assetId.tsx` | `/admin/facilities/:assetId` | Detail aset |
| `routes/reporter.reports.new.tsx` | `/reporter/reports/new` | Formulir laporan baru |
| `routes/reporter.notifikasi.tsx` | `/reporter/notifikasi` | Daftar notifikasi |
| `routes/api/reports.ts` | `/api/reports` | Endpoint koleksi |
| `routes/api/reports.$id.ts` | `/api/reports/:id` | Endpoint detail |
| `routes/api/reports.$id.attachments.$attachmentId.ts` | `/api/reports/:id/attachments/:attachmentId` | Unduh lampiran |
| `routes/api/admin/reports.$id.transition.ts` | `/api/admin/reports/:id/transition` | Aksi transisi status |

Berkas uji ditempatkan berdampingan dengan berkas yang diuji, misalnya `admin.analytics.test.tsx` di samping `admin.analytics.tsx`. Pola ini membuat perubahan route dan pengujiannya berada dalam satu tinjauan.


## B.2.6 Struktur dan Organisasi `packages/`

```text
packages/
├── domain/src/
│   ├── index.ts                 Status, transisi, status fasilitas, skor prioritas
│   ├── ai-verdict.ts            Aturan verdict dan prioritas AI
│   └── *.test.ts                5 berkas uji
├── shared/src/
│   ├── config.ts                Pembacaan environment
│   ├── errors.ts                Klasifikasi dan pemetaan error
│   ├── logging.ts               Logger dan fungsi redact
│   ├── worker-beat.ts           Penanda liveness worker
│   ├── index.ts                 Barrel export
│   └── *.test.ts                2 berkas uji
├── database/src/                Lihat B.2.7
├── auth/src/
│   ├── session.ts               Token dan cookie sesi
│   ├── policy.ts                Matriks izin per peran
│   ├── rate-limit.ts            Pembatas percobaan login
│   ├── sso.ts                   Kontrak SSO dan mock provider
│   ├── index.ts                 Barrel export
│   └── *.test.ts                4 berkas uji
├── ai/src/
│   ├── verify.ts                Pemanggilan OpenRouter
│   ├── schema.ts                Skema Zod untuk verdict
│   ├── index.ts                 Barrel export
│   └── verify.test.ts           1 berkas uji
├── storage/src/
│   ├── types.ts                 Antarmuka AttachmentStorage
│   ├── filesystem.ts            Adapter filesystem
│   ├── s3.ts                    Adapter S3
│   ├── factory.ts               Pemilih adapter
│   ├── attachments.ts           Validasi dan pemrosesan gambar
│   ├── list.ts                  Daftar kunci lampiran
│   ├── index.ts                 Barrel export
│   └── *.test.ts                4 berkas uji
├── jobs/src/
│   ├── types.ts                 Kontrak QueueMessage
│   ├── memory.ts                Antrean in-memory
│   ├── index.ts                 Barrel export
│   └── memory.test.ts           1 berkas uji
└── analytics/src/
    ├── dashboard.ts             Query agregasi dashboard
    ├── time.ts                  Helper rentang waktu
    ├── index.ts                 Barrel export
    └── *.test.ts                2 berkas uji
```

Tabel B.2.5. Peran setiap paket

| Paket | Berkas utama | Tanggung jawab |
|---|---|---|
| `@silapor/domain` | `index.ts`, `ai-verdict.ts` | Daftar status laporan, tipe event, aturan transisi, aturan prioritas, verdict AI. Tidak memiliki dependency workspace |
| `@silapor/shared` | `config.ts`, `errors.ts`, `logging.ts`, `worker-beat.ts` | Konfigurasi runtime, logger, redaksi data sensitif, pemetaan error ke HTTP |
| `@silapor/database` | `schema.ts` dan repositori | Skema, migrasi, seed, seluruh query SQL |
| `@silapor/auth` | `session.ts`, `policy.ts`, `rate-limit.ts`, `sso.ts` | Sesi berbasis cookie, otorisasi per peran, pembatas login, kontrak SSO |
| `@silapor/ai` | `verify.ts`, `schema.ts` | Permintaan ke OpenRouter, validasi output dengan Zod, klasifikasi PASS, FAIL, dan DOWN |
| `@silapor/storage` | `types.ts`, `filesystem.ts`, `s3.ts`, `factory.ts`, `attachments.ts` | Port penyimpanan lampiran dengan dua implementasi dan pemrosesan gambar |
| `@silapor/jobs` | `types.ts`, `memory.ts` | Kontrak pesan antrean dan implementasi in-memory untuk pilot |
| `@silapor/analytics` | `dashboard.ts`, `time.ts` | Agregasi laporan, beban teknisi, dan tren waktu |

Setiap paket memakai `index.ts` sebagai barrel export. Berkas di luar barrel tidak diimpor langsung oleh paket lain, sehingga perubahan internal tidak merambat ke pemakai.

## B.2.7 Struktur dan Organisasi `packages/database`

```text
packages/database/
├── drizzle/
│   ├── 0000_foundation.sql              Migrasi awal
│   ├── 0001 sampai 0010_*.sql           Migrasi lanjutan
│   └── meta/                            Metadata drizzle-kit
├── src/
│   ├── schema.ts                        19 tabel dan 4 enum
│   ├── migrate.ts                       Penerap migrasi
│   ├── seed.ts                          Data awal admin dan reporter
│   ├── reports.ts                       Repositori laporan
│   ├── workflow.ts                      Transisi dan penugasan
│   ├── workflow-extra.ts                Operasi alur tambahan
│   ├── outbox-consumer.ts               Pembacaan outbox
│   ├── master-data.ts                   Lokasi, kategori, issue type
│   ├── facilities.ts                    Aset dan status fasilitas
│   ├── attachments.ts                   Metadata lampiran
│   ├── staged-uploads.ts                Unggahan bertahap
│   ├── attachment-cleanup.ts            Pembersihan lampiran yatim
│   ├── notifications.ts                 Notifikasi pengguna
│   ├── sessions.ts                      Penyimpanan sesi
│   ├── ai-analyses.ts                   Hasil analisis AI
│   └── index.ts                         Barrel export
├── drizzle.config.ts                    Dialect PostgreSQL
└── vitest.config.ts                     Konfigurasi uji
```

Tabel B.2.6. Pengelompokan berkas pada `packages/database/src`

| Kelompok | Berkas | Isi |
|---|---|---|
| Skema | `schema.ts` | Definisi tabel, enum, indeks, dan constraint |
| Migrasi | `migrate.ts`, `drizzle/*.sql` | Penerapan migrasi berurutan |
| Data awal | `seed.ts` | Upsert akun pilot |
| Laporan | `reports.ts`, `workflow.ts`, `workflow-extra.ts` | CRUD laporan, transisi status, penugasan teknisi |
| Master data | `master-data.ts`, `facilities.ts` | Lokasi, kategori, issue type, aset, teknisi |
| Lampiran | `attachments.ts`, `staged-uploads.ts`, `attachment-cleanup.ts` | Metadata, unggahan bertahap, pembersihan |
| Asinkron | `outbox-consumer.ts`, `notifications.ts` | Outbox dan notifikasi |
| Identitas | `sessions.ts` | Hash token dan masa berlaku |
| AI | `ai-analyses.ts` | Verdict, confidence, alasan |


## B.2.8 Aturan Dependensi Antar Modul

Arah dependensi ditetapkan satu arah: aplikasi bergantung pada paket, paket infrastruktur bergantung pada domain, dan domain bergantung pada tidak ada paket workspace.

Tabel B.2.7. Matriks ketergantungan

| Modul | Boleh mengimpor | Dilarang mengimpor |
|---|---|---|
| `packages/domain` | Tidak ada paket workspace | `@silapor/database`, `@silapor/storage`, `@silapor/jobs`, `@silapor/ai`, TanStack, Drizzle, Cloudflare, OpenRouter |
| `packages/shared` | Tidak ada paket workspace | Seluruh paket lain |
| `packages/database` | `domain`, `shared` | `apps/*`, `@silapor/web` |
| `packages/auth` | `domain`, `shared` | `@silapor/database` |
| `packages/ai` | `domain`, `shared` (Zod) | `@silapor/database`, `@silapor/storage` |
| `packages/storage` | `shared` | `@silapor/database` |
| `packages/jobs` | `shared` | `@silapor/database` |
| `packages/analytics` | `domain`, `shared`, `database` | `apps/*` |
| `apps/web` | Seluruh paket workspace | Tidak ada larangan khusus |
| `apps/worker` | `jobs`, `shared`, `database` | `apps/web` |

Aturan ini ditegakkan oleh ESLint melalui `no-restricted-imports` pada `eslint.config.mjs`. Aturan tersebut memeriksa nama paket dan jalur relatif, sehingga impor seperti `../../packages/database/src/schema` juga ditolak. Alasannya, aturan bisnis harus dapat diuji tanpa basis data, dan penggantian penyimpanan atau provider AI tidak boleh menyentuh domain.

## B.2.9 Konvensi Penamaan Berkas

Tabel B.2.8. Konvensi penamaan

| Pola | Contoh | Keterangan |
|---|---|---|
| `kebab-case.ts` | `rate-limit.ts`, `master-data.ts` | Modul TypeScript |
| `PascalCase.tsx` | `StatusBadge.tsx`, `AttachmentGallery.tsx` | Komponen React |
| `*.test.ts` | `policy.test.ts` | Uji unit, diletakkan di samping modul |
| `*.spec.ts` | `health.spec.ts` | Uji end-to-end di `apps/web/e2e` |
| `index.ts` | `packages/ai/src/index.ts` | Barrel export paket |
| `moon.yml` | `packages/auth/moon.yml` | Metadata proyek Moon |
| `NNNN_nama.sql` | `0009_progress_note_condition.sql` | Migrasi berurutan |
| `$param` | `reports.$id.ts` | Segmen dinamis pada route |
| `*.gen.ts` | `routeTree.gen.ts` | Berkas hasil generate, tidak disunting manual |

## B.2.10 Ringkasan Jumlah Berkas

Tabel B.2.9. Jumlah berkas sumber dan uji per modul

| Modul | Berkas sumber | Berkas uji |
|---|---:|---:|
| `apps/web` | 96 | 24 |
| `apps/worker` | 2 | 1 |
| `packages/domain` | 2 | 5 |
| `packages/shared` | 5 | 2 |
| `packages/database` | 16 | 13 |
| `packages/auth` | 5 | 4 |
| `packages/ai` | 3 | 1 |
| `packages/storage` | 7 | 4 |
| `packages/jobs` | 3 | 1 |
| `packages/analytics` | 3 | 2 |
| **Total** | **142** | **57** |

Angka pada tabel dihitung dari berkas di dalam `src/` dan tidak memasukkan direktori `node_modules`. Berkas `routeTree.gen.ts` termasuk dalam hitungan `apps/web` karena ikut disimpan di repositori, meskipun dihasilkan oleh plugin.

## B.2.11 Cara Mereproduksi Daftar Berkas

Struktur pada lampiran ini dapat diperiksa ulang dengan perintah berikut:

```bash
# Daftar proyek yang dikenali Moon
pnpm exec moon query projects

# Pohon direktori tanpa dependency dan artefak build
find apps packages infra -type d \
  -not -path '*/node_modules*' \
  -not -path '*/dist*' \
  -not -path '*/.tanstack*' \
  -not -path '*/test-results*' \
  | sort

# Jumlah berkas sumber dan uji per paket
for d in apps/web apps/worker packages/*; do
  printf '%-24s %s %s\n' "$d" \
    "$(find "$d/src" -type f ! -name '*.test.*' 2>/dev/null | wc -l)" \
    "$(find "$d/src" -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) 2>/dev/null | wc -l)"
done
```

Jika lampiran diserahkan dalam bentuk cetak, pohon folder sebaiknya dipotong pada kedalaman tiga tingkat dan sisanya dijelaskan melalui Tabel B.2.1 sampai Tabel B.2.6. Daftar berkas lengkap dapat disertakan sebagai berkas digital terpisah atau tautan repositori.

