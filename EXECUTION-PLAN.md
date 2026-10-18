# Execution Plan — Smart Campus Maintenance System

> **Relasi dokumen:** PRD (`Tugas-Tugas Semester 7.md`) menjelaskan kebutuhan produk; `docs/decisions/PHASE-0-PRODUCT-DECISIONS.md` adalah catatan keputusan Phase 0 (status: draft; approval final mengikuti dokumen tersebut); dokumen ini mengonsolidasikan keduanya dan menjadi **sumber kebenaran eksekusi** untuk keputusan produk/UI/alur. Nilai yang masih `TBD` pada Phase 0 belum boleh diperlakukan sebagai keputusan final.
>
> **Status dokumen (2026-10-17):** dokumen ini adalah **satu-satunya sumber kebenaran** untuk keputusan produk, UI, dan alur. `docs/api-contract.md` hanya mengikat untuk **No. 4, 9, 12**; untuk **No. 2, 3, 5, 6, 7, 8, 10, 11** dokumen ini dan Konsep Desain UI yang menang. Setiap bagian kontrak yang bertentangan dengan dokumen ini dianggap **superseded** dan tidak boleh dipakai sebagai acuan implementasi.
>
> **Keputusan UI vs Backend (`konsep_ui_vs_backend.pdf`, item 2–12):**
> - No. 2 verifikasi otomatis oleh AI saat submit; admin tidak melakukan verifikasi manual dan tidak mengubah hasil AI. **Pengecualian operasional satu-satunya:** laporan yang ditahan sebagai `REPORTED` saat layanan AI down diverifikasi manual oleh admin (lihat §2, §4.11, dan §8).
> - No. 3 form reporter: Gedung → Lantai → Ruangan → Aset (semua wajib), tanpa input Kategori & Jenis Masalah (diisi otomatis oleh AI).
> - No. 4 upload mengikuti backend: wajib **1–3 file/laporan**, maks 5 MB/file.
> - No. 5 reporter dapat melihat seluruh tiket kampus (dengan filter "Laporan Saya"), identitas pelapor lain disembunyikan.
> - No. 6 status fasilitas TIDAK tampil ke pelapor; hanya tampil di admin (Kelola Aset) dengan 3 status aset.
> - No. 7 duplikat dicek otomatis saat submit (diblokir jika pelapor sama, otomatis digabung jika pelapor beda); hanya 7 status tiket (tanpa `REJECTED`/`DUPLICATE`).
> - No. 8 status satu arah mutlak `REPORTED` s.d. `CLOSED`, tanpa reopen/mundur.
> - No. 9 assign teknisi hanya `technicianId` (tanpa Jadwal/Instruksi), mengikuti backend.
> - No. 10 semua catatan tampil ke pelapor, kecuali label "Laporan Palsu" yang diproyeksikan menjadi teks netral untuk pelapor; tanpa pilihan `PUBLIC`/`INTERNAL`.
> - No. 11 halaman admin **Dashboard Admin** (kartu ringkasan metrik, antrean prioritas, panel tugas aktif per teknisi), **Pengaturan Scoring**, dan **Laporan Maintenance** (3 grafik: tren laporan & rata-rata durasi, beban tugas per teknisi, tiket per kategori & gedung; tabel per periode) + **Ekspor PDF** tetap digambar penuh di UI; endpoint menyusul.
> - No. 12 wajib menangani `409 CONFLICT` (`expectedVersion`) dengan pesan "Tiket diperbarui admin lain — muat ulang data" + tombol Refresh.

## 1. Tujuan Dokumen

Dokumen ini menerjemahkan PRD **Smart Campus Maintenance System UPI Kampus Tasikmalaya** menjadi panduan implementasi MVP yang dapat dieksekusi secara bertahap.

Execution plan ini berfokus pada:

1. membangun alur maintenance yang lengkap dari laporan sampai penutupan;
2. memastikan reporter memperoleh transparansi progres;
3. memastikan admin dapat mengelola laporan, fasilitas, teknisi, dan histori;
4. menyediakan analytics operasional yang konsisten;
5. menempatkan AI sebagai **verifikator penentu** (bukan decision support): AI memeriksa foto dan kecocokan deskripsi, menetapkan klasifikasi dan prioritas final;
6. menghasilkan prototype yang aman, dapat diuji, dan dapat dikembangkan lebih lanjut.

---

## 2. Ringkasan Produk yang Akan Dibangun

Sistem memiliki dua area utama:

- **Reporter portal** untuk membuat laporan kerusakan, mengunggah foto, memperoleh ticket ID, melacak progres, menerima notifikasi, dan melihat tiket kampus tersanitasi.
- **Admin portal** untuk mengelola laporan (termasuk verifikasi HELD saat AI down), menetapkan klasifikasi dan prioritas final melalui AI, menugaskan teknisi, memperbarui status/progres, mengelola master data fasilitas, serta melihat histori dan analytics.

AI berjalan **sinkron di momen submit** dan **menentukan hasil verifikasi secara otomatis** (Keputusan UI No. 2 + desain `docs/superpowers/specs/2026-10-14-ai-verification-design.md`):

- reporter menunggu verdict saat submit; minimal 1 foto wajib (maksimal 3, maks 5 MB/file);
- validasi foto (buram/gelap/tidak relevan → ditolak di tempat) dan kecocokan deskripsi dengan aset terpilih;
- jika lolos, tiket otomatis berstatus `VERIFIED` beserta klasifikasi dan prioritas final dari master data;
- jika tidak lolos, **tidak ada baris laporan tersimpan dan tidak ada ticket terpakai**; laporan ditolak di tempat dengan alasan dan perbaikan berarti mengisi laporan baru;
- jika layanan AI down (timeout/5xx/429), laporan **disimpan dan ditahan** sebagai `REPORTED` belum terverifikasi + ticket diterbitkan; penahanan berakhir hanya lewat **verifikasi manual admin** (satu-satunya pengecualian operasional);
- **admin tidak melakukan verifikasi manual dan tidak dapat mengubah hasil AI** saat AI berjalan. Verifikasi manual hanya berlaku untuk laporan HELD saat AI down.

> Catatan konflik: `docs/api-contract.md` hanya mengikat untuk No. 4, 9, 12. Bagian kontrak tentang verifikasi manual umum, `PUBLIC`/`INTERNAL`, status fasilitas publik, duplikat manual, dan `REPORTED_ISSUE` **tidak dipakai** karena bertentangan dengan dokumen ini.

```mermaid
flowchart TD
    A[Reporter submit: aset + deskripsi + foto] --> B[AI verifikasi sinkron saat submit]
    B -->|Lolos| V[Tiket VERIFIED + klasifikasi & prioritas final AI]
    B -->|Tidak lolos| R[Ditolak di tempat + alasan; isi laporan baru]
    B -->|AI down| H[Disimpan DITAHAN sebagai REPORTED + ticket]
    H --> M[Admin verifikasi manual]
    M --> V
    V --> H2[Admin menugaskan teknisi]
    H2 --> I[Inspeksi dan perbaikan]
    I --> J[Progress update]
    J --> K[RESOLVED]
    K --> L[CLOSED]
    L --> M2[Histori dan analytics]
```

---

## 3. Prinsip Implementasi

1. **Core workflow bertahan saat AI down lewat penahanan + verifikasi manual.** Laporan disimpan sebagai `REPORTED` ditahan + ticket; penahanan hanya berakhir oleh verifikasi manual admin. Tidak ada submit yang sukses tanpa verifikasi (AI atau manual).
2. **Authorization diterapkan di server.** Menyembunyikan tombol pada UI tidak cukup.
3. **Timeline dan audit bersifat append-only.** Histori tidak boleh hilang saat nilai terbaru berubah.
4. **State transition eksplisit.** Status tidak boleh diubah secara bebas tanpa validasi aturan transisi.
5. **Hasil AI adalah keputusan final verifikasi (Keputusan UI No. 2).** Tidak ada pemisahan saran-vs-final; admin tidak override hasil AI; satu-satunya verifikasi manual adalah laporan yang ditahan saat AI down (pengecualian operasional yang wajib ditandai di UI/admin).
6. **Status fasilitas diturunkan dari laporan aktif.** Hindari dua sumber kebenaran yang dapat tidak sinkron.
7. **Gunakan master data terstruktur.** Lokasi, kategori, issue type, fasilitas, dan teknisi tidak dibuat sebagai free text pada setiap laporan.
8. **Mulai dari vertical slice.** Selesaikan satu alur reporter–admin end-to-end sebelum menambah analytics dan AI.
9. **MVP tetap modular.** Gunakan modular monolith, bukan microservices, tetapi pisahkan domain dan integrasi eksternal melalui interface.
10. **Setiap phase memiliki release gate.** Phase berikutnya dimulai setelah acceptance criteria phase sebelumnya terpenuhi.

---

## 4. Register Keputusan Produk dan Baseline Sementara

PRD sudah menjelaskan tujuan dan fitur. Keputusan final dicatat pada `docs/decisions/PHASE-0-PRODUCT-DECISIONS.md`; bagian di bawah ini menjelaskan keputusan yang sudah ada dan baseline sementara untuk hal yang masih menunggu approval.

### 4.1 Authentication dan provisioning akun

Keputusan Phase 0 (pilot lokal, 2026-10-10):

- seluruh environment memakai `MockSsoProvider`; integrasi `UpiSsoProvider` ditunda;
- guard penolakan `AUTH_PROVIDER=mock` di production dinonaktifkan selama pilot;
- provider mengembalikan identity terverifikasi (termasuk NIM bila tersedia), role, dan status akun aktif;
- role hanya `REPORTER` dan `ADMIN`;
- tidak ada public self-registration atau password lokal sebagai pengganti SSO;
- session cookie dan authorization server-side tetap wajib;
- pilot production wajib akses terbatas; migrasi ke SSO UPI sebelum dibuka publik.

Detail dan status approval tetap mengikuti decision register.

### 4.2 Lifecycle dan transisi status

PRD mendefinisikan:

`REPORTED → VERIFIED → ASSIGNED → INSPECTION → IN_REPAIR → RESOLVED → CLOSED`

Namun contoh end-to-end melewati `INSPECTION`. Keputusan ini harus dibuat eksplisit.

**Rekomendasi canonical workflow:**

| Current status | Allowed next status | Syarat minimum |
|---|---|---|
| `REPORTED` | `VERIFIED` | Lolos AI auto-verifikasi saat submit (Keputusan UI No. 2); atau verifikasi admin untuk laporan HELD saat AI down (pengecualian operasional) |
| `VERIFIED` | `ASSIGNED` | AI telah menetapkan kategori, issue type, asset/lokasi, dan priority final |
| `ASSIGNED` | `INSPECTION` | Teknisi aktif sudah ditugaskan |
| `INSPECTION` | `IN_REPAIR` | Admin mencatat hasil inspeksi |
| `IN_REPAIR` | `RESOLVED` | Admin menambahkan resolution note |
| `RESOLVED` | `CLOSED` | Tiket ditutup admin (tanpa reopen — Keputusan UI No. 8) |
| `CLOSED` | — | Terminal |

Catatan (Keputusan UI No. 2 + No. 7 + No. 8):

- Hanya 7 status; `REJECTED`/`DUPLICATE` **tidak dipakai** (digantikan tolak-otomatis-AI + auto-gabung supporting).
- Satu arah mutlak; tidak ada `RESOLVED → IN_REPAIR` / reopen.
- `RESOLVED` = perbaikan selesai; `CLOSED` = arsip final oleh admin.

### 4.3 Duplicate report

Sistem mencegah laporan berulang **secara otomatis saat submit** (Keputusan UI No. 7).

Bedakan dua mekanisme:

- **Idempotency:** `idempotencyKey` mencegah double-click atau retry request membuat ticket kedua.
- **Duplicate detection:** sistem mencari laporan aktif yang kemungkinan merujuk pada insiden yang sama.

Kriteria wajib kandidat duplikat:

- asset atau lokasi yang sama;
- laporan sebelumnya masih aktif;
- berada dalam jendela waktu yang dikonfigurasi, dengan lookback default 14 hari untuk efisiensi pencarian.

Identitas reporter/NIM terverifikasi **menentukan aksi**, bukan syarat kandidat: reporter sama → blokir; reporter beda → auto-gabung supporting.

Sinyal pendukung (bukan syarat): kategori/issue type tiket sebelumnya (final) dan/atau kategori aset, **jika sudah tersedia**. Duplicate check berjalan deterministik **sebelum AI**, jadi tidak boleh bergantung pada klasifikasi AI tiket baru yang belum ada. Deskripsi juga hanya sinyal pendukung.

Lookback tidak boleh mencegah deteksi jika laporan aktif yang memenuhi kriteria ditemukan di luar jangka tersebut.

Jika kandidat ditemukan: **pelapor SAMA → submit DIBLOKIR** (tampilkan referensi ticket aktif); **pelapor BERBEDA → OTOMATIS digabung sebagai laporan pendukung** (`report_relations` `SUPPORTING`) tanpa pekerjaan ganda dan tanpa aksi manual admin. Tidak ada status `DUPLICATE`/`REJECTED`. Laporan `CLOSED` tidak menghalangi laporan baru.

Laporan pelapor berbeda otomatis menjadi supporting dalam 1 tiket; submission asal dipertahankan untuk audit dan hitung reporter terdampak.

Aturan ini harus menggunakan `reporter_id` yang terhubung ke akun/NIM terverifikasi, bukan NIM yang diketik bebas pada deskripsi laporan.

### 4.4 Priority

> **Status:** dimensi dan safety rule sudah diputuskan pada Phase 0; angka bobot dan ambang di bawah adalah baseline provisional untuk spike/test. Jangan dipromosikan menjadi aturan operasional sebelum disetujui UMPER/admin.

Gunakan enum:

- `LOW`
- `MEDIUM`
- `HIGH`

Tidak ada level `CRITICAL`.

Simpan secara terpisah:

- `priorityScore` deterministik beserta snapshot faktor (`priorityFactors`) sebagai audit;
- `finalPriority` yang ditetapkan AI (verifikasi manual admin pada laporan ditahan mengisi field yang sama);
- `priorityDecidedBy` (`AI` atau admin penahan) dan `priorityDecidedAt`;
- `scoringConfigVersion`.

UMPER/admin menentukan rubric dan bobot pada Phase 0. **AI menghitung skor deterministik + menetapkan `finalPriority` otomatis saat submit** (Keputusan UI No. 2); admin tidak override.

Gunakan skor 0–100 (empat dimensi, sesuai keputusan `docs/decisions/PHASE-0-PRODUCT-DECISIONS.md` §5, arahan 2026-10-10 — menggantikan rubric tiga dimensi awal):

| Komponen | Bobot maksimum | Penentu |
|---|---:|---|
| Bobot kategori aset | 35 | Master data kategori oleh admin |
| Bobot aset/fasilitas | 25 | Master data fasilitas oleh admin |
| Bobot lokasi (frekuensi kuliah) | 25 | Master data lokasi; tier provisional sampai jadwal resmi tersedia |
| Bobot frekuensi pelapor | 15 | Jumlah reporter **berbeda** pada insiden yang sama (hanya laporan aktif) |

`score = kategori + aset + lokasi + frekuensi` (integer 0–100).

Bobot frekuensi menghitung **affected reporters** (reporter berbeda), bukan submission mentah: submission terblokir tidak dihitung; status `CLOSED` tidak dihitung; laporan pendukung (`SUPPORTING`/`RELATED`) dari reporter berbeda ikut dihitung sebagai indikator dampak tanpa membuat pekerjaan perbaikan baru. Tier provisional:

| Reporter berbeda (aktif) | Bonus frekuensi |
|---:|---:|
| 1 | 0 |
| 2 | 5 |
| 3–4 | 10 |
| ≥5 | 15 |

Skor dihitung sebagai snapshot saat verifikasi dan tersimpan di `priority_factors`; laporan baru tidak mengubah skor tiket lama tanpa keputusan admin.

Pemetaan skor (baseline provisional):

| Skor | Priority |
|---:|---|
| 0–39 | `LOW` |
| 40–69 | `MEDIUM` |
| 70–100 | `HIGH` |

Bobot belum tersedia memakai default median skala baru (kategori 17, aset 12, lokasi 12, frekuensi 0) dengan flag `scoringComplete = false`; snapshot deterministik tetap disimpan sebagai audit, `finalPriority` tetap milik AI (atau admin penahan saat AI down). Perubahan konfigurasi bobot/ambang menaikkan `scoringConfigVersion` dan hanya berlaku untuk laporan baru; laporan lama tidak dihitung ulang.

Aturan minimum (diputuskan):

- issue type `DANGEROUS` menghasilkan minimal `HIGH`;
- admin **tidak** mengubah hasil AI (Keputusan UI No. 2); `priorityDecidedBy=AI`.

Contoh rubric awal:

| Priority | Indikasi |
|---|---|
| `HIGH` | Menghambat kegiatan pada ruang/fasilitas penting dan perlu ditangani segera, atau berpotensi membahayakan |
| `MEDIUM` | Mengganggu penggunaan tetapi masih tersedia workaround |
| `LOW` | Kerusakan minor atau kosmetik tanpa dampak operasional langsung |

### 4.5 Asset dan lokasi

**Keputusan definitif (Keputusan UI No. 3):**

- reporter wajib memilih **Gedung → Lantai → Ruangan → Aset** (semua wajib);
- reporter **tidak mengisi Kategori & Jenis Masalah** (diisi otomatis AI);
- lokasi/asset dari master data; tanpa input `occurred_at`.

### 4.6 Facility status

Status fasilitas **tidak tampil ke pelapor; hanya di admin (Kelola Aset) dengan 3 status** (Keputusan UI No. 6):

| Kondisi laporan aktif | Status aset (admin) |
|---|---|
| Tidak ada laporan aktif | `OPERATIONAL` |
| Ada laporan `ASSIGNED` atau `INSPECTION` | `UNDER_INSPECTION` |
| Ada laporan `IN_REPAIR` | `IN_REPAIR` |

Precedence: `IN_REPAIR` > `UNDER_INSPECTION` > `OPERATIONAL`. Tanpa `REPORTED_ISSUE`; tanpa endpoint publik `GET /api/facilities/status`.

### 4.7 Progress update dan visibilitas

Semua catatan tampil ke pelapor, **kecuali kondisi "Laporan Palsu"** (Keputusan UI No. 10): admin melihat `LAPORAN_PALSU`, pelapor melihat teks netral "Kerusakan tidak ditemukan saat pemeriksaan". Tanpa pilihan `PUBLIC`/`INTERNAL` per catatan. Append-only.

### 4.8 Assignment teknisi

**Rekomendasi MVP:**

- satu teknisi aktif pada satu waktu untuk setiap tiket;
- reassignment diperbolehkan dan historinya disimpan;
- teknisi tidak mempunyai akun;
- semua tindakan pada sistem tetap tercatat dilakukan oleh admin;
- form assign hanya `technicianId` tanpa Jadwal/Instruksi (Keputusan API No. 9); **nama teknisi disembunyikan dari pelapor**.

### 4.9 Kebijakan upload

Kebijakan berikut sudah dicatat sebagai keputusan Phase 0 dan menjadi baseline MVP:

MVP hanya menerima gambar, bukan video.

Baseline:

- format: JPEG, PNG, WebP;
- maksimal 5 MB per file;
- wajib 1–3 file per laporan; maksimal 5 MB per file (Api Contract No. 4);
- SVG, executable, dan file dengan MIME palsu ditolak;
- validasi extension, MIME, dan magic bytes;
- gambar di-decode/re-encode dan metadata EXIF dihapus;
- file disimpan di private object storage;
- akses menggunakan endpoint berotorisasi atau signed URL berumur pendek;
- tentukan masa retensi file bersama pihak kampus.

### 4.10 Notifikasi

Walaupun tidak tertulis eksplisit dalam daftar MVP, contoh end-to-end membutuhkan notifikasi. Masukkan **in-app notification** ke MVP untuk event:

- laporan diverifikasi;
- teknisi ditugaskan;
- status berubah;
- catatan progres ditambahkan (termasuk kondisi Laporan Palsu yang diproyeksikan netral);
- laporan diselesaikan atau ditutup.

Email dan WhatsApp tetap di luar scope.

### 4.11 Batas AI MVP

Scope ini mengikuti desain yang disetujui (`docs/superpowers/specs/2026-10-14-ai-verification-design.md`): AI adalah verifikator penentu saat submit, bukan decision support.

MVP mencakup:

- verdict validitas laporan dari foto + kecocokan deskripsi terhadap aset (lolos → `VERIFIED`, gagal → ditolak di tempat dengan alasan);
- penetapan kategori dan issue type final dari master data (hanya dari daftar yang ada; deskripsi yang menunjuk ke kategori berbeda dari kategori master aset = gagal `wrong-asset`, bukan rekode diam-diam);
- penetapan `finalPriority` + snapshot skor deterministik sebagai audit;
- auto-gabung supporting untuk pelapor berbeda (UI No. 7);
- penahanan + verifikasi manual admin hanya saat layanan AI down; ini **pengecualian operasional**, bukan verifikasi manual umum dan bukan override hasil AI.

Tidak ada agent loop, memory, RAG, tool calling, summary otomatis, atau autonomous action. AI tidak membuat summary laporan dan tidak mengonfirmasi duplikat sebagai keputusan terpisah (duplikat bersifat deterministik dari reporter/aset/status).

Historical AI insight ditunda sampai data mencukupi. Analytics deterministik tetap dibuat sejak MVP. Jika demo memerlukan insight, gunakan data seed yang jelas dan tampilkan sebagai indikator deskriptif, bukan prediksi.

---

## 5. Scope MVP dan Prioritas

### 5.1 P0 — Wajib agar alur utama selesai

- login dan RBAC;
- master data lokasi, kategori, issue type, asset, dan teknisi;
- reporter submit report;
- upload gambar aman;
- ticket ID unik;
- daftar dan detail laporan milik reporter + tiket kampus tersanitasi dengan filter "Laporan Saya" (UI No. 5);
- admin daftar/detail seluruh laporan;
- idempotency dan duplicate detection **otomatis** (Keputusan UI No. 7) berdasarkan asset/lokasi, status aktif, dan jendela waktu; identitas reporter/NIM menentukan blokir vs auto-gabung; kategori/issue type tiket sebelumnya hanya sinyal pendukung;
- laporan pendukung otomatis digabung tanpa aksi manual admin (Keputusan UI No. 7) ke ticket utama tanpa menghapus submission asal;
- verifikasi **otomatis AI** tanpa aksi manual admin (Keputusan UI No. 2); pengecualian: laporan HELD saat AI down;
- final category/issue type/priority + score **otomatis oleh AI** (Keputusan UI No. 2);
- technician assignment;
- state transition;
- progress update dan timeline;
- maintenance history per asset;
- status aset admin-only; **tanpa** status fasilitas publik (Keputusan UI No. 6);
- audit trail dasar.

### 5.2 P1 — Wajib untuk memenuhi value proposition MVP

- admin dashboard (kartu ringkasan metrik, antrean prioritas, panel tugas aktif per teknisi);
- filter, search, sorting, dan pagination;
- in-app notification;
- analytics jumlah laporan berdasarkan kategori, lokasi, dan status;
- resolution time;
- AI verification verdicts dan priority final otomatis (Keputusan UI No. 2);
- Pengaturan Scoring (UI digambar penuh; endpoint menyusul, Keputusan UI No. 11);
- concurrency protection + banner 409 + Refresh (Keputusan API No. 12);
- export sederhana; Laporan Maintenance (3 grafik: tren laporan & rata-rata durasi, beban tugas per teknisi, tiket per kategori & gedung; tabel per periode) + Ekspor PDF digambar penuh di UI, endpoint menyusul (Keputusan UI No. 11).

### 5.3 P2 — Dikerjakan jika waktu memungkinkan

- duplicate handling UX lanjutan dan similarity matching yang lebih nyaman;
- ~~reopen flow DIHAPUS~~ (satu arah; UI No. 8);
- saved filters;
- CSV export;
- basic historical insight dengan threshold minimal lima laporan;
- dashboard trend tambahan di luar tiga grafik wajib No. 11.

### 5.4 Tetap di luar scope MVP

- akun/portal teknisi;
- native mobile app;
- IoT dan real-time sensor;
- predictive maintenance ML;
- image damage classification;
- automatic scheduling;
- WhatsApp bot;
- autonomous AI action;
- integrasi penuh sistem akademik UPI;
- advanced SLA engine.

---

## 6. Rekomendasi Arsitektur Teknis

Baseline teknis yang direkomendasikan adalah **TanStack Start fullstack modular monolith dalam satu monorepo**. Reporter UI, admin UI, SSR, server functions, server routes, authentication, authorization, dan application services berada pada aplikasi TanStack Start yang sama. Verifikasi AI berjalan sinkron di server-side submit path; proses worker terpisah hanya menangani notifikasi dan pekerjaan asynchronous, tetapi tetap menggunakan source code, domain rules, schema, dan repository yang sama. Profil deployment masih menunggu pengesahan Phase 0.

Pemisahan worker adalah batas operasional untuk pekerjaan asynchronous, bukan pemisahan repository frontend dan backend.

### 6.1 Baseline stack

| Layer | Rekomendasi | Alasan |
|---|---|---|
| Fullstack web | TanStack Start + TypeScript | Satu aplikasi untuk React UI, SSR, server functions, dan server/API routes |
| Routing/data | TanStack Router + TanStack Query | Type-safe routing, loaders, cache, dan server/client data flow |
| Data table | TanStack Table | Cocok untuk filter, sorting, dan pagination admin |
| UI | React, Tailwind CSS, accessible component primitives | Cepat untuk prototype dan tetap konsisten |
| Database | PostgreSQL | Cocok untuk transaksi, relasi, audit, filter, dan analytics |
| ORM/migration | Drizzle ORM + Drizzle Kit | Type-safe, ringan, dan didukung pada Node maupun Cloudflare Workers melalui PostgreSQL |
| Authentication | Session-based auth; Better Auth dapat digunakan setelah compatibility spike | Cocok untuk web app, secure cookie, dan kontrol role |
| Validation | Zod shared client/server | Satu kontrak untuk form, server function, queue message, dan output AI |
| Monorepo package manager | pnpm workspaces | Instalasi dependency dan deklarasi hubungan antar workspace package |
| Monorepo task orchestration | Moonrepo | Project graph, task dependency, affected task execution, dan caching untuk task deterministik |
| Image storage | Cloudflare Images dengan signed delivery, atau private R2; MinIO local | Direct upload, private delivery, dan adapter storage yang dapat diganti |
| Background job | Cloudflare Queues pada deployment Cloudflare; PostgreSQL outbox/`pg-boss` pada VPS | Notifikasi dan pekerjaan asynchronous; verifikasi AI tetap sinkron di submit |
| AI integration | OpenRouter API melalui raw `fetch` + Zod | Sederhana, OpenAI-compatible, edge-friendly, dan cukup untuk verification/priority assistance MVP |
| Testing | Vitest, PostgreSQL integration test, dan Playwright | Menutup domain rule, query, authorization, dan alur browser |
| Deployment utama | Cloudflare Workers + Queues + R2 + Hyperdrive + managed PostgreSQL | Tidak memerlukan pengelolaan VPS untuk web/worker |
| Deployment alternatif | Dockerized TanStack Start + worker + PostgreSQL + MinIO/S3 | Dipakai jika kebijakan kampus atau native image processing tidak cocok dengan Workers |

`pnpm` dan Moonrepo memiliki tanggung jawab berbeda: `pnpm` tetap menjadi package manager/workspace manager, sedangkan Moonrepo (`@moonrepo/cli`) menjadi task orchestrator untuk menjalankan `lint`, `typecheck`, `test`, `build`, migration check, dan deployment validation berdasarkan project graph. Moonrepo tidak menggantikan TanStack Start, Cloudflare Queues, atau application runtime.

Hindari microservices pada MVP. Gunakan **modular monolith** dengan deployment adapter yang dapat diganti.

### 6.2 High-level architecture

```mermaid
flowchart TB
    R[Reporter Browser] --> WEB[TanStack Start Worker]
    A[Admin Browser] --> WEB
    WEB --> AUTH[Auth and Authorization]
    WEB --> APP[Application Services]
    APP --> DB[(Managed PostgreSQL)]
    APP --> R2[(Cloudflare Images or Private R2)]
    APP --> Q[Cloudflare Queue]
    Q --> WORKER[Notification Queue Consumer Worker]
    WORKER --> DB
    WEB --> OR[OpenRouter API]
    OR --> MODEL[ZDR Model Provider Endpoint]
    WEB -. Hyperdrive .-> DB
```

Pada deployment VPS, `WEB` dan `WORKER` dijalankan sebagai dua process/container dari monorepo yang sama. Queue menggunakan PostgreSQL-backed queue/outbox dan storage menggunakan MinIO atau S3-compatible storage.

### 6.3 Monorepo dan module boundary

Susun source code berdasarkan domain dan runtime boundary:

```text
apps/
  web/                         # TanStack Start fullstack application
    src/routes/                # Reporter, admin, dan server/API routes
    src/server/                # Server functions dan composition root
  worker/                      # Queue consumer / Node worker entrypoint
packages/
  domain/                      # Entity, state machine, policies, use cases
  database/                    # Drizzle schema, migration, repositories
  auth/                        # Session dan authorization policies
  storage/                     # R2/MinIO/S3 interface dan adapter
  jobs/                        # Queue message contract dan adapter
  ai/                          # OpenRouter review assistant, Zod schema, prompt, evaluation
  analytics/                   # Metric definitions dan query services
  shared/                      # Validation, config, errors, logging
```

Konfigurasi workspace dan task orchestration berada di root repository:

```text
package.json                  # root scripts dan devDependency
pnpm-workspace.yaml           # daftar workspace apps/packages
.moon/
  workspace.yml               # mapping project Moonrepo
  toolchains.yml              # versi Node dan package manager/toolchain
  tasks.yml                   # default task pipeline dan dependency
apps/*/moon.yml               # task project-specific bila diperlukan
packages/*/moon.yml           # task package-specific bila diperlukan
```

Gunakan project graph Moonrepo untuk memastikan package yang bergantung pada `domain`, `shared`, atau package infrastructure dibangun dan dites dalam urutan yang benar. Task yang menghasilkan artefak deterministik dapat di-cache; task yang mengubah database, membutuhkan secret, menjalankan deployment, atau bergantung pada service eksternal tidak boleh di-cache tanpa konfigurasi khusus.

Aturan penting:

- route, loader, atau server function memanggil application service, bukan ORM secara langsung;
- server function hanya menjadi transport boundary; domain/service layer tetap memvalidasi transition dan permission;
- package `domain` tidak bergantung pada TanStack Start, Cloudflare, OpenRouter, atau ORM;
- package `database`, `storage`, `jobs`, dan `ai` mengimplementasikan interface milik application/domain layer;
- worker Cloudflare dan worker Node menggunakan queue message contract yang sama;
- AI provider dipanggil dari server submit-report path secara sinkron dengan timeout (verifikasi adalah gerbang submit), tidak pernah dari browser;
- analytics membaca canonical/final fields, bukan raw AI suggestions;
- environment variable dibaca melalui runtime binding/config adapter, bukan dievaluasi dan dibocorkan ke client bundle.

### 6.4 Boundary OpenRouter

OpenRouter digunakan di balik interface `ReportReviewAssistant` agar gateway atau model dapat diganti tanpa mengubah workflow laporan.

```text
ReportReviewAssistant
├── MockReportReviewAssistant
└── OpenRouterReportReviewAssistant
    ├── raw fetch client
    ├── pinned model slug
    ├── privacy routing policy
    ├── Zod input/output schema
    └── versioned prompt
```

MVP menggunakan satu structured LLM request sinkron saat submit untuk menghasilkan verdict validitas (foto + kecocokan deskripsi), kategori dan issue type final dari master data, priority final, confidence, serta alasan singkat. Tidak ada agent loop, memory, RAG, tool calling, summary otomatis, atau autonomous action. Scoring service deterministik tetap berjalan dan snapshot-nya disimpan sebagai audit atas `finalPriority` AI.

Aturan integrasi:

- panggil OpenRouter hanya dari server-side submit path (web) secara sinkron; queue/outbox hanya untuk notifikasi, tidak pernah dari browser;
- simpan API key sebagai Worker secret, bukan environment variable yang masuk client bundle;
- gunakan model slug eksplisit; jangan gunakan `openrouter/auto`, alias `latest`, atau model acak pada production;
- wajib meminta routing `data_collection: "deny"` dan `zdr: true`;
- gunakan `require_parameters: true` untuk memastikan endpoint mendukung parameter structured output;
- default `allow_fallbacks: false`; jika fallback diperlukan, batasi dengan allowlist provider yang telah ditinjau;
- nonaktifkan Input & Output Logging dan OpenRouter Use of Inputs/Outputs pada account settings;
- jangan kirim identitas reporter, attachment, internal note, atau data personal teknisi;
- jangan simpan raw prompt/response pada log;
- output selalu divalidasi dengan Zod dan master data sebelum disimpan;
- hasil AI (verifikasi, category/issue type, priority) bersifat final dan langsung ditulis sebagai canonical; admin tidak override;
- sediakan mock verify assistant, feature flag (hanya untuk non-verifikasi; verifikasi wajib AI), timeout, klasifikasi error DOWN-vs-FAIL, dan fallback penahanan + verifikasi manual.

Framework agent baru dievaluasi pada fase lanjutan jika ada maintenance copilot, natural-language analytics, RAG SOP/manual, atau multi-step tool workflow.

### 6.5 Deployment portability

Application code tidak boleh mengakses binding Cloudflare secara langsung dari domain/service layer. Gunakan adapter berikut:

| Port | Cloudflare adapter | VPS/local adapter |
|---|---|---|
| Database | Drizzle + `pg` melalui Hyperdrive | Drizzle + PostgreSQL connection pool |
| Image storage | Cloudflare Images/R2 adapter | MinIO/S3 adapter |
| Queue | Cloudflare Queues | PostgreSQL outbox/`pg-boss` |
| Runtime config | Workers bindings/secrets | Environment variables |
| AI execution | Server-side submit path (web) | Node web process submit path |

Dengan boundary ini, perpindahan dari Cloudflare ke VPS tidak membutuhkan penulisan ulang domain atau UI.

---

## 7. Model Data Awal

Nama tabel dapat disesuaikan dengan konvensi stack, tetapi relasi dan tanggung jawabnya sebaiknya dipertahankan.

### 7.1 Entitas inti

#### `users`

- `id`
- `name`
- `email` atau campus identity
- `external_user_id` dari provider SSO
- `nim` terverifikasi jika tersedia
- `role`: `REPORTER | ADMIN`
- `is_active`
- `created_at`, `updated_at`, `last_login_at`

#### `locations`

- `id`
- `parent_id` untuk hierarki kampus → gedung → lantai → ruang
- `type`
- `code`
- `name`
- `is_active`

#### `facility_categories`

- `id`
- `code`
- `name`
- `description`
- `is_active`

#### `issue_types`

- `id`
- `category_id`
- `code`
- `name`
- `default_priority` opsional
- `is_active`

#### `facility_assets`

- `id`
- `asset_code` unik
- `category_id`
- `location_id`
- `name`
- bobot numerik per kategori/aset sebagai input scoring (kategori 0–35, aset 0–25, lokasi 0–25, frekuensi pelapor 0–15), tanpa enum criticality terpisah; nilai final dikalibrasi bersama UMPER/admin;
- `brand`, `model`, `serial_number` opsional
- `installed_at` atau `installed_year` opsional
- `is_active`
- `created_at`, `updated_at`

Jangan menyimpan status operasional turunan sebagai sumber kebenaran tunggal. Jika status di-cache untuk performa, cache harus dapat direkonstruksi dari laporan aktif.

#### `technicians`

- `id`
- `display_name`
- `specialty` opsional
- `is_active`
- `created_at`, `updated_at`

#### `maintenance_reports`

- `id` internal, sebaiknya UUID/ULID
- `ticket_number` unik, contoh `MNT-2026-000124`
- `reporter_id`
- `location_id`
- `asset_id` wajib saat submit; berasal dari master data
- ~~`submitted_category_id` DIHAPUS~~ (reporter tidak memilih kategori; final diisi AI)
- ~~`submitted_issue_type_id` DIHAPUS~~ (reporter tidak memilih issue type; final diisi AI)
- `final_category_id` nullable sebelum verification
- `final_issue_type_id` nullable sebelum verification
- `description`
- `occurred_at` nullable (legacy; tidak diisi reporter)
- `status`
- ~~`duplicate_of_report_id` DIHAPUS~~ (tanpa status DUPLICATE; relasi via `report_relations` SUPPORTING otomatis, UI No. 7)
- `priority_score` nullable sebelum verification; hasil perhitungan rubric deterministik
- `priority_factors` JSON nullable; snapshot faktor yang digunakan saat skor dihitung
- `final_priority` nullable sebelum verification
- `version` untuk optimistic locking
- `reported_at`
- `verified_at`, `resolved_at`, `closed_at` nullable
- `created_at`, `updated_at`

#### `report_relations`

Relasi antar-submission yang bukan duplicate otomatis:

- `id`
- `source_report_id`
- `target_report_id` sebagai ticket utama/related target
- `relation_type`: `SUPPORTING | RELATED`
- `created_by`
- `created_at`

`SUPPORTING` berarti reporter berbeda melaporkan insiden yang sama atau dampak yang sama. Submission asal tetap dipertahankan untuk audit dan jumlah reporter terdampak; sistem tidak membuat pekerjaan perbaikan baru secara otomatis.

#### `report_attachments`

- `id`
- `report_id`
- `storage_key`
- `original_filename`
- `mime_type`
- `size_bytes`
- `checksum`
- `uploaded_by`
- `created_at`

#### `report_assignments`

- `id`
- `report_id`
- `technician_id`
- `assigned_by`
- `assigned_at`
- `unassigned_at` nullable
- `reason` nullable

Assignment terbaru dengan `unassigned_at = null` adalah assignment aktif.

#### `report_updates`

- `id`
- `report_id`
- `author_id`
- `condition`: opsional `LAPORAN_PALSU` (admin asli / pelapor netral; UI No. 10); tanpa PUBLIC/INTERNAL
- `message`
- `created_at`

#### `report_events`

Append-only timeline domain:

- `id`
- `report_id`
- `event_type`
- `actor_id` nullable untuk system event
- `from_value` JSON nullable
- `to_value` JSON nullable
- `metadata` JSON nullable
- `created_at`

Event minimal:

- `REPORT_CREATED`
- `AI_ANALYSIS_COMPLETED`
- `REPORT_VERIFIED`
- `STATUS_CHANGED`
- `PRIORITY_CHANGED`
- `ASSIGNMENT_CHANGED`
- `PROGRESS_NOTE_ADDED` (termasuk kondisi LAPORAN_PALSU; UI No. 10)
- `REPORT_RESOLVED`
- `REPORT_CLOSED`

#### `ai_analyses`

- `id`
- `report_id`
- `status`: `PENDING | PROCESSING | SUCCEEDED | FAILED`
- `verification_recommendation` nullable
- `possible_duplicate` nullable
- `suggested_priority` nullable
- `risk_factors` JSON nullable
- `impact_factors` JSON nullable
- `confidence` nullable
- `reasoning_summary` nullable; bukan hidden chain-of-thought
- `gateway`, default `openrouter`
- `upstream_provider` nullable
- `model`
- `gateway_request_id` nullable
- `prompt_version`
- `schema_version`
- `privacy_mode`, contoh `ZDR`
- `input_tokens`, `output_tokens`, `estimated_cost` nullable
- `attempt_count`
- `error_code` nullable
- `created_at`, `completed_at`

Raw prompt dan raw response tidak disimpan secara default. Jika debugging sementara benar-benar diperlukan, gunakan environment non-production, data sintetis, akses terbatas, dan retention singkat.

#### `notifications`

- `id`
- `user_id`
- `type`
- `title`
- `message`
- `report_id` nullable
- `read_at` nullable
- `created_at`

#### `audit_logs`

Digunakan untuk tindakan penting di luar timeline tiket juga:

- `id`
- `actor_id`
- `action`
- `entity_type`
- `entity_id`
- `before_data` JSON nullable
- `after_data` JSON nullable
- `request_id`
- `created_at`

#### `outbox_events` / `jobs`

- `id`
- `type`
- `payload` JSON
- `status`
- `attempt_count`
- `available_at`
- `locked_at` nullable
- `last_error` nullable
- `created_at`, `processed_at` nullable

### 7.2 Index minimum

Tambahkan index pada:

- `maintenance_reports.ticket_number` unique;
- `maintenance_reports.reporter_id, reported_at`;
- `maintenance_reports.status, reported_at`;
- `maintenance_reports.final_category_id`;
- `maintenance_reports.location_id`;
- `maintenance_reports.asset_id`;
- `maintenance_reports.reporter_id, asset_id, status` untuk pencarian kandidat duplikat;
- `report_relations.target_report_id, relation_type`;
- unique relation pada `source_report_id, target_report_id, relation_type`;
- `maintenance_reports.resolved_at`;
- `report_events.report_id, created_at`;
- `report_updates.report_id, created_at`;
- `notifications.user_id, read_at, created_at`;
- `facility_assets.location_id, category_id`;
- status dan waktu pada job/outbox.

### 7.3 Ticket number

Gunakan generator atomic di database, bukan menghitung jumlah row. Format yang direkomendasikan:

`MNT-{YEAR}-{SEQUENCE}`

Contoh: `MNT-2026-000124`.

`id` internal tetap tidak ditampilkan sebagai identitas utama kepada pengguna.

---

## 8. Authorization Matrix

| Capability | Reporter | Admin |
|---|---:|---:|
| Login | Ya | Ya |
| Submit report | Ya | Opsional |
| Melihat laporan sendiri | Ya | Ya |
| Melihat seluruh tiket kampus (identitas disembunyikan; filter Laporan Saya) | Ya (UI No. 5) | Ya |
| Mengakses attachment laporan sendiri | Ya | Ya |
| Mengakses attachment reporter lain | Tidak | Ya |
| Melihat status aset (admin-only, 3 status) | **Tidak** (UI No. 6) | Ya (3 status) |
| Memverifikasi laporan manual (umum) | Tidak | **Tidak** (UI No. 2) |
| Memverifikasi laporan HELD saat AI down | Tidak | **Ya** — satu-satunya pengecualian operasional; `expectedVersion` wajib |
| Menetapkan priority final manual | Tidak | **Tidak, otomatis AI** (UI No. 2) |
| Assign/reassign teknisi | Tidak | Ya |
| Mengubah status | Tidak | Ya |
| Menambahkan catatan progres (termasuk kondisi Laporan Palsu) | Tidak | Ya (UI No. 10) |
| Mengelola asset/master data | Tidak | Ya |
| Melihat analytics admin | Tidak | Ya |
| Meninjau raw AI response/error | Tidak | Ya, jika diperlukan |

Aturan server minimum:

- reporter dapat query **seluruh tiket kampus tersanitasi** + filter Laporan Saya (UI No. 5);
- endpoint attachment selalu memeriksa ownership/role sebelum memberikan file;
- **tanpa** campus status publik (UI No. 6); proyeksi tiket kampus yang tidak memuat identitas reporter, isi deskripsi sensitif, attachment, atau internal note;
- semua mutation admin memvalidasi role dan status user aktif;
- gunakan deny-by-default jika policy tidak ditemukan.

---

## 9. Kontrak API / Application Use Cases

Detail transport dapat berupa REST route handler atau server action, tetapi use case berikut harus tersedia dan diuji terpisah dari UI.

### 9.1 Auth

- `login(credentials)`
- `logout(session)`
- `getCurrentUser(session)`

### 9.2 Reporter

- `stageReportPhotos(files)` (1–3 foto pra-submit; API No. 4)
- `createReport(input, idempotencyKey)` (Gedung-Lantai-Ruangan-Aset wajib; `photoKeys` dari staging; tanpa kategori/issue type; AI otomatis; duplikat otomatis) (UI No. 2+3+7)
- `listMyReports(filter, pagination)`
- `listCampusReports(filter, pagination)` (UI No. 5)
- `getMyReportDetail(reportId)`
- `getCampusReportDetail(reportId)` (UI No. 5)
- `getMyReportTimeline(reportId)` / `getCampusReportTimeline(reportId)` (UI No. 5+10)
- ~~`listCampusFacilityStatus` DIHAPUS~~ (UI No. 6)
- `listMyNotifications(pagination)`
- `markNotificationRead(notificationId)`

### 9.3 Admin report management

- `listAllReports(filter, search, sort, pagination)`
- `getAdminReportDetail(reportId)`
- ~~`verifyReport`/`rejectReport`/`markDuplicate`/`setFinalPriority` manual DIHAPUS (otomatis AI, UI No. 2+7)~~
- `verifyHeldReport(reportId, input, expectedVersion)` — hanya laporan HELD saat AI down; satu-satunya verifikasi manual (pengecualian operasional), `expectedVersion` wajib
- ~~`linkSupportingReport` manual DIHAPUS (auto-gabung, UI No. 7)~~
- `assignTechnician(reportId, technicianId, expectedVersion)` (hanya technicianId, API No. 9)
- `transitionReport(reportId, nextStatus, expectedVersion, note?)` satu arah 7 status, tanpa reopen (UI No. 8; API No. 12)
- `addProgressNote(reportId, condition, message, expectedVersion)` (LAPORAN_PALSU jadi netral, UI No. 10; API No. 12)

### 9.4 Master data

- CRUD/archive location;
- CRUD/archive facility category;
- CRUD/archive issue type;
- CRUD/archive facility asset;
- CRUD/archive technician;
- `listFacilityAssetsWithStatus(filter, pagination)` — admin-only; daftar aset + derived 3-state + activeReportCount (UI No. 6);
- `getFacilityMaintenanceHistory(assetId)`.

Untuk data yang sudah direferensikan laporan, gunakan archive/`is_active = false`; jangan hard-delete.

### 9.5 Analytics

- `getDashboardOverview(dateRange)`
- `getReportsByStatus(dateRange)`
- `getReportsByCategory(dateRange)`
- `getReportsByLocation(dateRange)`
- `getResolutionTimeMetrics(dateRange)`
- `getTechnicianWorkload(dateRange)` — UI No. 11; endpoint menyusul
- `getReportTrend(dateRange)` — UI No. 11; endpoint menyusul
- `getTicketsByCategoryAndBuilding(dateRange)` — UI No. 11; endpoint menyusul
- endpoint menyusul UI No. 11: scoring/report-grafik/PDF

---

## 10. Rancangan Halaman

### 10.1 Reporter portal

| Route konseptual | Fungsi |
|---|---|
| `/login` | Login |
| `/reporter` | Ringkasan laporan aktif dan notifikasi |
| `/reporter/reports/new` | Form laporan bertahap atau satu halaman sederhana |
| `/reporter/reports` | Seluruh tiket kampus + filter Laporan Saya (UI No. 5) |
| `/reporter/reports/:ticket` | Detail tersanitasi; teknisi+identitas disembunyikan; palsu jadi netral (UI No. 5+9+10) |
| ~~`/facilities/status` DIHAPUS~~ | Tanpa status publik (UI No. 6) |
| `/notifications` | Daftar notifikasi in-app |

Form laporan mengikuti urutan:

1. pilih gedung (wajib);
2. pilih lantai (wajib);
3. pilih ruangan (wajib);
4. pilih aset (wajib);
5. tulis deskripsi;
6. unggah 1–3 foto (minimal 1, maksimal 3, maks 5 MB/file; API No. 4);
7. review;
8. submit;
9. tampilkan ticket number dan link detail.

### 10.2 Admin portal

| Route konseptual | Fungsi |
|---|---|
| `/admin` | Dashboard Admin: kartu ringkasan metrik, antrean prioritas, panel tugas aktif per teknisi (UI No. 11) |
| `/admin/reports` | Tabel, search, filter, sort, pagination |
| `/admin/reports/:ticket` | Detail, hasil final AI, assignment, timeline + banner 409 (UI No. 2, API No. 12) |
| `/admin/facilities` | Daftar asset + status 3-state admin-only (UI No. 6) |
| `/admin/facilities/:asset` | Detail dan maintenance history |
| `/admin/locations` | Kelola lokasi |
| `/admin/categories` | Kelola kategori dan issue type |
| `/admin/technicians` | Kelola teknisi |
| `/admin/analytics` | Breakdown dan resolution time |
| `/admin/scoring` | **[UI No. 11, endpoint menyusul]** Pengaturan Scoring: form bobot kriteria, batas jumlah pelapor, ambang prioritas, dan tabel skor per kategori aset/ruangan |
| `/admin/maintenance-report` | **[UI No. 11, endpoint menyusul]** Laporan Maintenance: 3 grafik (tren laporan & rata-rata durasi, beban tugas per teknisi, tiket per kategori & gedung), tabel tiket per periode, dan tombol Ekspor PDF |

> Tiga halaman UI No. 11—Dashboard Admin, Pengaturan Scoring, dan Laporan Maintenance + Ekspor PDF—digambar penuh sekarang; endpoint menyusul. Jangan menunggu endpoint untuk membuat UI.

### 10.3 UX state wajib

Setiap halaman data harus mempunyai:

- loading state;
- empty state;
- validation error;
- authorization/forbidden state;
- retryable server error;
- success feedback;
- responsive layout;
- keyboard-focus yang terlihat;
- label form dan error message yang accessible.

---

## 11. Step-by-Step Implementation Plan

## Phase 0 — Product and Technical Alignment

**Tujuan:** menghilangkan keputusan ambigu sebelum schema dan workflow dikunci.

### Langkah

1. Lakukan workshop singkat dengan perwakilan UMPER/admin.
2. Validasi lifecycle nyata: apakah `INSPECTION` wajib dan siapa yang menutup laporan.
3. ~~Status REJECTED/DUPLICATE DITOLAK~~ (hanya 7 status; UI No. 7).
4. Definisikan rubric priority dan contoh kasus per level.
  - tetapkan bobot kategori 0–35, aset/fasilitas 0–25, lokasi 0–25, dan frekuensi pelapor 0–15 (baseline provisional; final dikalibrasi UMPER/admin);
  - tetapkan mapping skor `LOW`/`MEDIUM`/`HIGH` (baseline provisional 0–39/40–69/70–100) serta aturan minimum `HIGH` untuk issue `DANGEROUS`;
  - sepakati bahwa AI menetapkan skor + `finalPriority` otomatis saat submit; admin tidak override (verifikasi manual hanya untuk laporan yang ditahan saat AI down).
4a. Definisikan aturan duplicate detection: asset/lokasi, status aktif, dan jendela waktu; identitas reporter/NIM terverifikasi menentukan blokir vs auto-gabung; kategori/issue type tiket sebelumnya hanya sinyal pendukung.
4b. Duplicate detection memblokir submit pelapor SAMA (dengan referensi ticket aktif) dan auto-gabung supporting pelapor BERBEDA; rekomendasi MVP bukan sekadar peringatan.
5. Finalisasi taxonomy awal kategori dan issue type.
6. Finalisasi hierarki lokasi kampus.
7. ~~Tentukan apakah asset wajib dipilih oleh reporter~~ — sudah diputuskan: aset wajib (UI No. 3).
8. ~~Tentukan policy public/internal progress update~~ — sudah diputuskan: semua catatan tampil, tanpa PUBLIC/INTERNAL; Laporan Palsu netral (UI No. 10).
9. Tentukan data teknisi yang boleh dilihat reporter.
10. Putuskan authentication MVP dan metode provisioning akun.
11. Deployment profile pilot ditetapkan: lokal saja (VPS/Cloudflare ditunda sampai pilot selesai).
12. Jika memilih Cloudflare-first, tentukan managed PostgreSQL, konfigurasi Hyperdrive, R2, Queues, dan kebutuhan Workers Paid.
13. Jalankan technical spike TanStack Start pada Workers, Drizzle melalui Hyperdrive, upload R2/Cloudflare Images, dan raw `fetch` OpenRouter di server-side submit path.
14. Pilih serta pin model OpenRouter yang mendukung structured output dan endpoint ZDR.
15. Kunci account privacy settings, provider routing policy, model fallback policy, budget, dan aturan data yang boleh dikirim ke OpenRouter.
16. Tetapkan batas file, retensi, format gambar, dan apakah metadata stripping memakai Cloudflare Images atau image processor Node.
17. Definisikan timezone bisnis sebagai `Asia/Jakarta`; simpan timestamp dalam UTC.
18. Ubah keputusan menjadi Architecture Decision Records singkat.
19. Buat low-fidelity wireframe reporter dan admin.
20. Review wireframe menggunakan scenario end-to-end dari PRD.
21. Susun backlog P0/P1/P2 dan tetapkan pemilik tiap item.

### Deliverables

- transition matrix final;
- role and permission matrix final;
- data dictionary/taxonomy awal;
- priority rubric, bobot kategori/aset/lokasi, dan aturan duplicate detection;
- wireframe reporter dan admin;
- architecture decision records;
- acceptance criteria MVP yang disetujui;
- daftar environment dan secret yang diperlukan.

### Release gate

Coding feature tidak dimulai sebelum auth mode, lifecycle, visibility, dan data model inti disepakati.

---

## Phase 1 — Repository and Engineering Foundation

**Tujuan:** menyediakan fondasi development yang konsisten dan dapat divalidasi otomatis.

> **Catatan pilot 2026-10-10:** pilot berjalan lokal (container: app + PostgreSQL
> + MinIO). Langkah khusus Cloudflare (Wrangler, Hyperdrive, Queues, R2/Images,
> dry-run bundle) **dilewati** sampai keputusan deployment final diambil.
> Worker antrean berjalan sebagai proses Node lokal dengan kontrak queue message
> yang sama.

### Langkah

1. Inisialisasi `pnpm` workspace dengan `apps/web`, `apps/worker`, dan package domain/infrastructure.
2. Tambahkan `@moonrepo/cli` sebagai root dev dependency dan inisialisasi konfigurasi Moonrepo.
3. Daftarkan `apps/*` dan `packages/*` sebagai project Moonrepo melalui `.moon/workspace.yml`.
4. Scaffold TanStack Start pada `apps/web` menggunakan TypeScript.
5. Tambahkan Cloudflare Vite plugin dan Wrangler untuk target Cloudflare; aktifkan `nodejs_compat`.
6. Aktifkan strict type checking untuk seluruh workspace.
7. Pasang formatter, linter, import boundary rules, dan scripts standar.
8. Definisikan task Moonrepo untuk `lint`, `typecheck`, `test`, `build`, serta dependency seperti `^:build` dan `^:typecheck` bila relevan.
9. Definisikan package dependency rules agar domain tidak mengimpor framework/infrastructure.
10. Siapkan runtime config abstraction; baca Workers binding per request dan environment variable pada Node.
11. Jalankan `wrangler types` untuk menghasilkan tipe binding Cloudflare; jangan menulis tipe binding secara manual.
12. Siapkan PostgreSQL local melalui container.
13. Siapkan MinIO/private object storage local.
14. Siapkan Drizzle schema, Drizzle Kit, dan migration pertama.
15. Siapkan queue abstraction dan local PostgreSQL queue/outbox.
16. Buat health endpoint untuk web, database, storage, queue, dan worker.
17. Tambahkan structured logging dengan request/correlation ID.
18. Definisikan standardized application errors dan mapping ke HTTP response.
19. Tambahkan TanStack Start error boundary dan not-found handling.
20. Siapkan Vitest, integration test PostgreSQL, dan Playwright.
21. Buat CI pipeline yang menjalankan task melalui Moonrepo, termasuk install, lint, typecheck, unit/integration test, build, dan dry-run Workers bundle.
22. Tambahkan template `.env.example` dan contoh Wrangler binding tanpa secret.
23. Buat seed command yang idempotent.
24. Dokumentasikan local setup, Moonrepo task commands, Miniflare/Wrangler dev, migration, worker, dan test pada README.

### Test minimum

- TanStack Start build berhasil untuk target Workers dan Node fallback;
- Moonrepo dapat menemukan seluruh project dan menjalankan task lint/typecheck/test/build sesuai dependency graph;
- task deterministik menggunakan cache tanpa menghasilkan artefak atau hasil lint/typecheck yang stale;
- dry-run Wrangler tidak melewati bundle/startup limit;
- generated binding types sinkron dengan konfigurasi Wrangler;
- migration dapat dijalankan pada database kosong;
- seed dapat dijalankan dua kali tanpa duplicate;
- health check gagal secara jelas jika dependency unavailable;
- CI menjalankan lint, typecheck, test, build, dan deployment dry-run.

### Release gate

Semua developer dapat menjalankan web, database, storage, migration, dan test dari dokumentasi yang sama.

---

## Phase 2 — Database, Master Data, Authentication, and RBAC

**Tujuan:** membangun identitas pengguna dan data referensi yang diperlukan sebelum report dibuat.

### Langkah

1. Implementasikan migration untuk `users`, sessions/accounts, locations, categories, issue types, assets, technicians, dan audit logs.
2. Buat enum dan constraint database untuk role dan status aktif.
3. Implementasikan seed:
   - satu admin;
   - minimal dua reporter untuk authorization test;
   - enam kategori aktif (ELECTRICAL, HVAC, FURNITURE, ELECTRONIC, PLUMBING, OTHER);
   - lokasi nyata dari `rooms_lengkap.csv` (contoh: Gedung C/Ruang Kuliah);
  - beberapa issue type dan asset dengan nilai bobot prioritas;
   - beberapa teknisi.
4. Implementasikan login/logout melalui kontrak `SsoProvider`; gunakan `MockSsoProvider` di semua environment selama pilot (integrasi `UpiSsoProvider` ditunda).
5. Implementasikan session expiration dan secure cookie settings.
6. Buat middleware hanya untuk redirect/navigation convenience.
7. Buat server authorization policy yang dipanggil pada setiap use case.
8. Implementasikan admin CRUD untuk location, category, issue type, asset, dan technician.
9. Gunakan archive, bukan delete, jika record sudah digunakan.
10. Tambahkan audit log untuk create/update/archive master data.
11. Tambahkan rate limit login dan generic error untuk kredensial salah.
12. Uji bahwa inactive user tidak dapat menggunakan session lama.

### Test minimum

- provider SSO mengembalikan identity valid dan session terbentuk;
- identity tidak aktif atau provider gagal tidak dapat membuat session;
- reporter tidak dapat memanggil admin use case/API;
- admin dapat mengelola master data;
- reporter A tidak dapat bertindak sebagai reporter B;
- archived master data tidak tampil pada pilihan baru tetapi histori lama tetap valid;
- external identity dan session cookie tidak bocor ke client/log secara berlebihan;

### Release gate

Role boundary dan master data stabil sebelum implementasi report.

---

## Phase 3 — Core Reporting Vertical Slice

**Tujuan:** menyelesaikan alur terkecil reporter membuat laporan dan admin melihatnya, dengan verifikasi AI sinkron sebagai gerbang submit.

### Langkah backend/domain

1. Implementasikan tabel report, attachment metadata, report event, dan ticket sequence.
2. Definisikan schema input create report.
3. Validasi Gedung-Lantai-Ruangan-Aset wajib + aktif (tanpa kategori/issue type dari reporter; UI No. 3).
4. Implementasikan `createReport` dalam database transaction.
5. Gunakan idempotency key untuk mencegah duplicate akibat double-click/retry.
6. Cari kandidat duplikat otomatis (UI No. 7): asset/lokasi + status aktif + jendela waktu; identitas pelapor menentukan blokir (sama) vs auto-gabung (beda); kategori/issue type tiket sebelumnya hanya sinyal pendukung.
7. Jika kandidat pelapor SAMA: BLOKIR submit + kembalikan referensi ticket aktif (UI No. 7).
8. Jika kandidat pelapor BERBEDA: OTOMATIS gabung sebagai SUPPORTING dalam 1 tiket (UI No. 7).
9. Generate ticket number secara atomic.
10. Set status awal `REPORTED`.
11. Buat `REPORT_CREATED` event pada transaction yang sama.
12. Jalankan AI auto-verifikasi sinkron di momen submit (reporter menunggu verdict): foto dibaca sebelum baris laporan ada; klasifikasi + prioritas final + VERIFIED, atau tolak tanpa menyimpan baris/ticket, atau tahan sebagai REPORTED + ticket saat AI down (UI No. 2).
13. Implementasikan list tiket kampus tersanitasi + filter Laporan Saya dengan pagination (UI No. 5).
14. Implementasikan detail tiket kampus tersanitasi (identitas+teknisi disembunyikan; UI No. 5+9).
15. Implementasikan admin list seluruh report.
16. Implementasikan search berdasarkan ticket number dan deskripsi yang aman.
17. Implementasikan filter status, kategori, lokasi, priority, dan date range.
18. Tambahkan deterministic sorting dan pagination.

### Langkah frontend

1. Buat form Gedung-Lantai-Ruangan-Aset wajib (tanpa Kategori/Jenis Masalah; UI No. 3).
2. Tambahkan client validation untuk feedback cepat.
3. Tetap lakukan server validation penuh.
4. Buat review step sebelum submit.
5. Disable submit saat request berjalan dan kirim idempotency key.
6. Setelah sukses, tampilkan ticket number.
7. Buat halaman tiket kampus + filter Laporan Saya (UI No. 5).
8. Buat halaman detail dasar dengan status dan data laporan.
9. Buat admin table dan admin report detail dasar.
10. Tambahkan loading, empty, error, dan forbidden states.

### Test minimum

- input valid membuat tepat satu report dan satu initial event;
- retry dengan idempotency key sama tidak membuat report kedua;
- laporan aktif pelapor SAMA diblokir + referensi ticket (UI No. 7);
- laporan baru tetap dapat dibuat setelah laporan lama `CLOSED` atau untuk asset/lokasi berbeda;
- laporan pelapor BERBEDA otomatis digabung supporting (UI No. 7);
- jumlah reporter berbeda pada supporting report dapat dihitung sebagai indikator dampak tanpa membuat pekerjaan perbaikan ganda;
- ticket number unik pada request concurrent;
- reporter dapat membaca tiket kampus tersanitasi; identitas/teknisi disembunyikan (UI No. 5+9);
- admin dapat melihat semua report;
- filter dan pagination tidak menghilangkan atau menggandakan item;
- AI adalah penentu verifikasi sinkron; AI down = laporan ditahan sebagai REPORTED + ticket, menunggu verifikasi manual admin (pengecualian operasional; UI No. 2).

### Release gate

Demo harus dapat menunjukkan reporter submit → memperoleh ticket → admin melihat ticket yang sama.

---

## Phase 4 — Secure Image Upload

**Tujuan:** menambahkan bukti gambar tanpa membuka celah akses file atau upload berbahaya.

### Langkah

1. Buat `AttachmentStorage` interface agar upload flow tidak bergantung langsung pada R2/Cloudflare Images.
2. Untuk Cloudflare-first, evaluasi dua adapter dan pilih satu melalui spike:
   - Cloudflare Images Direct Creator Upload dengan one-time upload URL dan signed delivery;
   - private R2 dengan short-lived presigned upload/download URL.
3. Untuk local/VPS, gunakan MinIO/S3-compatible adapter.
3b. Foto diunggah mendahului baris laporan dan kuncinya dikirim bersama submit, agar verifikasi AI sinkron dapat membaca foto sebelum ticket diterbitkan.
4. Wajib 1–3 file/laporan dan maks 5 MB/file di client + server (API No. 4).
5. Validasi filename hanya sebagai metadata, bukan storage path.
6. Validasi MIME, magic bytes, dan hasil decode image; jangan percaya `Content-Type` dari browser saja.
7. Tolak SVG dan format selain allowlist.
8. Re-encode image dan strip EXIF. Pada Cloudflare Images gunakan private variant dengan metadata `none`; pada Node/VPS gunakan image processor yang telah di-hardening.
9. Generate random storage key/image ID; jangan gunakan original filename sebagai key.
10. Simpan attachment metadata hanya setelah provider mengonfirmasi upload valid.
11. Sediakan download/view endpoint berotorisasi atau signed URL berumur pendek.
12. Jangan membuat bucket R2 atau variant delivery dapat diakses publik.
13. Implementasikan cleanup untuk draft upload, upload gagal, dan orphan object.
14. Log upload error tanpa menulis binary atau sensitive URL.
15. Tambahkan placeholder jika attachment tidak dapat dimuat.
16. Uji batas file, signed URL expiration, metadata removal, dan ownership.

### Test minimum

- JPEG/PNG/WebP valid dapat diunggah;
- SVG/executable/MIME palsu/corrupted/terlalu besar/file keempat ditolak (API No. 4);
- reporter A tidak dapat mengakses attachment reporter B;
- object storage tidak public;
- orphan file dapat dibersihkan;
- kegagalan upload tidak merusak report yang sudah tersimpan.

### Release gate

Attachment hanya dapat dibaca pengguna yang berhak dan tidak dapat dieksekusi sebagai active content.

---

## Phase 5 — Admin Workflow, Assignment, and Timeline

**Tujuan:** menyelesaikan lifecycle maintenance dari verification sampai closed.

### Langkah domain/backend

1. Implementasikan state machine berdasarkan transition matrix final.
2. ~~`verifyReport` manual DIHAPUS (otomatis AI, UI No. 2)~~. AI menetapkan:
   - final category wajib;
   - final issue type wajib;
   - asset/location tervalidasi;
   - final priority wajib;
   - event dan timestamps dibuat atomically.
3. ~~reject/duplicate manual DIHAPUS~~ (tolak-otomatis-AI + auto-gabung; UI No. 2+7).
4. Auto-gabung supporting/related dari reporter berbeda (UI No. 7).
5. AI menjalankan priority scoring deterministik + menetapkan final (UI No. 2):
   - bobot kategori maksimum 35;
   - bobot aset/fasilitas maksimum 25;
   - bobot lokasi maksimum 25;
   - bobot frekuensi pelapor maksimum 15 (tier 1→0, 2→5, 3–4→10, ≥5→15; menghitung reporter berbeda pada insiden yang sama, hanya laporan aktif);
   - mapping skor ke `LOW`, `MEDIUM`, dan `HIGH` (tanpa `CRITICAL`);
   - safety override yang menetapkan minimum `HIGH` untuk issue `DANGEROUS`.
6. Simpan score + snapshot faktor + decidedBy=AI; tanpa override manual (UI No. 2).
7. Implementasikan assignment dan reassignment history.
8. Pastikan hanya teknisi aktif dapat dipilih untuk assignment baru.
9. Implementasikan status transition command.
10. Validasi mandatory note pada inspection dan resolution (tanpa reopen/reject/duplicate; UI No. 8+7).
11. Implementasikan catatan progres tunggal tanpa pilihan visibilitas; kondisi `LAPORAN_PALSU` diproyeksikan netral untuk pelapor (UI No. 10).
12. Implementasikan timeline projection yang menggabungkan status, assignment, supporting reports, dan update secara kronologis.
13. Tambahkan optimistic locking menggunakan `version`.
14. Return conflict jika dua admin mengubah versi report yang sama.
15. Simpan report event dan audit log dalam transaction yang sama dengan perubahan canonical record.
16. Buat notifikasi via outbox/domain event (tanpa inline side effect).

### Langkah frontend

1. Tampilkan panel hasil AI final (klasifikasi + prioritas; UI No. 2).
2. ~~verification form manual DIHAPUS~~ (UI No. 2).
3. Tampilkan faktor skor + total + final AI dalam satu panel final (UI No. 2).
4. ~~priority control/override DIHAPUS~~ (UI No. 2).
5. Assignment UI hanya technicianId (API No. 9).
6. Hanya tampilkan next status yang valid.
7. Minta confirmation untuk terminal transition.
8. Form catatan progres + kondisi Laporan Palsu (UI No. 10).
9. Tampilkan timeline admin lengkap.
10. Tampilkan timeline reporter yang sudah disanitasi.
11. Banner 409 "Tiket diperbarui admin lain — muat ulang data" + Refresh (API No. 12).

### Test minimum

- transisi valid berhasil;
- transisi ilegal gagal tanpa partial update;
- assignment tanpa teknisi aktif gagal;
- priority score mengikuti rubric untuk boundary dan kombinasi faktor yang diketahui;
- supporting report dari reporter berbeda tidak dianggap duplicate dan tidak membuat pekerjaan perbaikan baru;
- affected reporter count menghitung reporter berbeda, bukan jumlah submission mentah;
- bahaya keselamatan tidak dapat menghasilkan priority di bawah `HIGH`;
- hasil AI adalah `finalPriority` final (UI No. 2);
- resolution tanpa note gagal;
- semua catatan terlihat reporter kecuali kondisi Laporan Palsu yang tampil netral (UI No. 10);
- timeline terurut dan memuat actor/timestamp yang tepat;
- dua update berdasarkan version sama menghasilkan satu sukses dan satu conflict;
- reassignment tidak menghapus histori teknisi sebelumnya.

### Release gate

Scenario utama harus berjalan lengkap:

`REPORTED → VERIFIED → ASSIGNED → INSPECTION → IN_REPAIR → RESOLVED → CLOSED`.

---

## Phase 6 — Facility Status, Maintenance History, and Notification

**Tujuan:** memberikan transparansi lintas fasilitas dan histori maintenance.

### Langkah

1. Implementasikan query maintenance history per asset.
2. Tampilkan semua ticket terkait asset dengan status dan tanggal.
3. Implementasikan derived facility status dari active report.
4. Definisikan behavior untuk asset tanpa report dan asset nonaktif.
5. ~~proyeksi status publik DIHAPUS (digantikan langkah 7; UI No. 6)~~.
6. ~~detail proyeksi publik DIHAPUS (digantikan langkah 7; UI No. 6)~~.
7. ~~halaman status publik DIHAPUS~~; status 3-state hanya di Kelola Aset admin (UI No. 6).
8. Implementasikan notification worker dari outbox event.
9. Buat notification untuk verified, assigned, status changed, catatan progres, resolved, dan closed.
10. Implementasikan unread count dan mark as read.
11. Pastikan event diproses idempotently agar notification tidak ganda.
12. Tambahkan retry dan dead-letter/error state untuk job gagal.

### Test minimum

- status asset berubah sesuai report aktif;
- satu asset dengan beberapa ticket menggunakan precedence yang disepakati;
- facility kembali `OPERATIONAL` setelah tidak ada ticket aktif;
- tidak ada endpoint status publik; proyeksi tiket kampus tidak bocor (UI No. 5+6);
- maintenance history menunjukkan semua ticket asset yang benar;
- notification dibuat sekali walaupun worker retry;
- reporter hanya dapat membaca notification miliknya.

### Release gate

Admin memantau status aset 3-state; reporter memantau tiket kampus tersanitasi (UI No. 5+6).

---

## Phase 7 — Dashboard and Deterministic Analytics

**Tujuan:** menyediakan gambaran kondisi operasional berdasarkan data canonical.

### Definisi metric

Definisi berikut harus digunakan konsisten oleh query, UI, dan test:

- **Total reports:** jumlah report yang dibuat dalam date range.
- **Active reports:** status bukan `CLOSED` (hanya 7 status; UI No. 7).
- **In repair:** report dengan status `IN_REPAIR`.
- **Resolved this month:** `resolved_at` berada pada bulan berjalan dalam timezone bisnis.
- **High-priority issues:** active report dengan `final_priority = HIGH`.
- **Affected reporters:** jumlah reporter berbeda pada report aktif dan supporting report yang ditautkan; duplicate dari reporter yang sama dihitung satu kali.
- **Resolution time:** `resolved_at - reported_at`.
- **Verification time:** `verified_at - reported_at`.
- **Assignment time:** waktu assignment pertama - `verified_at`.
- **Reports by category:** gunakan `final_category_id`; sebelum verified dapat ditampilkan sebagai unclassified jika diperlukan.
- **Reports by location:** gunakan location report pada saat laporan dibuat, bukan lokasi asset yang mungkin berubah kemudian.
- **Technician workload:** jumlah tiket aktif (`ASSIGNED`/`INSPECTION`/`IN_REPAIR`) per teknisi; dipakai untuk panel tugas dan grafik beban teknisi (UI No. 11).
- **Report trend:** jumlah laporan dan rata-rata/median resolution time per periode (UI No. 11).
- **Tickets by category and building:** gunakan `final_category_id` dan gedung dari lokasi laporan (UI No. 11).

### Langkah

1. Implementasikan query overview cards.
2. Implementasikan reports by status.
3. Implementasikan reports by category.
4. Implementasikan reports by location.
5. Implementasikan average/median resolution time.
6. Tambahkan date range dan timezone handling.
7. Buat fixture dataset dengan expected output manual.
8. Uji setiap query terhadap fixture tersebut.
9. Buat dashboard admin dengan chart sederhana dan tabel pendukung.
10. Pastikan chart memiliki label/summary yang dapat dibaca tanpa warna saja.
11. Tambahkan drill-down dari metric ke filtered report list jika waktu memungkinkan.
12. Periksa query plan dan index pada volume data target.
13. Gambar penuh halaman UI No. 11 (endpoint menyusul): Dashboard Admin (kartu ringkasan, antrean prioritas, panel tugas per teknisi), Pengaturan Scoring, dan Laporan Maintenance (3 grafik + tabel + Ekspor PDF).

### Test minimum

- semua metric cocok dengan expected fixture;
- hanya CLOSED yang non-aktif (UI No. 7);
- unresolved report tidak masuk resolution time;
- boundary tanggal UTC/Asia Jakarta benar;
- data memakai klasifikasi final AI (UI No. 2);
- dashboard kosong tetap memberikan empty state yang benar;
- halaman UI No. 11 tetap dapat digambar penuh dengan data mock/empty state walau endpoint belum tersedia.

### Release gate

Angka pada overview, chart, dan report list konsisten untuk filter yang sama.

---

## Phase 8 — AI Verification Verdicts with OpenRouter

**Tujuan:** satu structured LLM request **sinkron saat submit** (OpenRouter) yang **menentukan verifikasi + klasifikasi + prioritas final otomatis** (UI No. 2 + desain AI-verification 2026-10-14). Submit menunggu verdict; queue/outbox tetap dipakai untuk notifikasi, bukan untuk verifikasi.

### 8.1 Scope AI MVP

Implementasikan application port:

```ts
interface ReportReviewAssistant {
  review(input: ReportReviewInput): Promise<ReportReviewResult>
}
```

Sediakan dua adapter:

- `MockReportReviewAssistant` untuk test dan local development tanpa biaya API;
- `OpenRouterReportReviewAssistant` menggunakan raw `fetch` ke OpenRouter.

Output adalah verdict `PASS` (kategori + issue type + priority final dari master data, confidence, alasan singkat), `FAIL` (alasan yang bisa ditindaklanjuti reporter), atau kondisi `DOWN` (timeout/5xx/429 → tahan untuk verifikasi manual). MVP tidak menggunakan agent loop, memory, RAG, tool calling, summarization otomatis, atau autonomous action.

### 8.2 Kontrak input dan data minimization

Kirim data minimum yang diperlukan:

- deskripsi laporan yang telah dibatasi panjangnya;
- foto yang sudah diunggah (kunci storage di-resolve server-side menjadi konten gambar ter-downscale, maks 1280px JPEG kualitas 80; AI wajib menilai kejelasan dan relevansi foto);
- label lokasi + konteks aset yang telah disanitasi;
- snapshot taxonomy (kategori + issue type aktif) agar AI memilih hanya dari daftar yang ada;
- rubric priority.

Jangan kirim:

- password, session, atau authorization header pengguna;
- nama, email, NIM/NIP, nomor telepon, atau identitas reporter;
- internal notes;
- data personal teknisi;
- database identifier yang tidak diperlukan.

Tambahkan petunjuk pada form agar reporter tidak memasukkan data pribadi ke deskripsi.

### 8.3 OpenRouter privacy and routing policy

Konfigurasi account:

- Input & Output Logging nonaktif;
- OpenRouter Use of Inputs/Outputs nonaktif;
- account-level Zero Data Retention diaktifkan jika tersedia;
- API key staging dan production dipisah;
- setiap API key memiliki credit limit;
- key disimpan dengan Workers Secrets dan hanya tersedia pada server-side submit path; tidak pernah di client.

Setiap request menggunakan policy minimum:

```json
{
  "provider": {
    "data_collection": "deny",
    "zdr": true,
    "require_parameters": true,
    "allow_fallbacks": false
  }
}
```

Jika fallback diperlukan, gunakan `only`/allowlist provider yang data policy-nya telah ditinjau. Jangan membiarkan routing berpindah bebas ke endpoint non-ZDR.

Pin model slug eksplisit. Hindari `openrouter/auto`, model gratis dengan policy tidak jelas, alias `latest`, dan random model fallback pada production.

OpenRouter tetap menyimpan metadata request seperti model, token usage, latency, cost, dan status. Privacy notice harus menjelaskan bahwa konten diproses oleh OpenRouter dan upstream provider walaupun content logging dinonaktifkan.

### 8.4 Structured output

OpenRouter harus mengembalikan output yang divalidasi dengan Zod, misalnya:

```json
{
  "verdict": "PASS",
  "category": "HVAC",
  "issueType": "LEAKING",
  "priority": "HIGH",
  "confidence": 0.86,
  "reasons": ["kebocoran terlihat pada foto 1", "deskripsi sesuai aset AC-04"],
  "reasoningSummary": "Foto jelas dan deskripsi sesuai aset; kategori dan prioritas ditetapkan."
}
```

Validasi dua tingkat:

1. **schema validation:** tipe, enum, panjang string, dan rentang confidence;
2. **domain validation:** kategori/issue type harus ada di master data; deskripsi yang menunjuk ke kategori berbeda dari kategori master aset = gagal `wrong-asset`, bukan rekode diam-diam; `DANGEROUS` memaksa minimal `HIGH`.

`reasoningSummary` hanya berupa alasan singkat untuk reporter/admin, bukan hidden chain-of-thought. Nilai `confidence` adalah indikasi model yang belum tentu terkalibrasi; ambang ragu-ragu diperlakukan sebagai gagal dengan alasan yang bisa ditindaklanjuti, bukan tebakan diam-diam. Raw prompt dan raw response tidak disimpan secara default.

### 8.5 Submit flow sinkron dan worker notifikasi

Verifikasi berjalan **sinkron di path submit web** (bukan via queue): web memanggil asisten AI dengan timeout, menulis verdict + klasifikasi + priority final secara atomik dengan baris laporan. Queue/outbox tetap dipakai untuk **notifikasi** (verified, assigned, status changed, dst.) dengan consumer idempotent seperti sebelumnya.

```mermaid
sequenceDiagram
    participant Reporter
    participant Web as TanStack Start
    participant DB as PostgreSQL
    participant OR as OpenRouter
    Reporter->>Web: Submit report (aset + deskripsi + kunci foto)
    Web->>OR: Structured verify dengan ZDR policy + timeout
    alt PASS
        Web->>DB: Transaction report VERIFIED + klasifikasi/priority final + analysis
        DB-->>Web: Ticket created
        Web-->>Reporter: Show ticket number
    else FAIL
        Web-->>Reporter: 422 + alasan (tanpa baris/ticket)
    else AI DOWN
        Web->>DB: Simpan DITAHAN sebagai REPORTED + ticket + analysis PENDING
        DB-->>Web: Ticket created
        Web-->>Reporter: Show ticket + pemberitahuan menunggu
    end
```

Queue message notifikasi hanya membawa identifier dan routing metadata minimum. Consumer wajib idempotent karena Queue dapat melakukan redelivery.

### 8.6 Model evaluation spike

Sebelum model dikunci:

1. siapkan 30–50 contoh laporan representatif yang telah diberi label oleh manusia;
2. bandingkan beberapa model yang tersedia melalui OpenRouter;
3. verifikasi model mendukung structured output dan endpoint ZDR;
4. ukur verification agreement, priority agreement, schema validity, latency, dan cost;
5. uji Bahasa Indonesia, typo, deskripsi pendek, deskripsi ambigu, dan prompt injection;
6. pilih satu model slug eksplisit;
7. dokumentasikan model, upstream provider, privacy policy, prompt version, dan hasil evaluasi;
8. tetapkan acceptance threshold bersama admin/UMPER;
9. lakukan evaluasi ulang sebelum mengganti model atau prompt production.

### 8.7 Langkah implementasi

1. Buat `ReportReviewAssistant` interface pada application layer.
2. Buat Zod schema untuk input, output, queue message, dan OpenRouter response envelope.
3. Buat `MockReportReviewAssistant` dengan output deterministik.
4. Buat `OpenRouterReportReviewAssistant` menggunakan raw `fetch`; jangan tambahkan agent framework atau SDK yang tidak diperlukan.
5. Simpan `OPENROUTER_API_KEY` hanya pada server-side runtime submit path melalui secret manager/`wrangler secret put`; jangan menaruhnya pada `wrangler.jsonc`, client bundle, atau prefix `VITE_`.
6. Simpan exact model slug, timeout, max output token, dan feature flag dalam server-side runtime config.
7. Tambahkan privacy routing policy ZDR/data-collection deny pada setiap request.
8. Version prompt, rubric, taxonomy snapshot, dan output schema.
9. ~~outbox `AI_REVIEW_REQUESTED` DIHAPUS untuk verifikasi~~ (verifikasi sinkron saat submit; outbox tetap untuk notifikasi).
10. ~~dispatcher/reconciliation AI DIHAPUS~~ (milik alur notifikasi).
11. ~~Queue producer/consumer AI DIHAPUS~~ (milik alur notifikasi).
12. Claim/update analysis secara idempotent menggunakan `analysisId`.
13. Sanitasi input dan batasi panjang deskripsi.
14. Kirim snapshot taxonomy agar AI memilih klasifikasi final hanya dari master data; deskripsi-vs-aset yang tidak cocok = gagal `wrong-asset`.
15. Gunakan structured output/JSON schema yang didukung model.
16. Terapkan `AbortSignal` timeout.
17. Validasi HTTP status dan response envelope sebelum membaca output model.
18. Validasi output dengan Zod dan master data.
19. Tolak recommendation atau priority yang tidak sesuai enum/policy.
20. Simpan parsed recommendation, possible duplicate flag, priority suggestion, factors, confidence, model, upstream provider, request ID, prompt/schema version, token usage, dan estimasi cost.
21. Jangan menyimpan raw prompt/response atau API key pada database/log.
22. Terapkan timeout submit + klasifikasi error DOWN (timeout/5xx/429 → tahan) vs FAIL (4xx/auth/schema → tolak di tempat).
23. ~~dead-letter AI DIHAPUS~~; laporan yang ditahan menunggu verifikasi manual admin (satu-satunya antrean manual).
24. ~~manual retry AI oleh admin DIHAPUS~~; admin memverifikasi laporan yang ditahan, bukan me-retry AI.
25. Tambahkan feature flag hanya untuk non-verifikasi; verifikasi wajib AI (UI No. 2).
26. Tampilkan hasil final AI (verifikasi + klasifikasi + prioritas) sebagai keputusan final di admin UI (UI No. 2).
27. ~~penetapan manual admin DIHAPUS~~ (final = output AI; UI No. 2).
28. Catat hasil AI + metadata model/prompt untuk audit dan evaluasi kualitas (UI No. 2).
29. Output AI menetapkan VERIFIED + klasifikasi + priority final + auto-gabung supporting (UI No. 2+7); assignment/status-lanjut tetap oleh admin.
30. Monitor queue depth, OpenRouter latency/error, schema failure, token usage, dan cost.

### Test minimum

- AI down menahan laporan sebagai REPORTED + ticket untuk verifikasi manual admin, bukan gagal retryable (pengecualian operasional; UI No. 2);
- API key tidak pernah berada pada browser bundle, response, database, atau log;
- request selalu membawa ZDR/data-collection deny policy;
- reconciliation mengirim outbox yang belum ter-dispatch;
- redelivery Queue tidak menghasilkan duplicate analysis/event;
- output invalid ditolak dan tidak mengubah canonical report;
- output AI MENETAPKAN category/issue type/status/relasi/final priority (UI No. 2+7);
- timeout berakhir pada status DITAHAN yang menunggu verifikasi manual;
- non-retryable 4xx tidak diulang tanpa batas;
- hasil AI ADALAH verifikasi + final priority (UI No. 2);
- ~~accept/reject manual DIHAPUS~~ (UI No. 2);
- flag hanya menonaktifkan non-verifikasi; verifikasi wajib AI (UI No. 2);
- prompt injection tidak dapat mengubah output contract atau menjalankan tindakan;
- test suite berjalan dengan mock tanpa memanggil OpenRouter;
- evaluation dataset verifikasi dan prioritas memenuhi threshold yang disepakati;
- model/provider change terdeteksi sebagai perubahan konfigurasi yang perlu evaluasi.

### Release gate

- AI dapat dinonaktifkan untuk non-verifikasi tanpa mengganggu core workflow;
- model pinned telah lulus evaluation dataset dan endpoint ZDR tersedia;
- account logging/data-use settings telah diverifikasi nonaktif;
- staging dan production menggunakan API key serta credit limit terpisah;
- verifikasi manual admin hanya mencakup laporan yang ditahan saat AI down.

---

## Phase 9 — Hardening, UAT, and Release

**Tujuan:** memastikan MVP aman, stabil, dapat didemokan, dan siap diuji pengguna.

### Langkah security

1. Review semua query reporter untuk IDOR/ownership issue.
2. Review semua admin mutation untuk role check.
3. Aktifkan CSRF protection sesuai auth/transport yang digunakan.
4. Terapkan secure headers dan content security policy.
5. Sanitize/render text sebagai plain text; hindari raw HTML.
6. Rate-limit login, create report, dan upload.
7. Batasi request body dan upload size pada platform/CDN serta aplikasi.
8. Pastikan secret hanya berada di secret manager/environment.
9. Redact token, password, signed URL, dan PII dari log.
10. Jalankan dependency vulnerability scan.
11. Uji backup dan restore PostgreSQL serta object storage metadata.
12. Verifikasi bucket/container tidak public.

### Langkah quality

1. Jalankan seluruh unit, integration, dan E2E test.
2. Lakukan accessibility review untuk form, dialog, table, dan chart.
3. Uji responsive layout pada mobile web dan desktop.
4. Uji pagination/filter dengan data seed berukuran realistis.
5. Uji concurrency dua admin.
6. Uji worker notifikasi restart, retry, dan failed job recovery.
7. Uji OpenRouter unavailable (→ ditahan + verifikasi manual), timeout, non-ZDR route rejection, dan insufficient credit.
8. Lakukan browser smoke test pada deployment staging.
9. Jalankan UAT bersama minimal satu calon reporter dan satu admin UMPER.
10. Catat temuan UAT dan hanya perbaiki blocker/high-impact issue sebelum release.
11. Siapkan demo seed scenario AC Ruang 204 dari PRD.
12. Siapkan runbook deployment, rollback, backup, dan troubleshooting.
13. Siapkan privacy notice dan informasi penggunaan AI.

### Release gate

- tidak ada test P0 yang gagal;
- tidak ada known critical authorization/upload vulnerability;
- happy-path E2E lulus di staging;
- backup dan restore telah diuji;
- admin dapat menjalankan alur tanpa bantuan developer;
- AI down menahan laporan untuk verifikasi manual, bukan memblokir operasi;
- UAT sign-off tercatat.

---

## 12. Test Strategy

Gunakan test pyramid dengan fokus kuat pada domain rule dan authorization.

### 12.1 Unit tests

Target utama:

- state transition matrix;
- priority rule helpers;
- facility status derivation;
- input schema;
- AI output parser;
- ticket formatting;
- metric calculation pure functions;
- authorization policies.

### 12.2 Integration tests

Gunakan PostgreSQL test database nyata untuk:

- transaction create report;
- atomic ticket sequence;
- idempotency;
- ownership query;
- filter/pagination;
- optimistic locking;
- report event/audit persistence;
- analytics query;
- outbox/job claiming;
- notification idempotency.

### 12.3 E2E browser tests

Minimum scenarios:

1. reporter login → submit report → melihat ticket;
2. reporter melihat daftar tiket kampus tersanitasi + filter "Laporan Saya" dan detail tiket orang lain tanpa identitas pelapor;
3. reporter tidak dapat membuka ticket reporter lain;
4. admin login → meninjau hasil final AI → assign → update → resolve → close;
5. reporter melihat timeline dan notifikasi hasil update admin;
6. kondisi Laporan Palsu tampil netral untuk reporter;
7. status aset admin berubah dan kembali operational (admin-only);
8. maintenance history dan analytics ikut berubah;
9. AI PASS menampilkan VERIFIED + klasifikasi final;
10. AI down menahan laporan + verifikasi manual admin.

### 12.4 Security tests

- direct object reference untuk report, attachment, notification;
- role escalation;
- invalid session;
- upload MIME spoofing;
- oversized upload;
- SVG/XSS attempt;
- stored XSS pada description/progress message;
- brute-force/rate-limit behavior;
- signed URL expiration;
- sensitive data exposure pada status aset admin-only; tidak ada endpoint publik.

### 12.5 Performance baseline

Untuk prototype, tetapkan baseline yang realistis dan ukur pada staging. Contoh target awal:

- halaman daftar/report API p95 < 1 detik untuk query non-AI pada volume seed target;
- create report non-upload p95 < 1 detik di luar waktu tunggu verdict AI (verdict AI berjalan di path submit; ukur terpisah);
- dashboard query mempunyai index dan tidak melakukan full scan yang tidak perlu.

Target final harus disesuaikan dengan environment deployment.

---

## 13. Definition of Done

Sebuah backlog item dianggap selesai jika:

1. acceptance criteria terpenuhi;
2. authorization server-side telah diterapkan;
3. input divalidasi di server;
4. unit/integration test relevan ditambahkan dan lulus;
5. happy path serta error state UI tersedia;
6. migration/seed diperbarui jika diperlukan;
7. audit/event dibuat untuk tindakan penting;
8. tidak ada secret atau PII sensitif pada log;
9. dokumentasi use case/config diperbarui;
10. lint, typecheck, test terkait, dan build lulus;
11. perubahan telah direview terhadap scope MVP;
12. behavior tetap benar saat AI unavailable (ditahan + verifikasi manual) jika item menyentuh AI.

---

## 14. Acceptance Criteria MVP End-to-End

### 14.1 Authentication dan authorization

- Reporter A dapat login dan melihat laporan sendiri.
- Reporter dapat membaca tiket kampus tersanitasi (identitas+teknisi disembunyikan) + filter Laporan Saya (UI No. 5+9).
- Reporter tidak dapat mengakses fungsi admin.
- Admin dapat melihat semua report dan mengelola workflow.

### 14.2 Submit report

- Input valid (Gedung-Lantai-Ruangan-Aset wajib) menghasilkan satu ticket; AI otomatis VERIFIED/tolak (UI No. 2+3).
- Ticket menyimpan reporter, timestamp, lokasi+aset, klasifikasi final AI, deskripsi, timeline (UI No. 2+3).
- Double-click/retry tidak membuat ticket ganda.
- Laporan aktif pelapor SAMA diblokir + referensi ticket (UI No. 7).
- Laporan baru tetap dapat dibuat setelah laporan sebelumnya `CLOSED` atau jika insidennya berbeda.
- Laporan pelapor BERBEDA otomatis digabung supporting (UI No. 7).
- Kegagalan AI menahan submit sebagai REPORTED + ticket untuk verifikasi manual admin (pengecualian operasional; UI No. 2).

### 14.3 Upload

- Gambar valid dapat dilihat pihak berwenang.
- File terlalu besar, corrupted, MIME palsu, SVG, atau executable ditolak.
- File tidak tersedia melalui public permanent URL.

### 14.4 Admin workflow

- Admin hanya dapat menjalankan transisi pada transition matrix.
- Verifikasi otomatis AI menetapkan klasifikasi + priority final (UI No. 2); laporan HELD saat AI down diverifikasi admin (pengecualian operasional).
- Skor deterministik + snapshot tersimpan decidedBy=AI (UI No. 2).
- Perhitungan menggunakan rubric yang disepakati; laporan duplikat tidak menambah frekuensi.
- Supporting report dari reporter berbeda menambah affected reporter count, bukan pekerjaan perbaikan baru.
- ~~override manual DIHAPUS~~ (UI No. 2).
- Assignment teknisi aktif, hanya technicianId (API No. 9).
- Resolution membutuhkan resolution note.
- Transisi ilegal tidak mengubah report maupun timeline.
- Concurrent update 409 + banner Refresh (API No. 12).

### 14.5 Tracking dan transparansi

- Reporter melihat status terbaru dan timeline terurut.
- Semua catatan terlihat reporter kecuali Laporan Palsu jadi netral (UI No. 10).
- Kondisi Laporan Palsu: admin asli, pelapor netral (UI No. 10).
- Reporter memperoleh notifikasi untuk perubahan penting.
- Nama teknisi disembunyikan dari pelapor (UI No. 9).

### 14.6 Facility dan analytics

- Ticket muncul pada maintenance history asset yang benar.
- Status aset 3-state admin-only konsisten (UI No. 6).
- Tanpa status publik; proyeksi tiket kampus tidak bocor (UI No. 5+6).
- Overview dan chart cocok dengan fixture data yang telah diketahui.
- Resolution time menggunakan definisi yang disepakati.

### 14.7 AI

- Output AI tervalidasi terhadap schema dan taxonomy.
- Hasil AI adalah final (UI No. 2).
- ~~accept/override DIHAPUS~~ (UI No. 2).
- AI menetapkan VERIFIED + klasifikasi + priority final otomatis (UI No. 2).
- AI wajib untuk verifikasi; flag hanya untuk non-verifikasi (UI No. 2). Pengecualian: laporan HELD saat AI down diverifikasi admin.

---

## 15. Observability dan Operasional

### 15.1 Logging

Setiap log request penting menyertakan:

- timestamp;
- level;
- request/correlation ID;
- user ID jika tersedia, tanpa PII berlebih;
- route/use case;
- result/error code;
- duration.

Jangan log:

- password;
- session token;
- raw image;
- signed URL lengkap;
- prompt yang mengandung data sensitif;
- raw provider credential;
- raw OpenRouter prompt/response pada production.

### 15.2 Metrics minimum

- request rate dan error rate;
- login failure rate;
- report creation success/failure;
- upload rejection/error;
- job queue depth;
- OpenRouter latency, success rate, schema failure, retry count, token usage, dan cost;
- notification job failure;
- database connection/error;
- storage error.

### 15.3 Backup dan recovery

- backup PostgreSQL terjadwal;
- object storage lifecycle/backup sesuai deployment;
- dokumentasikan restore procedure;
- uji restore sebelum pilot;
- tentukan recovery point dan recovery time target sesuai kemampuan kampus.

---

## 16. Deployment Environments and Strategy

### 16.1 Keputusan deployment

**Keputusan pilot 2026-10-10: lokal saja** (container di mesin development;
VPS/server kampus dan Cloudflare ditunda). Tabel di bawah adalah opsi deploy
masa depan, bukan target pilot. Baseline spike teknis mengikuti target lokal
(Node + PostgreSQL container + MinIO):

| Komponen | Deployment utama |
|---|---|
| TanStack Start SSR, server functions, dan server routes | Cloudflare Workers |
| Static assets | Workers Static Assets |
| Notification consumer | Cloudflare Queue consumer Worker |
| Job transport | Cloudflare Queues + dead-letter queue |
| Gambar laporan | Cloudflare Images signed delivery atau private R2 |
| Database | Managed PostgreSQL eksternal |
| Database connection | Cloudflare Hyperdrive + Drizzle/`pg` |
| Secret | Workers Secrets/Secrets Store |
| Scheduled reconciliation | Cron Trigger atau scheduled Worker |
| AI client | Raw `fetch` dari server-side submit path (web) |
| AI gateway | OpenRouter API dengan ZDR/data-collection deny |
| Model endpoint | Pinned ZDR provider endpoint melalui OpenRouter |

Cloudflare tidak menyediakan PostgreSQL sebagai database native. D1 dapat digunakan jika sistem sengaja didesain ulang untuk SQLite, tetapi **tidak menjadi default** karena execution plan ini membutuhkan PostgreSQL transaction, relational query, concurrency handling, dan analytics yang sudah didefinisikan.

### 16.2 Cloudflare topology

```mermaid
flowchart TD
    U[Browser] --> W[TanStack Start Worker]
    W --> H[Hyperdrive]
    H --> P[(Managed PostgreSQL)]
    W --> I[Cloudflare Images or R2]
    W --> Q[Cloudflare Queues]
    Q --> C[Queue Consumer Worker]
    C --> H
    W --> OR[OpenRouter API]
    OR --> M[Pinned ZDR Model Endpoint]
    S[Cron Reconciliation] --> P
    S --> Q
```

Cloudflare Queues digunakan untuk notifikasi agar tidak memblokir request utama (verifikasi AI sendiri berjalan sinkron di path submit dengan timeout). Queue consumer memiliki retry, batching, dan dead-letter flow. Queue message hanya membawa ID; consumer memuat data terbaru dari PostgreSQL.

### 16.3 Batas Cloudflare yang memengaruhi desain

- gunakan `nodejs_compat` dan compatibility date yang dipin;
- environment binding dibaca per request/runtime, bukan dari client bundle;
- Workers mempunyai memory limit 128 MB;
- Workers Free hanya menyediakan CPU budget kecil, sehingga SSR, response parsing, dan validation harus diukur;
- Workers Paid lebih aman untuk staging/pilot karena CPU limit dapat dikonfigurasi lebih tinggi;
- waktu menunggu network/provider tidak dihitung sebagai CPU, tetapi parsing, validation, prompt construction, dan framework runtime tetap dihitung;
- AI submit timeout harus jauh di bawah wall-clock limit request web; queue consumer hanya menangani notifikasi;
- `waitUntil()` bukan pengganti durable queue untuk notifikasi;
- batasi bundle dan top-level initialization agar startup Worker tetap cepat;
- gunakan raw `fetch` agar submit path tidak membawa agent framework atau SDK yang tidak diperlukan;
- `OPENROUTER_API_KEY` hanya tersedia pada server-side submit path melalui Workers Secret; tidak pernah di client;
- koneksi PostgreSQL dibuat per invocation menggunakan Hyperdrive connection string sesuai pola Workers;
- upload gambar besar dilakukan direct-to-provider agar body tidak perlu dibuffer oleh Worker.

Workers Free dapat dipakai untuk eksperimen web dengan batas yang ketat; availability dan retention Queue harus diverifikasi pada akun yang digunakan. Untuk staging/pilot yang stabil, anggarkan Workers Paid, managed PostgreSQL, image storage, kredit OpenRouter, serta biaya model provider.

### 16.4 Kapan memilih VPS/container

Pilih VPS atau managed container jika salah satu kondisi berikut terjadi:

- membutuhkan package native seperti image processor Node tertentu;
- kampus melarang pemrosesan data melalui AI gateway pihak ketiga;
- membutuhkan direct provider networking atau private endpoint khusus;
- membutuhkan proses background yang hidup terus-menerus;
- membutuhkan local model dengan CPU/GPU;
- kampus mengharuskan self-hosting atau jaringan privat;
- tim lebih nyaman mengoperasikan Docker daripada binding Cloudflare;
- biaya layanan terpisah lebih tinggi daripada satu server yang dikelola sendiri.

Topology VPS:

```text
Reverse proxy
├── TanStack Start Node process
├── Background worker process
├── PostgreSQL
└── MinIO atau S3-compatible storage
```

Web dan worker tetap berasal dari monorepo yang sama. Tidak perlu memecah frontend dan backend menjadi repository terpisah.

### 16.5 Hybrid fallback

Raw `fetch` OpenRouter kompatibel dengan Workers, sehingga VPS tidak diperlukan untuk AI MVP. Namun jika server-side AI client perlu dipindahkan karena kebijakan kampus atau kebutuhan operasional:

- tetap deploy TanStack Start pada Cloudflare Workers;
- tetap gunakan Images/R2 untuk attachment;
- jalankan `OpenRouterReportReviewAssistant` pada Node VPS/managed container;
- gunakan endpoint server-side terautentikasi atau PostgreSQL outbox untuk notifikasi;
- pertahankan `ReportReviewAssistant` contract dan queue message contract untuk notifikasi;
- tetap gunakan privacy routing, secret isolation, timeout, dan data minimization yang sama.

Hybrid fallback lebih kecil risikonya daripada memindahkan seluruh aplikasi ke VPS.

### 16.6 Environment

Gunakan minimal tiga environment:

| Environment | Tujuan | Data |
|---|---|---|
| Local | TanStack Start dev, PostgreSQL, MinIO, mock classifier | Seed sintetis |
| Staging | Workers, Queue, storage, Hyperdrive, OpenRouter test terbatas | Data sintetis/terkontrol |
| Production/Pilot | Penggunaan terbatas | Data aktual sesuai kebijakan kampus |

Setiap environment mempunyai database, bucket/image namespace, queue, Hyperdrive config, dan credential AI terpisah. Jangan menggunakan data production untuk development.

### 16.7 Cloudflare deployment flow

1. CI menjalankan task Moonrepo untuk lint, typecheck, unit/integration test, dan TanStack Start build.
2. Jalankan Wrangler dry-run dan periksa bundle/startup metrics.
3. Jalankan database backup/checkpoint.
4. Jalankan migration ke staging menggunakan credential migration terpisah.
5. Deploy web dan queue consumer ke staging dengan Wrangler.
6. Jalankan smoke test web, database, upload, Queue, dan satu AI review.
7. Jalankan Playwright E2E serta UAT.
8. Dapatkan approval release.
9. Jalankan production migration yang backward-compatible.
10. Deploy production/pilot Worker versions.
11. Jalankan post-deploy smoke test.
12. Monitor Worker errors, Hyperdrive/database, queue backlog, dead-letter queue, storage, dan AI usage.
13. Rollback Worker version jika perlu; migration dirancang agar versi sebelumnya masih dapat berjalan.

### 16.8 VPS deployment flow

1. CI menjalankan test dan build image untuk web serta worker.
2. Jalankan backup/checkpoint dan migration.
3. Deploy immutable images ke staging.
4. Jalankan smoke test dan E2E.
5. Promote image yang sama ke production.
6. Monitor web, worker, database, queue, storage, dan AI.
7. Rollback image jika perlu.

### 16.9 Referensi teknis deployment

- [TanStack Start — Hosting on Cloudflare Workers](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)
- [Cloudflare — TanStack Start framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- [Cloudflare Hyperdrive with Drizzle ORM](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/)
- [Cloudflare Images direct creator upload](https://developers.cloudflare.com/images/storage/upload-images/direct-creator-upload/)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Moonrepo — Setup workspace](https://moonrepo.dev/docs/setup-workspace)
- [Moonrepo — Create and configure projects](https://moonrepo.dev/docs/create-project)
- [Moonrepo — Create and configure tasks](https://moonrepo.dev/docs/create-task)
- [OpenRouter Data Collection](https://openrouter.ai/docs/guides/privacy/data-collection)
- [OpenRouter Zero Data Retention](https://openrouter.ai/docs/guides/features/zdr)
- [OpenRouter Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [OpenRouter API Authentication](https://openrouter.ai/docs/api/reference/authentication)

---

## 17. Rencana Milestone

Estimasi berikut cocok sebagai baseline satu semester untuk tim kecil. Sesuaikan berdasarkan jumlah anggota dan kalender akademik.

| Milestone | Fokus | Estimasi relatif | Output demonstrable |
|---|---|---:|---|
| M0 | Alignment dan design | 1 minggu | Rules, architecture, wireframe |
| M1 | Foundation, database, auth | 1–2 minggu | Login, RBAC, master data |
| M2 | Core reporting | 1–2 minggu | Reporter submit dan admin melihat report |
| M3 | Upload dan workflow | 2 minggu | Ticket bergerak sampai closed |
| M4 | Facility, history, notification | 1 minggu | Status aset admin 3-state, maintenance history, dan notifikasi |
| M5 | Dashboard dan analytics | 1 minggu | Overview, metric konsisten, dan UI No. 11 (Dashboard/Scoring/Laporan Maintenance/PDF) |
| M6 | AI verifikasi sinkron + klasifikasi + prioritas final | 1 minggu | Verifikasi otomatis AI saat submit (UI No. 2) |
| M7 | Hardening dan UAT | 1–2 minggu | Staging siap demo/pilot |

Jika jadwal tertekan, potong scope dengan urutan:

1. historical AI insight;
2. P2 UX enhancement/export;
3. advanced notification UI;
4. chart tambahan.

Jangan memotong verifikasi AI (gerbang submit), authorization, audit timeline, state validation, secure upload, atau core workflow.

Jangan memotong authorization, audit timeline, state validation, secure upload, atau core workflow.

---

## 18. Pembagian Kerja Tim yang Disarankan

Untuk tim tiga orang:

### Stream A — Domain and Backend

- schema/migration;
- report use cases;
- workflow/state machine;
- authorization;
- analytics query;
- outbox/worker.

### Stream B — Reporter and Admin UI

- design system;
- reporter form/list/detail;
- admin table/detail/workflow controls;
- facility status;
- dashboard;
- accessibility/responsive states.

### Stream C — Infrastructure, QA, and AI

- local/deployment environment;
- object storage/upload pipeline;
- CI/test infrastructure;
- AI adapter/worker;
- observability;
- E2E/security test.

Koordinasi wajib:

- kontrak schema dan API ditetapkan sebelum UI dan backend berjalan paralel;
- migration hanya memiliki satu pemilik pada satu waktu;
- setiap vertical slice direview end-to-end;
- semua anggota menggunakan seed scenario dan acceptance criteria yang sama.

Untuk solo developer, kerjakan berurutan sesuai Phase 0–9; jangan mengerjakan seluruh UI terlebih dahulu baru backend.

---

## 19. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Scope terlalu besar | MVP tidak selesai | Kunci P0/P1/P2; core workflow menjadi release gate; yang dipotong terakhir adalah insight historis, bukan verifikasi |
| Reporter membaca data pengguna lain | Pelanggaran privasi | Ownership filter pada server dan IDOR E2E test |
| Upload berbahaya/public | Security incident | Allowlist, magic-byte validation, re-encode, private storage, signed access |
| Status tidak konsisten | Timeline dan analytics salah | Central state machine, transaction, event append-only |
| Dua admin menimpa update | Data hilang | Optimistic locking dan conflict response |
| AI hallucination | Keputusan salah | Structured output, taxonomy validation, eval dataset, threshold UMPER (hasil AI final; UI No. 2) |
| OpenRouter outage/cost | Verdict tertunda atau biaya tinggi | Verifikasi sinkron dengan timeout, klasifikasi DOWN-vs-FAIL, penahanan + verifikasi manual, credit limit, usage/cost metric |
| Data dikirim berlebihan ke OpenRouter/provider | Risiko privasi | Data minimization, sanitization, ZDR, privacy notice, dan provider policy review |
| Metric berbeda antarhalaman | Admin tidak percaya dashboard | Satu definisi metric, shared query/service, fixture test |
| Facility status berbeda dari report | Informasi status aset admin salah | Derived status, bukan manual duplicate state |
| Teknisi tidak punya akun | Update terlambat | Admin menjadi recorder resmi; actor audit tetap admin; ukur delay sebagai evaluasi |
| Data awal terlalu sedikit untuk insight | Insight menyesatkan | Tampilkan sample size; historical insight ditunda; threshold bukan bukti kausal |
| Master data berubah | Histori kehilangan konteks | Archive, bukan delete; simpan snapshot penting pada report jika dibutuhkan |
| Workers Free kehabisan CPU/memory | SSR atau submit path AI gagal | Ukur bundle/runtime; gunakan Workers Paid atau pindahkan submit path/worker ke Node |
| OpenRouter merutekan request ke endpoint non-ZDR | Data dapat disimpan provider | Wajib `zdr: true`, `data_collection: deny`, account privacy setting, dan provider allowlist |
| PostgreSQL connection tidak efisien dari Workers | Latency atau connection exhaustion | Gunakan Hyperdrive, driver yang didukung, client per invocation, dan query/index review |
| Queue dan database tidak atomic | Job notifikasi hilang atau terkirim ganda | Transactional outbox, reconciliation, dan idempotent consumer |
| OpenRouter API key bocor | Penyalahgunaan dan biaya tidak terkendali | Workers Secret, key terpisah per environment, credit limit, rotation, dan secret scanning |
| Model/provider berubah perilaku | Kualitas klasifikasi turun | Pin exact model slug, version prompt, evaluation dataset, dan approval sebelum perubahan |
| Cloudflare vendor coupling | Migrasi deployment mahal | Port/adapters untuk database, queue, storage, config, dan AI runtime |

---

## 20. Seed Data dan Demo Scenario

Buat seed data yang mendukung demo end-to-end:

### Users

- 1 admin UMPER;
- 2 reporter untuk authorization test;
- akun tambahan opsional untuk dosen/staf.

### Master data

- Gedung C → ruang kuliah nyata (contoh Ruang Kuliah 01) dan toilet;
- enam kategori aktif; tujuh issue type generik;
- asset agregat classroom (TV, HDMI, AC, lampu, stop kontak) + toilet;
- teknisi dummy (diganti data resmi sebelum production);
- bobot scoring v1 dari `facility-weights.csv`/`priority-thresholds.csv`/`location-usage.csv`.

### Demo scenario utama

1. Reporter login.
2. Reporter memilih Gedung → Lantai → Ruangan → Aset, menulis deskripsi, dan mengunggah foto (minimal 1).
3. Reporter menunggu verdict saat submit.
4. AI menetapkan HVAC, Bocor atau mampet, High + ticket VERIFIED diterbitkan.
5. Admin login dan langsung assign Budi (tanpa verifikasi manual).
6. Admin memindahkan ticket ke inspection lalu in repair.
7. Admin menambahkan catatan progres “menunggu sparepart”.
8. Reporter melihat notification dan timeline.
9. Admin menyelesaikan dan menutup ticket.
10. Status aset kembali operational (admin-only).
11. Ticket terlihat pada history aset.
12. Dashboard dan analytics berubah konsisten.

Gunakan scenario kedua dengan reporter berbeda untuk mendemonstrasikan bahwa ownership protection bekerja.

---

## 21. Dokumentasi yang Harus Menyertai Implementasi

1. `README` setup local dan command proyek;
2. environment variable reference;
3. architecture overview;
4. ERD/database schema;
5. transition matrix;
6. role/permission matrix;
7. API/use-case contract;
8. AI data-flow dan privacy note;
9. metric definitions;
10. deployment/runbook;
11. backup/restore guide;
12. UAT script;
13. known limitations dan out-of-scope.

---

## 22. Immediate Next Actions

Urutan tindakan setelah execution plan ini disetujui:

1. Kunci baseline TanStack Start + Drizzle + PostgreSQL + OpenRouter raw `fetch`.
2. Pilih managed PostgreSQL dan akun Cloudflare untuk staging.
3. Buat akun/workspace OpenRouter, nonaktifkan input/output logging dan data-use opt-in, lalu buat API key staging dengan credit limit.
4. Jalankan technical spike TanStack Start Worker, Hyperdrive, Images/R2, server-side OpenRouter submit path, dan Queue consumer untuk notifikasi.
5. Susun evaluation dataset 30–50 laporan dan pilih pinned model yang memenuhi threshold.
6. Jadwalkan workshop aturan operasional dengan UMPER.
7. Kunci auth mode, lifecycle, priority rubric, dan upload policy.
8. Finalisasi taxonomy lokasi, kategori, issue type, asset, dan teknisi awal.
9. Buat wireframe reporter dan admin berdasarkan route pada dokumen ini.
10. Susun ERD final dari model data awal.
11. Ubah Phase 1–9 menjadi issue/backlog dengan acceptance criteria.
12. Inisialisasi pnpm monorepo dengan Moonrepo, TanStack Start, CI, dan Wrangler staging.
13. Bangun vertical slice pertama: login → submit report → admin melihat report.
14. Demo setiap milestone menggunakan scenario AC Ruang 204.

Dokumen ini harus diperlakukan sebagai living plan. Perubahan aturan bisnis boleh dilakukan, tetapi transition matrix, data model, acceptance criteria, dan test terkait harus diperbarui bersamaan agar implementasi tidak menyimpang dari PRD.
