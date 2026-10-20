# Lampiran B.3. Status Fitur yang Dikembangkan

## B.3.1 Tujuan dan Dasar Penilaian

Lampiran ini mencatat fitur yang sudah dikembangkan pada prototipe SILAPOR beserta statusnya. Penilaian dilakukan pada commit `18b7611` tanggal 20 Oktober 2026 dengan memeriksa empat bukti:

1. halaman pada `apps/web/src/routes`,
2. endpoint pada `apps/web/src/routes/api`,
3. akses data pada `packages/database`, `packages/ai`, dan `packages/storage`,
4. berkas uji otomatis pada setiap paket.

Status menilai kelengkapan jalur fitur, bukan kualitas kode. Fitur dinilai selesai jika pengguna dapat menjalankan alur dari antarmuka sampai data tersimpan, dan aturan utamanya ditutup oleh uji otomatis.

## B.3.2 Definisi Status

Tabel B.3.1. Kriteria status

| Status | Kriteria | Cara pembuktian |
|---|---|---|
| Selesai | Halaman dan endpoint tersedia, data berasal dari basis data atau layanan nyata, ada uji otomatis | Rute, endpoint, dan berkas uji ditemukan |
| Dalam proses | Sebagian jalur tersedia: antarmuka tanpa endpoint, endpoint tanpa antarmuka, data contoh, atau stub | Penanda "menyusul", tombol nonaktif, atau data mock pada berkas |
| Belum dimulai | Belum ada halaman, endpoint, maupun tabel pendukung | Tidak ada berkas rute atau endpoint |
| Di luar lingkup | Sengaja tidak dikerjakan pada MVP | Tercatat pada `EXECUTION-PLAN.md` bagian 5.4 |

## B.3.3 Ringkasan Status

Tabel B.3.2. Rekapitulasi status fitur

| Status | Jumlah | Persentase |
|---|---:|---:|
| Selesai | 35 | 74% |
| Dalam proses | 6 | 13% |
| Belum dimulai | 6 | 13% |
| **Total dalam lingkup** | **47** | **100%** |
| Di luar lingkup | 11 | Tidak dihitung |

Angka pada tabel dihitung dari Tabel B.3.3, B.3.4, dan B.3.5. Fitur di luar lingkup dipisahkan pada Tabel B.3.6 agar tidak tercampur dengan fitur yang direncanakan tetapi belum dikerjakan.

## B.3.4 Fitur Inti (P0)

Tabel B.3.3. Status fitur inti

| No | Fitur | Status | Bukti | Catatan |
|---:|---|---|---|---|
| 1 | Login dan kendali akses berbasis peran | Selesai | `routes/login.tsx`, `api/auth/`, `packages/auth/src/policy.ts`, `server/guard.ts` | Sesi cookie, peran `ADMIN` dan `REPORTER` |
| 2 | Master data lokasi | Selesai | `admin.locations.tsx`, `api/admin/locations*`, `database/master-data.ts` | Termasuk hierarki gedung, lantai, ruang |
| 3 | Master data kategori dan issue type | Selesai | `admin.categories.tsx`, `api/admin/categories*`, `api/admin/issue-types*` | Bobot kategori dan issue type |
| 4 | Master data aset fasilitas | Dalam proses | `api/admin/assets*` (GET, POST, PATCH), `admin.facilities.index.tsx` | Endpoint lengkap, antarmuka menampilkan status fasilitas dan riwayat aset, belum ada formulir tambah atau ubah |
| 5 | Master data teknisi | Selesai | `admin.technicians.tsx`, `api/admin/technicians*` | Daftar, tambah, ubah, arsip |
| 6 | Submit laporan dengan verifikasi AI | Selesai | `reporter.reports.new.tsx`, `api/reports.ts`, `packages/ai/src/verify.ts` | Verifikasi berjalan sinkron saat submit |
| 7 | Unggah dan pemrosesan foto | Selesai | `api/uploads.ts`, `packages/storage/src/attachments.ts` | Maksimal 3 foto, 5 MB per berkas |
| 8 | Nomor tiket unik | Selesai | Tabel `ticket_counters`, `formatTicketNumber` di `packages/domain` | Format tahun dan nomor urut |
| 9 | Daftar dan detail laporan reporter | Selesai | `reporter.reports.*`, `api/reports*`, `server/reports.ts` | Termasuk daftar kampus tersanitasi dan filter `mine=1` |
| 10 | Daftar dan detail laporan admin | Selesai | `admin.reports.*`, `api/admin/reports*` | Seluruh laporan, termasuk yang ditahan |
| 11 | Idempotency submit | Selesai | `x-idempotency-key` di `server/reports.ts`, uji e2e nomor 6 | Submit ganda menghasilkan satu tiket |
| 12 | Deteksi duplikasi dan penggabungan otomatis | Selesai | `database/reports.ts` relasi `SUPPORTING`, `api/reports.duplicate-check.ts`, uji e2e nomor 7 | Penggabungan dalam transaksi yang sama |
| 13 | Verifikasi AI otomatis | Selesai | `packages/ai/src/verify.ts`, `packages/ai/src/schema.ts`, `server/reports.ts` | Hasil `PASS`, `FAIL`, atau `DOWN` |
| 14 | Penahanan saat AI down dan verifikasi manual | Selesai | `server/held.ts`, `api/admin/reports.$id.verify.ts` | Laporan ditahan sebagai `REPORTED` |
| 15 | Klasifikasi dan prioritas final | Selesai | `packages/ai/src/schema.ts`, `database/ai-analyses.ts` | Disimpan bersama confidence dan alasan |
| 16 | Penugasan teknisi | Selesai | `api/admin/reports.$id.assign.ts`, `database/workflow.ts` | Membawa `expectedVersion` |
| 17 | Transisi status | Selesai | `api/admin/reports.$id.transition.ts`, `packages/domain/src/index.ts` | Aturan transisi dan catatan wajib |
| 18 | Progress update dan timeline | Selesai | `api/admin/reports.$id.updates.ts`, `api/reports.$id.timeline.ts` | Timeline append-only |
| 19 | Riwayat maintenance per aset | Selesai | `api/admin/assets.$id.history.ts`, `admin.facilities.$assetId.tsx` | Riwayat laporan dan perbaikan |
| 20 | Status aset khusus admin | Selesai | `api/facilities.status.ts`, `server/facilities.ts` | Tidak terlihat oleh reporter |
| 21 | Audit trail | Selesai | Tabel `audit_logs` dan `report_events` di `database/schema.ts` | Mencatat perubahan status dan aksi admin |

Fitur inti terdiri dari 20 fitur selesai dan 1 fitur dalam proses. Satu-satunya kekurangan pada kelompok ini adalah antarmuka pengelolaan aset.


## B.3.5 Fitur Pendukung (P1 dan P2)

Tabel B.3.4. Status fitur pendukung

| No | Fitur | Status | Bukti | Catatan |
|---:|---|---|---|---|
| 22 | Dashboard admin | Selesai | `admin.index.tsx`, `api/admin/analytics.overview.ts` | Kartu ringkasan, antrean prioritas, beban tugas teknisi |
| 23 | Filter, pencarian, sorting, dan pagination | Selesai | `server/reports.ts` fungsi `parse*Query`, `admin.reports.index.tsx` | Diterapkan pada daftar laporan |
| 24 | Notifikasi dalam aplikasi | Selesai | `api/notifications*`, `database/notifications.ts` | Tandai satu atau semua sudah dibaca |
| 25 | Analytics kategori, lokasi, dan status | Selesai | `admin.analytics.tsx`, `packages/analytics/src/dashboard.ts` | Data dari basis data |
| 26 | Resolution time | Selesai | `getResolutionTimeMetrics` pada `analytics/dashboard.ts` | Rata-rata dan median |
| 27 | Perlindungan konkurensi 409 | Selesai | `expectedVersion` pada `server/workflow.ts` | Perubahan memakai optimistic locking |
| 28 | Pengaturan scoring | Dalam proses | `admin.scoring.tsx` | Data contoh, tombol simpan nonaktif, endpoint belum ada |
| 29 | Laporan maintenance tiga grafik | Dalam proses | `admin.maintenance-report.tsx` | Seluruh grafik dan tabel memakai data contoh |
| 30 | Ekspor PDF | Dalam proses | `admin.maintenance-report.tsx` baris 130 | Tombol dinonaktifkan, endpoint belum ada |
| 31 | Ekspor sederhana CSV | Belum dimulai | Tidak ada rute atau modul ekspor | Belum ada kode |
| 32 | Saved filters | Belum dimulai | Tidak ada rute atau modul penyimpanan filter | Belum ada kode |
| 33 | Historical insight minimal lima laporan | Belum dimulai | Tidak ada modul insight historis | Belum ada kode |
| 34 | Dashboard trend tambahan | Belum dimulai | Hanya tren pada laporan maintenance yang masih berupa data contoh | Belum ada kode |
| 35 | Duplicate handling UX lanjutan dan similarity | Belum dimulai | Deteksi duplikasi dasar sudah ada, skor kemiripan belum | Belum ada kode |

Fitur pendukung terdiri dari 6 fitur selesai, 3 fitur dalam proses, dan 5 fitur belum dimulai. Ketiga fitur dalam proses memiliki antarmuka yang sudah digambar, tetapi belum terhubung ke endpoint.

## B.3.6 Fitur Non-Fungsional dan Infrastruktur

Tabel B.3.5. Status fitur non-fungsional

| No | Fitur | Status | Bukti | Catatan |
|---:|---|---|---|---|
| 36 | Worker outbox | Selesai | `apps/worker/src/outbox-loop.ts`, `database/outbox-consumer.ts` | Polling tabel `outbox_events` |
| 37 | Endpoint kesehatan | Selesai | `api/health.ts`, `server/health.ts` | Empat pemeriksaan dengan sifat fail-open |
| 38 | Pipeline integrasi berkelanjutan | Selesai | `.github/workflows/` | Lint, typecheck, build, test |
| 39 | Uji end-to-end | Selesai | `apps/web/e2e/health.spec.ts`, `reports.spec.ts` | 10 skenario Playwright |
| 40 | Seed master data dari CSV | Selesai | `database/seed.ts`, `data/master/*.csv` | Idempoten |
| 41 | Adapter penyimpanan filesystem | Selesai | `storage/filesystem.ts` | Dipakai pada lingkungan pengembangan |
| 42 | Adapter penyimpanan S3 Garage | Selesai | `storage/s3.ts`, `storage/factory.ts` | Bucket privat, tanpa URL publik |
| 43 | Docker Compose lokal | Selesai | `docker-compose.yml`, `infra/garage/garage.toml` | PostgreSQL 16 dan Garage 2.3.0 |
| 44 | Halaman kebijakan privasi | Selesai | `routes/kebijakan-privasi.tsx` | Halaman statis |
| 45 | Beranda publik | Dalam proses | `routes/index.tsx` | Masih berisi contoh keadaan antarmuka dari tahap awal |
| 46 | SSO UPI | Dalam proses | `packages/auth/src/sso.ts` kelas `UpiSsoProvider` | Masih melempar "SSO UPI belum tersedia", provider aktif `mock` |
| 47 | Deployment Cloudflare | Belum dimulai | Tidak ada dependency Cloudflare atau Wrangler | Ditunda sampai keputusan deployment |

Fitur non-fungsional terdiri dari 9 fitur selesai, 2 fitur dalam proses, dan 1 fitur belum dimulai.


## B.3.7 Fitur di Luar Lingkup MVP

Tabel B.3.6. Fitur yang sengaja tidak dikerjakan

| No | Fitur | Alasan |
|---:|---|---|
| 1 | Portal teknisi | Teknisi dikelola oleh admin, belum ada akun terpisah |
| 2 | Aplikasi mobile native | MVP berbasis web yang menyesuaikan ukuran layar |
| 3 | IoT dan sensor real-time | Di luar cakupan pilot dan tidak ada perangkat pendukung |
| 4 | Predictive maintenance berbasis ML | Membutuhkan data historis dalam jumlah besar |
| 5 | Klasifikasi jenis kerusakan dari gambar | AI hanya menilai kelayakan bukti foto dan kecocokan deskripsi |
| 6 | Penjadwalan otomatis | Penugasan teknisi tetap dilakukan admin |
| 7 | Bot WhatsApp | Notifikasi hanya tersedia di dalam aplikasi |
| 8 | Tindakan AI otonom di luar verifikasi | Penugasan, perubahan status, dan penutupan tiket tetap di admin |
| 9 | Integrasi penuh sistem akademik UPI | Identitas masih memakai provider mock |
| 10 | Advanced SLA engine | Belum ada kebutuhan dan target waktu yang disepakati |
| 11 | Reopen flow | Dihapus berdasarkan Keputusan UI No. 8, alur bersifat satu arah |

## B.3.8 Catatan atas Fitur yang Belum Selesai

**Master data aset.** Endpoint `GET`, `POST`, dan `PATCH` pada `api/admin/assets*` sudah tersedia, termasuk pengarsipan melalui `is_active: false`. Halaman `admin.facilities.index.tsx` menampilkan status fasilitas, sedangkan riwayat aset ditampilkan pada `admin.facilities.$assetId.tsx`. Yang belum ada adalah formulir tambah dan ubah aset pada antarmuka admin.

**Pengaturan scoring.** Halaman `admin.scoring.tsx` sudah memuat bobot kategori, aset, lokasi, frekuensi, ambang prioritas, dan batas laporan per pelapor. Nilai yang ditampilkan masih contoh, tombol simpan dinonaktifkan, dan belum ada endpoint penyimpanan.

**Laporan maintenance.** Halaman `admin.maintenance-report.tsx` menampilkan tiga grafik dan tabel per periode, tetapi seluruh angka berasal dari konstanta di dalam berkas. Belum ada endpoint agregasi khusus laporan maintenance.

**Ekspor PDF.** Tombol ekspor tersedia secara visual, tetapi dinonaktifkan dan diberi keterangan bahwa endpoint belum tersedia.

**Beranda publik.** Berkas `routes/index.tsx` masih berisi contoh keadaan antarmuka dari tahap awal, yaitu keadaan memuat, kosong, galat, terlarang, dan sukses. Halaman ini belum menjadi etalase produk.

**SSO UPI.** Kelas `UpiSsoProvider` sudah ada sebagai kontrak, tetapi memanggilnya menghasilkan galat "SSO UPI belum tersedia". Provider yang aktif pada pilot adalah `MockSsoProvider`, sehingga pembatasan akses jaringan kampus tetap diperlukan.

**Deployment Cloudflare.** Seluruh kode berjalan pada Node.js dengan PostgreSQL dan Garage. Tidak ada dependency Cloudflare atau Wrangler di repositori. Perpindahan ke Cloudflare memerlukan adapter baru untuk basis data, penyimpanan, dan antrean.


## B.3.9 Hasil Verifikasi Otomatis

Status selesai diverifikasi dengan menjalankan seluruh pipeline uji pada 20 Oktober 2026. Perintah yang dipakai:

```bash
pnpm exec moon run :test
```

Tabel B.3.7. Hasil uji per paket

| Paket | Lulus | Dilewati |
|---|---:|---:|
| `apps/web` | 282 | 0 |
| `packages/database` | 209 | 1 |
| `packages/domain` | 60 | 0 |
| `packages/storage` | 53 | 2 |
| `packages/auth` | 43 | 0 |
| `packages/analytics` | 22 | 0 |
| `packages/ai` | 20 | 0 |
| `packages/shared` | 5 | 0 |
| `apps/worker` | 3 | 0 |
| `packages/jobs` | 2 | 0 |
| **Total** | **699** | **3** |

Tiga uji dilewati karena memerlukan layanan eksternal yang tidak aktif saat pemeriksaan, yaitu PostgreSQL untuk uji integrasi dan Garage untuk uji penyimpanan S3. Uji tersebut ditandai dengan `describe.skipIf` dan akan berjalan otomatis ketika `DATABASE_URL` atau `STORAGE_ENDPOINT` tersedia.

Pipeline berakhir dengan kode keluar 0. Rincian perintah, keluaran, dan waktu pemeriksaan dapat dilampirkan sebagai tangkapan layar bilaman diperlukan.

## B.3.10 Cara Memperbarui Lampiran

Saat status sebuah fitur berubah, perbarui baris pada tabel yang sesuai dan catat empat hal berikut:

1. tanggal perubahan,
2. commit yang memuat perubahan,
3. bukti baru berupa rute, endpoint, atau berkas uji,
4. alasan perubahan bila status turun, misalnya fitur ditarik dari lingkup.

Status tidak diubah tanpa bukti. Fitur yang antarmukanya sudah ada tetapi belum terhubung ke data tetap dinilai dalam proses, meskipun halaman tersebut tampak lengkap.

Perintah untuk memeriksa keberadaan bukti:

```bash
# Daftar halaman dan endpoint
find apps/web/src/routes -name '*.tsx' -not -name '*.test.tsx' | sort
find apps/web/src/routes/api -name '*.ts' | sort

# Daftar berkas uji per paket
find apps packages -path '*/src/*' \( -name '*.test.ts' -o -name '*.test.tsx' \) \
  -not -path '*/node_modules/*' | sort

# Penanda fitur yang belum terhubung
grep -rn "menyusul" apps/web/src/routes
```

## B.3.11 Ringkasan untuk Bab Pembahasan

Paragraf berikut dapat dipakai pada bab hasil dan pembahasan:

> Berdasarkan pemeriksaan pada Lampiran B.3, 35 dari 47 fitur dalam lingkup telah selesai (74%), 6 fitur berada dalam proses (13%), dan 6 fitur belum dimulai (13%). Seluruh fitur inti selesai, kecuali antarmuka pengelolaan aset yang baru mencakup status dan riwayat. Alur utama dari submit laporan, verifikasi AI, penugasan teknisi, sampai penutupan tiket dapat dijalankan. Tiga fitur pendukung, yaitu pengaturan scoring, laporan maintenance, dan ekspor PDF, sudah memiliki antarmuka tetapi belum terhubung ke endpoint. Sebelas fitur lain dinyatakan di luar lingkup MVP dan dipisahkan dari perhitungan.

