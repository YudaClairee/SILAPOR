# Lampiran B.5. Pengujian Awal

## B.5.1 Tujuan dan Waktu Pelaksanaan

Pengujian awal dilakukan untuk memastikan alur utama SILAPOR berjalan sebelum prototipe didemonstrasikan. Pengujian mencakup aturan domain, komponen antarmuka, layanan server, integrasi basis data, dan pemeriksaan statis kode.

Pengujian dijalankan pada 20 Oktober 2026 pada commit `18b7611`, dengan lingkungan lokal:

| Komponen | Nilai |
|---|---|
| Sistem operasi | Linux pada WSL 2 |
| Node.js | 24.18.0 |
| pnpm | 11.21.0 |
| Test runner | Vitest 5.0.3 |
| Uji browser | Playwright 1.64.0 dengan Chromium |
| Basis data | PostgreSQL 16, tidak aktif saat pemeriksaan |
| Object storage | Garage 2.3.0, tidak aktif saat pemeriksaan |

Pada pemeriksaan ini PostgreSQL dan Garage tidak aktif, dan Docker tidak dapat dijalankan pada lingkungan WSL 2. Karena itu uji integrasi basis data dan uji end-to-end belum dapat diselesaikan. Status kedua jenis pengujian dijelaskan terpisah pada B.5.5 dan B.5.6 agar hasil uji unit tidak tercampur dengan pengujian yang belum berjalan.

## B.5.2 Lingkup Pengujian

Tabel B.5.1. Jenis pengujian dan cakupannya

| Jenis | Cakupan | Alat | Status pelaksanaan |
|---|---|---|---|
| Uji unit domain | Status laporan, transisi, prioritas, verdict AI, status fasilitas | Vitest | Dijalankan |
| Uji unit pustaka | Sesi, kebijakan akses, pembatas login, storage, antrean, analytics, AI | Vitest | Dijalankan |
| Uji komponen | Komponen antarmuka dan route React | Vitest dan Testing Library | Dijalankan |
| Uji layanan server | Penanganan laporan, workflow, unggahan, notifikasi | Vitest | Dijalankan |
| Uji integrasi basis data | Query dan transaksi pada PostgreSQL | Vitest | Dilewati, layanan tidak aktif |
| Uji end-to-end | Alur reporter dan admin pada peramban | Playwright | Tersedia, belum dijalankan pada pemeriksaan ini |
| Pemeriksaan statis | Lint, typecheck, dan build | ESLint, TypeScript, Vite | Dijalankan |
| Integrasi berkelanjutan | Seluruh pipeline pada setiap push | GitHub Actions | Tersedia |

## B.5.3 Hasil Uji Otomatis

Perintah yang dipakai:

```bash
pnpm exec moon run :test
```

Tabel B.5.2. Hasil uji per paket

| Paket | Berkas uji | Lulus | Dilewati |
|---|---:|---:|---:|
| `apps/web` | 24 | 282 | 0 |
| `packages/database` | 13 | 209 | 1 |
| `packages/domain` | 5 | 60 | 0 |
| `packages/storage` | 4 | 53 | 2 |
| `packages/auth` | 4 | 43 | 0 |
| `packages/analytics` | 2 | 22 | 0 |
| `packages/ai` | 1 | 20 | 0 |
| `packages/shared` | 2 | 5 | 0 |
| `apps/worker` | 1 | 3 | 0 |
| `packages/jobs` | 1 | 2 | 0 |
| **Total** | **57** | **699** | **3** |

Pipeline berakhir dengan kode keluar 0. Tidak ada uji yang gagal. Tiga uji yang dilewati memerlukan layanan eksternal dan dijelaskan pada B.5.6.

## B.5.4 Hasil Pemeriksaan Statis dan Build

Perintah yang dipakai:

```bash
pnpm exec moon run :lint :typecheck :build
```

Tabel B.5.3. Hasil pemeriksaan statis

| Pemeriksaan | Alat | Hasil |
|---|---|---|
| Lint 10 proyek | ESLint 9 dengan typescript-eslint 8 | Lulus |
| Pemeriksaan tipe 10 proyek | TypeScript 5.9.3 dengan mode `strict` | Lulus |
| Build 10 proyek | Vite 8 untuk web, skrip stub untuk paket | Lulus |
| Total task | Moonrepo | 30 task selesai, kode keluar 0 |

Lint juga memeriksa aturan batas modul. Impor dari `packages/domain` ke `@silapor/database`, Drizzle, TanStack, Cloudflare, atau OpenRouter akan menggagalkan pemeriksaan. Dengan demikian, hasil lint sekaligus menjadi bukti bahwa pemisahan modul pada Lampiran B.2 dipatuhi.

Build untuk paket non-web masih berupa skrip stub tanpa keluaran, karena paket dikonsumsi langsung sebagai TypeScript melalui `main: ./src/index.ts`. Build yang menghasilkan berkas adalah `apps/web` melalui Vite.


## B.5.5 Skenario End-to-End

Suite Playwright memuat sepuluh skenario. Seluruh berkas berada pada `apps/web/e2e`.

Tabel B.5.4. Skenario end-to-end yang tersedia

| No | Skenario | Berkas | Cakupan |
|---:|---|---|---|
| 1 | Endpoint kesehatan menjawab 200 dengan `service: web` | `health.spec.ts` | Ketersediaan layanan |
| 2 | Reporter mengirim laporan dan menerima nomor tiket | `reports.spec.ts` | Alur submit |
| 3 | Reporter melihat tiket pada daftar dengan status `REPORTED` | `reports.spec.ts` | Daftar dan detail |
| 4 | Reporter lain membuka tiket dalam bentuk tersanitasi | `reports.spec.ts` | Visibilitas kampus |
| 5 | Admin melihat tiket dan deskripsi yang sama | `reports.spec.ts` | Konsistensi lintas peran |
| 6 | Reporter ditolak saat memanggil API admin | `reports.spec.ts` | Otorisasi 403 |
| 7 | Submit ganda menghasilkan tepat satu tiket | `reports.spec.ts` | Idempotency |
| 8 | Duplikasi diblokir dengan referensi tiket aktif | `reports.spec.ts` | Deteksi duplikasi |
| 9 | Worker offline membuat gerbang rilis tertahan | `reports.spec.ts` | Ketahanan saat worker mati |
| 10 | Unggah lampiran, pratinjau, dan placeholder gambar rusak | `reports.spec.ts` | Lampiran |

Kesepuluh skenario belum diselesaikan pada pemeriksaan 20 Oktober 2026. Uji ini memerlukan PostgreSQL aktif, data seed, dan server pengembangan. Pada lingkungan pemeriksaan, Docker tidak dapat dijalankan dan proses server pengembangan tidak selesai dalam batas waktu yang tersedia. Perintah yang disiapkan:

```bash
docker compose up -d
pnpm --filter @silapor/database run db:migrate
pnpm --filter @silapor/database run db:seed
pnpm --filter @silapor/web run test:e2e
```

## B.5.6 Uji Integrasi yang Dilewati

Uji integrasi memakai penanda `describe.skipIf` dan `it.skipIf`. Tanpa layanan pendukung, uji tersebut tidak dijalankan dan tidak dihitung sebagai kegagalan.

Tabel B.5.5. Uji integrasi dan syaratnya

| Berkas | Layanan yang dibutuhkan | Perilaku tanpa layanan |
|---|---|---|
| `database/src/db.integration.test.ts` | PostgreSQL melalui `DATABASE_URL` | Dilewati |
| `database/src/facilities.test.ts` | PostgreSQL | Suite dilewati |
| `database/src/outbox-consumer.test.ts` | PostgreSQL | Suite dilewati |
| `database/src/attachments.test.ts` | PostgreSQL | Suite dilewati |
| `database/src/reports-schema.test.ts` | PostgreSQL | Suite dilewati |
| `database/src/ai-analyses.test.ts` | PostgreSQL | Suite dilewati |
| `database/src/reports.test.ts` | PostgreSQL | Dua suite dilewati |
| `database/src/notifications.test.ts` | PostgreSQL | Dua suite dilewati |
| `database/src/workflow.test.ts` | PostgreSQL | Suite dilewati |
| `database/src/workflow-extra.test.ts` | PostgreSQL | Suite dilewati |
| `database/src/staged-uploads.test.ts` | PostgreSQL | Suite dilewati |
| `storage/src/s3.test.ts` | Garage melalui `STORAGE_ENDPOINT` | Satu uji dilewati |
| `storage/src/list.test.ts` | Garage | Satu uji dilewati |

Pada ringkasan Vitest, dua uji storage dan satu uji database tercatat sebagai skipped. Selebihnya berada di dalam suite yang ditandai `describe.skipIf` sehingga tidak dikoleksi sebagai uji berjalan. Ketika `DATABASE_URL` dan `STORAGE_ENDPOINT` tersedia, seluruh uji tersebut berjalan tanpa perubahan kode.


## B.5.7 Temuan dan Tindak Lanjut

Tabel B.5.6. Ringkasan temuan

| No | Temuan | Dampak | Tindak lanjut |
|---:|---|---|---|
| 1 | 57 berkas uji menghasilkan 699 uji lulus tanpa kegagalan | Aturan domain, layanan server, dan komponen antarmuka terverifikasi | Dipertahankan pada setiap perubahan |
| 2 | Lint, typecheck, dan build selesai dengan kode keluar 0 | Batas modul dan tipe terjaga | Dijalankan pada CI |
| 3 | Uji integrasi basis data belum dijalankan | Query dan transaksi belum diverifikasi pada pemeriksaan ini | Jalankan PostgreSQL, migrasi, lalu uji dengan `DATABASE_URL` |
| 4 | Uji end-to-end belum diselesaikan | Alur peramban belum diverifikasi pada pemeriksaan ini | Jalankan setelah basis data dan seed tersedia |
| 5 | Pengukuran cakupan kode belum dikonfigurasi | Tidak ada angka persentase cakupan | Tambahkan penyedia coverage bila angka diperlukan |
| 6 | Tiga antarmuka masih memakai data contoh | Fitur tersebut belum diuji sebagai fitur hidup | Hubungkan endpoint sesuai Lampiran B.3 |

Temuan nomor 3 dan 4 bukan kegagalan perangkat lunak, melainkan keterbatasan lingkungan pemeriksaan. Keduanya perlu diselesaikan sebelum demo agar hasil pengujian mencakup seluruh lapisan.

## B.5.8 Kesimpulan

Pengujian awal sudah dilakukan pada tingkat unit, komponen, layanan server, dan pemeriksaan statis. Hasilnya, 699 uji lulus, tidak ada uji gagal, dan 3 uji dilewati karena memerlukan layanan eksternal. Lint, typecheck, dan build juga selesai tanpa kesalahan.

Pengujian integrasi basis data dan pengujian end-to-end belum diselesaikan karena PostgreSQL, Garage, dan Docker tidak tersedia pada lingkungan pemeriksaan. Dengan demikian, klaim yang dapat diajukan pada proposal adalah:

1. aturan bisnis, layanan server, dan komponen antarmuka telah terverifikasi secara otomatis,
2. jalur SQL dan alur peramban menunggu pengujian pada lingkungan dengan layanan aktif,
3. seluruh perangkat uji sudah tersedia dan tidak memerlukan perubahan kode untuk dijalankan.

## B.5.9 Bukti dan Cara Reproduksi

Keluaran perintah disimpan pada repositori:

| Berkas | Isi | Ukuran |
|---|---|---:|
| `docs/bukti/2026-10-20-moon-test.txt` | Keluaran `moon run :test` | 21 KB |
| `docs/bukti/2026-10-20-moon-static.txt` | Keluaran `moon run :lint :typecheck :build` | 24 KB |

Perintah untuk mengulang pengujian:

```bash
pnpm install
pnpm exec moon run :test
pnpm exec moon run :lint :typecheck :build
```

Untuk menguji lapisan integrasi dan peramban:

```bash
docker compose up -d
pnpm --filter @silapor/database run db:migrate
pnpm --filter @silapor/database run db:seed

DATABASE_URL=postgres://silapor:silapor@localhost:5432/silapor \
  pnpm --filter @silapor/database run test

pnpm --filter @silapor/web run test:e2e
```

## B.5.10 Batasan Pengujian

Tabel B.5.7. Aspek yang belum diuji

| Aspek | Status | Alasan |
|---|---|---|
| Uji beban dan performa | Belum | Belum ada target waktu respons dan jumlah pengguna yang disepakati |
| Uji penetrasi keamanan | Belum | Di luar lingkup pilot, baru diperiksa melalui lint dan uji otorisasi |
| Uji kompatibilitas lintas peramban | Sebagian | Lingkungan pemeriksaan hanya memasang Chromium |
| Uji aksesibilitas formal | Belum | Baru berupa pemeriksaan atribut ARIA pada komponen |
| Pengukuran cakupan kode | Belum | Penyedia coverage belum dipasang pada proyek |
| Uji perangkat mobile fisik | Belum | Antarmuka web menyesuaikan ukuran layar, belum diuji pada perangkat nyata |
| Uji penerimaan pengguna | Belum | Menunggu pengguna dari UMPER dan reporter |

Batasan ini dicantumkan agar hasil pengujian tidak ditafsirkan melebihi apa yang benar-benar dijalankan.

## B.5.11 Ringkasan untuk Bab Pembahasan

Paragraf berikut dapat dipakai pada bab hasil dan pembahasan:

> Pengujian awal dilakukan pada 20 Oktober 2026 terhadap commit `18b7611`. Sebanyak 57 berkas uji menghasilkan 699 uji lulus dan 3 uji dilewati, tanpa kegagalan. Pemeriksaan lint, typecheck, dan build pada 10 proyek juga selesai dengan kode keluar 0. Uji integrasi PostgreSQL dan uji end-to-end Playwright belum diselesaikan karena layanan pendukung tidak aktif pada lingkungan pemeriksaan. Perangkat uji untuk kedua lapisan tersebut sudah tersedia dan dapat dijalankan setelah PostgreSQL dan Garage aktif.

