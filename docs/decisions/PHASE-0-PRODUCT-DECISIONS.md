# Phase 0 Product Decisions

Dokumen ini mencatat keputusan produk dan operasional yang disepakati sebelum feature coding dimulai.

Dokumen ini menjadi sumber kebenaran untuk keputusan Phase 0. Jika keputusan berubah, perbarui dokumen ini dan evaluasi dampaknya terhadap `EXECUTION-PLAN.md`, data model, acceptance criteria, dan test.

**Status:** Draft
**Owner:** TBD
**Reviewer/Approver:** UMPER/admin
**Tanggal mulai:** 2026-09-28
**Tanggal disetujui:** TBD

## Hubungan dengan Dokumen Lain

- `Tugas-Tugas Semester 7.md` adalah PRD yang menjelaskan konteks produk dan kebutuhan pengguna;
- `EXECUTION-PLAN.md` adalah terjemahan teknis dan tahapan implementasi dari PRD serta keputusan di dokumen ini;
- dokumen ini menjadi sumber kebenaran untuk keputusan produk/operasional. Rekomendasi teknis yang belum disahkan di sini harus diberi label provisional dan tidak boleh dianggap sebagai kebijakan final;
- setiap perubahan keputusan harus dievaluasi dampaknya terhadap PRD, execution plan, data model, acceptance criteria, dan test.

**Catatan sinkronisasi 2026-09-29:** authentication, role, lifecycle, duplicate detection, upload, notification, assignment teknisi, dan batas AI pada PRD serta execution plan telah diselaraskan dengan keputusan yang tercatat di bawah. Priority rubric, taxonomy master data, dan deployment profile masih `TBD` atau menunggu approval.

---

## Cara Menggunakan Dokumen Ini

Setiap keputusan sebaiknya mencatat:

- **Keputusan:** hasil final yang disepakati;
- **Alternatif yang dipertimbangkan:** opsi lain yang sempat dibahas;
- **Alasan:** pertimbangan pemilihan keputusan;
- **Dampak:** bagian sistem yang terpengaruh;
- **Approver:** pihak yang menyetujui;
- **Tanggal:** waktu keputusan ditetapkan.

Gunakan `TBD` untuk bagian yang belum diputuskan. Hapus `TBD` setelah keputusan disepakati.

---

## 1. Authentication dan Provisioning Akun

- **Keputusan:** Gunakan `MockSsoProvider` untuk seluruh environment pada MVP/pilot (termasuk production pilot). Integrasi `UpiSsoProvider` ditunda sampai akun SSO resmi tersedia. Akun mock awal: `admin@mock.upi.ac.id`, `230001@upi.ac.id`, dan `230002@upi.ac.id`.
- **Konsekuensi:** mock SSO bukan autentikasi nyata — siapa pun yang tahu alamat mock dapat masuk sebagai akun tersebut. Production pilot hanya boleh diakses terbatas (jaringan/internal kampus) dan wajib migrasi ke SSO UPI sebelum dibuka ke publik.
- **Alternatif yang dipertimbangkan:** akun lokal penuh / langsung mengintegrasikan SSO UPI sejak awal / Mock SSO
- **Alasan:** Tim dapat membangun dan menguji workflow dengan kontrak SSO tanpa menunggu konfigurasi provider UPI yang lebih kompleks.
- **Dampak:** application layer menggunakan kontrak SSO yang sama untuk semua environment; provider dapat diganti melalui konfigurasi runtime.
- **Kontrak provider:** provider mengembalikan `externalUserId`, nama, email, NIM, role, dan status akun aktif.
- **Akun mock awal:** `admin@mock.upi.ac.id`, `230001@upi.ac.id`, dan `230002@upi.ac.id`.
- **Konfigurasi environment:** `AUTH_PROVIDER=mock` untuk seluruh environment selama MVP/pilot.
- **Guard production:** guard penolakan mock di production dinonaktifkan selama pilot; aktifkan kembali saat migrasi ke SSO UPI.
- **Security:** Mock SSO tidak menggunakan password palsu sebagai pengganti SSO; session cookie dan authorization server-side tetap digunakan.
- **Approver:** Project owner; persetujuan UMPER/admin untuk production masih pending.
- **Tanggal:** 2026-09-28

## 2. Role dan Authorization

- **Keputusan:** Sistem hanya memiliki dua role: `ADMIN` dan `REPORTER`.
- **Role yang digunakan:**
	- `ADMIN`: UMPER;
	- `REPORTER`: mahasiswa dan civitas akademika lainnya.
- **Hak akses utama reporter:** login, membuat laporan, melihat detail laporan miliknya, melihat public progress update, menerima notification, dan melihat daftar laporan fasilitas yang sedang berlangsung.
- **Hak akses utama admin:** melihat seluruh laporan, menentukan valid/tidak valid/duplikat, menetapkan klasifikasi dan priority final, mengubah status, memperbarui progress, menugaskan teknisi, menambahkan public update/internal note, mengelola master data, dan melihat analytics.
- **Public ongoing reports:** reporter boleh melihat daftar laporan yang sedang berlangsung dalam bentuk projection tersanitasi yang memuat kategori, lokasi/fasilitas, status, priority, waktu laporan, dan public update.
- **Data yang tidak boleh terlihat pada public ongoing reports:** nama/NIM reporter, data pribadi, internal note, attachment pribadi, dan deskripsi sensitif.
- **Alasan:** Dua role cukup untuk MVP; UMPER memiliki kontrol operasional penuh, sedangkan civitas akademika dapat melapor dan memperoleh transparansi tanpa mengakses data privat reporter lain.
- **Dampak:** authorization wajib diterapkan di server; detail laporan menggunakan ownership check; public ongoing reports menggunakan projection khusus yang disanitasi.
- **Approver:** Project owner; persetujuan UMPER/admin masih pending.
- **Tanggal:** 2026-09-28

## 3. Lifecycle dan Status Laporan

- **Keputusan:** Gunakan lifecycle terkontrol. Hanya `ADMIN`/UMPER yang dapat mengubah status; reporter hanya dapat melihat status dan progress update yang berhak dilihat.
- **Status yang digunakan:** `REPORTED`, `VERIFIED`, `ASSIGNED`, `INSPECTION`, `IN_REPAIR`, `RESOLVED`, `CLOSED`, `REJECTED`, dan `DUPLICATE`.
- **Transition matrix:**
	- `REPORTED` → `VERIFIED`, `REJECTED`, atau `DUPLICATE`;
	- `VERIFIED` → `ASSIGNED`;
	- `ASSIGNED` → `INSPECTION`;
	- `INSPECTION` → `IN_REPAIR` atau `RESOLVED`;
	- `IN_REPAIR` → `RESOLVED`;
	- `RESOLVED` → `CLOSED` atau `IN_REPAIR`;
	- `CLOSED`, `REJECTED`, dan `DUPLICATE` adalah status terminal.
- **Syarat transition:**
	- `VERIFIED` wajib memiliki final category, final issue type, asset/lokasi tervalidasi, dan final priority;
	- `ASSIGNED` wajib memiliki teknisi aktif;
	- `RESOLVED` wajib memiliki resolution note;
	- `DUPLICATE` wajib memiliki referensi ticket utama;
	- `REJECTED` wajib memiliki alasan penolakan;
	- setiap perubahan status dicatat pada timeline dan audit log.
- **Aturan penutupan/reopen:** `RESOLVED` dapat dikembalikan ke `IN_REPAIR` jika masalah belum selesai. `CLOSED`, `REJECTED`, dan `DUPLICATE` tidak dapat diubah kembali pada MVP.
- **Alasan:** Lifecycle terkontrol mencegah perpindahan status yang tidak valid dan membuat proses maintenance mudah dilacak.
- **Dampak:** state machine, timeline, notification, progress notes, analytics, dan admin workflow.
- **Approver:** Project owner; persetujuan UMPER/admin masih pending.
- **Tanggal:** 2026-09-28

## 4. Duplicate Detection

- **Keputusan:** Gunakan deterministic duplicate detection untuk menemukan laporan aktif yang kemungkinan merupakan insiden yang sama. Sistem memberikan peringatan; keputusan akhir tetap berada pada `ADMIN`/UMPER.
- **Identitas reporter:** Gunakan `reporter_id` dari akun SSO yang terhubung dengan NIM terverifikasi. Reporter tidak mengetik NIM secara manual di form.
- **Definisi insiden yang sama:** reporter/NIM sama dan hal yang dilaporkan sama, direpresentasikan oleh asset atau lokasi, kategori, dan issue type yang sama, serta laporan sebelumnya masih aktif.
- **Status yang dianggap aktif:** `REPORTED`, `VERIFIED`, `ASSIGNED`, `INSPECTION`, dan `IN_REPAIR`. Status `RESOLVED` sudah dianggap selesai sehingga tidak menjadi laporan aktif.
- **Jendela waktu:** pencarian kandidat dapat menggunakan lookback default 14 hari untuk efisiensi, tetapi laporan aktif yang memenuhi kriteria tetap harus terdeteksi walaupun melewati lookback tersebut.
- **Deskripsi:** deskripsi bukan penentu utama. Sistem dapat menormalisasi dan membandingkan deskripsi sebagai sinyal pendukung; deskripsi yang berbeda tetap dapat menjadi kandidat jika field terstruktur sama, sedangkan deskripsi saja tidak cukup untuk menetapkan duplikat.
- **Perilaku saat kandidat ditemukan:** tampilkan duplicate warning beserta referensi ticket utama. Reporter dapat membuka ticket lama atau tetap melanjutkan jika masalahnya berbeda; sistem tidak langsung memblokir submit.
- **Keputusan final:** hanya `ADMIN`/UMPER yang dapat mengonfirmasi `DUPLICATE`, memilih `canonicalReportId`, atau membatalkan dugaan duplikat.
- **Reporter berbeda:** laporan dari reporter berbeda yang merujuk pada fasilitas dan issue yang sama bukan `DUPLICATE`; laporan tetap disimpan dan dapat ditautkan sebagai `SUPPORTING` atau `RELATED` report ke ticket utama. Jumlah reporter berbeda menjadi indikator dampak, bukan pekerjaan perbaikan baru.
- **Aturan laporan setelah ticket `CLOSED`:** reporter boleh membuat laporan baru karena kerusakan dapat terjadi kembali. Laporan `CLOSED` tidak menjadi penghalang duplicate detection.
- **Relasi duplicate:** laporan berstatus `DUPLICATE` wajib menyimpan `duplicate_of_report_id` yang menunjuk ke ticket utama.
- **Alasan:** Mencegah laporan insiden yang sama berulang tanpa menghalangi pelaporan kerusakan baru atau variasi masalah pada fasilitas yang sama.
- **Dampak:** create report, duplicate warning, admin verification, database relation, ownership, dan audit trail.
- **Approver:** Project owner; persetujuan UMPER/admin masih pending.
- **Tanggal:** 2026-09-29

## 5. Priority Rubric dan Scoring

- **Keputusan:** Setiap laporan memperoleh skor prioritas deterministik dan
  salah satu level `HIGH`, `MEDIUM`, atau `LOW`. Skor menjadi rekomendasi
  awal; `ADMIN`/UMPER menetapkan `finalPriority`.
- **Dimensi skor:** bobot kategori aset, bobot aset/fasilitas, dan bobot lokasi.
  Bobot lokasi meningkat berdasarkan frekuensi penggunaan ruangan untuk
  kegiatan perkuliahan.
- **Nilai bobot:** disimpan pada konfigurasi master data agar dapat diubah
  tanpa mengubah histori laporan. Baseline provisional (menunggu kalibrasi
  UMPER/admin): kategori 0–40 + aset/fasilitas 0–30 + lokasi 0–30, total
  0–100.
- **Mapping skor ke priority:** `HIGH`, `MEDIUM`, atau `LOW`. Baseline
  provisional: `LOW` 0–39, `MEDIUM` 40–69, `HIGH` 70–100; ambang final masih
  menunggu kalibrasi bersama UMPER/admin. Tidak ada level `CRITICAL`.
- **Safety override:** laporan dengan issue type `DANGEROUS` memperoleh minimal
  `HIGH`; tidak boleh menghapus alasan skor atau histori keputusan admin.
- **Peran AI:** saran faktor/prioritas, bukan keputusan final
- **Peran admin:** menetapkan `finalPriority` dan alasan override bila diperlukan
- **Alasan:** Prioritas perlu mempertimbangkan jenis aset, tingkat pentingnya
  aset, dan seberapa sering lokasi digunakan untuk perkuliahan.
- **Dampak:** data model, scoring service, AI contract, dan analytics
- **Approver:** TBD
- **Tanggal:** TBD

## 6. Master Data Fasilitas dan Lokasi

- **Keputusan:** Gunakan `rooms_lengkap.csv` sebagai acuan ruangan terverifikasi.
  Semua gedung dan ruangan saat ini dianggap aktif. Fasilitas dimodelkan
  sebagai aset agregat per ruangan, bukan unit individual.
- **Hierarki lokasi:** kampus → gedung → lantai → ruangan → fasilitas agregat.
- **Kategori fasilitas:** gunakan taxonomy pada `facility-categories.csv`:
  enam kategori aktif (listrik/lampu, AC/pendingin, furniture/pintu/jendela,
  elektronik/komputer/jaringan, toilet/sanitasi, lainnya); kode lama
  dipertahankan nonaktif.
- **Issue type:** gunakan taxonomy pada `issue-types.csv`: tujuh jenis generik
  yang berlaku untuk semua kategori (rusak, tidak berfungsi, hilang, kotor,
  bocor/mampet, berbahaya, lainnya); kode spesifik lama dipertahankan
  nonaktif.
- **Asset/facility criticality:** tidak ada enum criticality terpisah; menjadi
  bobot numerik kategori (0–40) dan aset (0–30) pada `facility-weights.csv`
  v1; kalibrasi final menunggu UMPER/admin.
- **Aturan archive/nonaktif:** gedung, ruangan, fasilitas, kategori, dan teknisi
  dinonaktifkan secara soft-delete; histori laporan tidak dihapus.
- **Pengecualian yang diputuskan:** Ballroom Gedung C sementara menggunakan
  enam AC central; ruang kelas (nama mengandung `KULIAH`, 27 ruangan) memiliki
  TV, HDMI, papan tulis, meja dosen, kursi mahasiswa agregat, lampu agregat,
  empat stop kontak, dan AC sesuai gedung; Lab IoT memiliki profil komputer
  agregat dengan jumlah unit menunggu inventaris; urinal hanya ada pada toilet
  pria (toilet wanita dan difabel tanpa urinal; tiga toilet generik menunggu
  survei); ruang lift hanya dilaporkan via alur admin; gedung satu lantai
  (B, D, E, F, G, J) memakai `floor_number=1`.
- **Alasan:** Master data harus cukup terstruktur untuk form pelaporan dan
  scoring, tetapi tidak membebani sistem dengan inventaris kursi/lampu/unit
  individual.
- **Dampak:** master data, report form, dan facility status
- **Approver:** TBD
- **Tanggal:** TBD

## 7. Public Update dan Internal Note

- **Keputusan:** Sediakan progress notes yang terpisah dari status laporan. Setiap note memiliki visibility `PUBLIC` atau `INTERNAL`.
- **Public update dapat dilihat oleh:** reporter pemilik laporan dan public ongoing reports dalam bentuk sanitasi.
- **Internal note dapat dilihat oleh:** `ADMIN`/UMPER saja.
- **Contoh public update:** teknisi sedang melakukan inspeksi, menunggu sparepart, membeli komponen pengganti, atau perbaikan sedang berlangsung.
- **Contoh internal note:** estimasi biaya, vendor, kendala internal, evaluasi teknisi, atau informasi sensitif lainnya.
- **Aturan status:** status tetap menunjukkan tahap besar lifecycle; progress note menjelaskan aktivitas spesifik yang sedang dilakukan.
- **Aturan mandatory note:** `RESOLVED` wajib memiliki resolution note; transition lain dapat mewajibkan note sesuai aturan workflow final.
- **Aturan koreksi histori:** semua note append-only; koreksi dilakukan dengan menambahkan note baru, bukan menghapus atau mengubah histori lama.
- **Penulis note:** hanya `ADMIN`/UMPER yang dapat menambahkan public update atau internal note pada MVP; reporter hanya dapat membaca update yang berhak dilihat.
- **AI:** tidak boleh membuat atau mempublikasikan progress note secara otomatis.
- **Alasan:** Reporter membutuhkan informasi progres yang lebih spesifik daripada status umum seperti `IN_REPAIR`, tanpa membuka catatan internal.
- **Dampak:** authorization, timeline, reporter portal, admin workflow, dan notification.
- **Approver:** Project owner; persetujuan UMPER/admin masih pending.
- **Tanggal:** 2026-09-28

## 8. Assignment dan Data Teknisi

- **Keputusan:** Teknisi tidak perlu memiliki akun pada MVP. Teknisi menjadi master data yang dikelola oleh `ADMIN`/UMPER.
- **Apakah teknisi memiliki akun:** Tidak pada MVP. Teknisi tidak login dan tidak mengubah status atau progress secara langsung.
- **Data teknisi yang disimpan:** nama tampilan, spesialisasi, dan status aktif/nonaktif.
- **Data awal:** gunakan lima teknisi dummy pada `data/master/technicians.csv`
  untuk pengembangan dan pengujian MVP; data ini bukan data production.
- **Data teknisi yang terlihat reporter:** hanya nama tampilan teknisi jika ditampilkan. Spesialisasi, status internal, dan data pribadi tidak ditampilkan kepada reporter.
- **Aturan assignment:** hanya `ADMIN`/UMPER yang dapat menugaskan teknisi; hanya teknisi aktif yang dapat dipilih; satu laporan memiliki satu teknisi aktif pada satu waktu.
- **Aturan reassignment:** reassignment diperbolehkan. Histori assignment lama tidak dihapus, dan alasan pergantian dicatat.
- **Aturan progress:** UMPER/admin menerima informasi dari teknisi lalu mencatat public update atau internal note. Actor pada audit/timeline tetap UMPER/admin.
- **Alasan:** MVP tetap sederhana tanpa menambah role dan alur login teknisi, sementara assignment dan histori maintenance tetap dapat dikelola dengan jelas.
- **Dampak:** assignment, audit, timeline, notification, technician master data, dan reporter visibility.
- **Approver:** UMPER/admin.
- **Tanggal:** 2026-09-29

## 9. Upload dan Retensi File

- **Keputusan:** Reporter dapat mengambil foto langsung melalui kamera perangkat atau memilih foto yang sudah tersimpan. Upload video tidak termasuk scope MVP.
- **Format file:** JPEG, PNG, dan WebP. SVG, executable, file rusak, dan MIME palsu ditolak.
- **Batas ukuran/jumlah:** maksimal 5 MB per file dan maksimal 3 foto per laporan.
- **Storage:** private object storage dengan storage key acak. Foto tidak boleh tersedia melalui public permanent URL.
- **Akses:** hanya reporter pemilik laporan dan `ADMIN`/UMPER yang dapat melihat foto. Foto tidak ditampilkan pada public ongoing reports atau kepada reporter lain.
- **Penggunaan internal:** foto boleh digunakan untuk laporan operasional, maintenance history, analytics, dan evaluasi internal.
- **Retensi:** foto disimpan selama laporan aktif dan maksimal satu tahun setelah laporan berstatus `CLOSED`. Setelah masa retensi berakhir, file binary dihapus sesuai cleanup policy; metadata laporan dan audit tetap dipertahankan.
- **Metadata/EXIF:** metadata EXIF dihapus saat processing. Sistem memvalidasi extension, MIME, magic bytes, dan hasil decode image.
- **Alasan:** Foto cukup untuk bukti kerusakan MVP, camera capture memudahkan pelaporan lapangan, dan batas retensi membatasi penyimpanan data yang tidak lagi diperlukan.
- **Dampak:** upload validation, storage, privacy, cleanup job, report detail, maintenance history, dan analytics internal.
- **Approver:** UMPER/admin.
- **Tanggal:** 2026-09-29

## 10. Notification

- **Keputusan:** Gunakan in-app notification pada MVP. Email, WhatsApp, push notification, dan channel eksternal lainnya berada di luar scope MVP.
- **Channel MVP:** In-app notification dengan status unread/read dan link ke laporan terkait.
- **Penerima:** reporter pemilik laporan menerima notification untuk laporan miliknya. `ADMIN`/UMPER melihat laporan baru dan pekerjaan yang perlu ditindaklanjuti melalui dashboard/unread count.
- **Event yang menghasilkan notification:** laporan diverifikasi, teknisi ditugaskan, status berubah, public update ditambahkan, laporan ditandai `DUPLICATE` oleh admin, laporan `RESOLVED`, dan laporan `CLOSED`.
- **Aturan visibility:** internal note tidak mengirim notification kepada reporter. Duplicate warning saat pengisian form ditampilkan langsung di UI, bukan sebagai notification asynchronous.
- **Fitur reporter:** reporter dapat melihat daftar notification, membuka laporan terkait, dan menandai notification sebagai sudah dibaca.
- **Aturan retry dan idempotency:** notification dibuat melalui outbox/job, diproses idempotently menggunakan kombinasi event, penerima, dan tipe notification, serta dapat retry otomatis maksimal tiga kali sebelum masuk failed/dead-letter state.
- **Alasan:** Reporter memperoleh transparansi perubahan laporan tanpa menambah kompleksitas integrasi email atau WhatsApp pada MVP.
- **Dampak:** outbox, worker, notification table, dashboard, reporter portal, dan auditability.
- **Approver:** UMPER/admin.
- **Tanggal:** 2026-09-29

## 11. AI dan Privacy

- **Keputusan:** AI hanya digunakan sebagai decision-support untuk membantu verifikasi awal laporan dan memberikan rekomendasi prioritas. AI tidak memiliki kewenangan untuk menetapkan hasil akhir, mengubah status, menolak laporan, menandai laporan sebagai duplikat, atau menetapkan `finalPriority`.
- **Scope AI MVP:** rekomendasi validitas laporan, indikasi potensi duplikat sebagai sinyal tambahan, suggested priority, faktor risiko/dampak, dan alasan singkat untuk ditinjau admin.
- **Klasifikasi final:** kategori dan issue type ditentukan oleh `ADMIN`/UMPER berdasarkan master data dan hasil verifikasi; AI tidak mengisi atau mengubah klasifikasi final.
- **Keputusan final:** `ADMIN`/UMPER wajib menetapkan hasil verifikasi dan `finalPriority`. Jika berbeda dari rekomendasi AI atau skor deterministik, alasan override wajib dicatat.
- **Data yang boleh dikirim ke provider:** deskripsi laporan yang telah diminimalkan/disanitasi, label lokasi yang aman jika diperlukan, rubric priority, dan taxonomy code/label yang dibutuhkan untuk konteks verifikasi; tanpa identitas reporter.
- **Data yang dilarang dikirim:** PII reporter, NIM, attachment, internal note, dan secret
- **Model/provider:** provider yang mendukung structured output dan kebijakan Zero Data Retention, dipanggil secara asynchronous melalui worker.
- **Privacy policy/ZDR:** data minimization wajib; logging input/output provider dinonaktifkan bila tersedia; routing `data_collection: deny` dan `zdr: true` digunakan; API key disimpan sebagai secret server-side.
- **Peran human review:** wajib sebelum hasil verifikasi dan prioritas final; confidence AI tidak boleh memicu keputusan otomatis.
- **Fallback:** jika AI tidak tersedia, confidence rendah, atau data tidak cukup, laporan tetap diproses secara manual.
- **Alasan:** AI membantu mengurangi beban review tanpa mengotomatisasi keputusan operasional yang berdampak pada reporter dan maintenance.
- **Dampak:** AI worker, privacy notice, audit keputusan/override, cost, dan fallback manual.
- **Approver:** UMPER/admin
- **Tanggal:** 2026-09-29

## 12. Deployment dan Environment

- **Keputusan deployment utama:** lokal saja untuk pilot (container di mesin development; VPS/server kampus dan Cloudflare ditunda sampai pilot selesai)
- **Local environment:** TBD
- **Staging environment:** TBD
- **Production/pilot environment:** TBD
- **Database:** TBD
- **Storage:** TBD
- **Queue/worker:** TBD
- **Secret management:** TBD
- **Alasan:** TBD
- **Dampak:** architecture, cost, operations, dan CI/CD
- **Approver:** TBD
- **Tanggal:** TBD

---

## Daftar Tindak Lanjut

| No. | Tindak lanjut | Owner | Deadline | Status |
|---:|---|---|---|---|
| 1 | Menjadwalkan workshop dengan UMPER/admin | TBD | TBD | OPEN |
| 2 | Mengisi keputusan authentication dan role | TBD | TBD | OPEN |
| 3 | Mengisi transition matrix final | TBD | TBD | OPEN |
| 4 | Mengisi duplicate detection policy | TBD | TBD | OPEN |
| 5 | Mengisi priority rubric dan criticality fasilitas | Project team | 2026-10-10 | BASELINE v1 SET (kalibrasi UMPER menyusul) |
| 6 | Memfinalisasi taxonomy lokasi, kategori, issue type, asset, dan teknisi | TBD | TBD | OPEN |
| 7 | Memilih deployment profile | TBD | TBD | OPEN |
| 8 | Menyetujui acceptance criteria MVP | TBD | TBD | OPEN |

## Riwayat Perubahan

| Tanggal | Perubahan | Author | Approver |
|---|---|---|---|
| 2026-09-28 | Membuat template keputusan Phase 0 | TBD | TBD |
