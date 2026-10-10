# **Product Requirements Document (PRD)**

## **Smart Campus Maintenance System**

### **UPI Kampus Tasikmalaya**

**Status:** Draft  
**Versi:** 0.1  
**Target:** Business Strategy \+ Prototype Development

## Cara Membaca Dokumen

Dokumen ini menjelaskan **apa dan mengapa** produk dibangun dari sudut pandang pengguna. Untuk konteks yang lengkap:

1. `docs/decisions/PHASE-0-PRODUCT-DECISIONS.md` adalah sumber kebenaran keputusan produk dan operasional yang sudah disepakati atau masih menunggu approval;
2. `EXECUTION-PLAN.md` menerjemahkan PRD dan keputusan Phase 0 menjadi arsitektur, tahapan implementasi, test, dan release gate;
3. jika ada perbedaan, keputusan Phase 0 mengalahkan rekomendasi teknis di execution plan, sedangkan bagian yang masih `TBD` belum boleh dianggap final.

---

# **1\. Product Overview**

**Smart Campus Maintenance System** adalah sistem informasi terpusat untuk membantu sivitas kampus, terutama mahasiswa, dalam **melaporkan kerusakan fasilitas kampus dan memantau status penanganannya**.

Di sisi pengelola fasilitas, sistem digunakan untuk **mengelola laporan, memantau kondisi fasilitas, menentukan prioritas, menugaskan teknisi, memperbarui progres perbaikan, serta melihat histori dan pola kerusakan fasilitas**.

Sistem dirancang untuk mengubah proses maintenance yang saat ini bersifat informal dan sulit dilacak menjadi proses yang:

* terpusat  
* terdokumentasi  
* transparan  
* dapat dipantau  
* berbasis data

AI digunakan sebagai **intelligence layer** untuk membantu review admin. AI memberi rekomendasi, sedangkan keputusan verifikasi, klasifikasi, prioritas, status, dan tindakan maintenance tetap berada pada admin/UMPER.

---

# **2\. Problem Statement**

Saat ini, ketika mahasiswa menemukan fasilitas kampus yang bermasalah, seperti:

* toilet tidak memiliki air  
* AC bocor  
* AC tidak dingin  
* AC tidak menyala  
* HDMI rusak  
* TV rusak  
* lampu rusak  
* dan fasilitas lainnya

mahasiswa umumnya mengetahui bahwa masalah tersebut dapat dilaporkan kepada **UMPER (Umum dan Peralatan)** karena kebiasaan atau pengetahuan informal.

Namun, belum terdapat mekanisme terpusat yang secara jelas mendefinisikan proses:

> **lapor → diverifikasi → ditangani → dipantau → selesai**

Permasalahan yang muncul antara lain:

### **2.1 Jalur pelaporan tidak terstandarisasi**

Mahasiswa mengetahui UMPER sebagai tempat melapor karena kebiasaan, tetapi tidak ada mekanisme digital yang secara eksplisit mengarahkan dan mencatat laporan secara terstruktur.

### **2.2 Pelapor tidak memiliki visibility terhadap proses perbaikan**

Setelah menyampaikan laporan, pelapor tidak dapat dengan mudah mengetahui:

* apakah laporan sudah diterima  
* apakah sudah diverifikasi  
* apakah sudah ditugaskan  
* siapa/teknisi yang menangani  
* apakah sedang diperbaiki  
* apa kendala perbaikannya  
* apakah sudah selesai

### **2.3 Informasi progres tidak terdokumentasi secara terpusat**

Update seperti:

> "Sedang menunggu sparepart."

atau

> "Teknisi sudah melakukan pengecekan."

belum memiliki ruang terstruktur untuk disampaikan dan didokumentasikan kepada pelapor.

### **2.4 Pengelola kesulitan memperoleh gambaran kondisi fasilitas**

Tanpa data terpusat, sulit menjawab pertanyaan seperti:

* fasilitas apa yang sedang bermasalah?  
* fasilitas apa yang paling sering rusak?  
* lokasi mana yang paling banyak mengalami masalah?  
* jenis kerusakan apa yang paling sering terjadi?  
* berapa lama rata-rata sebuah masalah diselesaikan?

### **2.5 Riwayat maintenance belum dimanfaatkan sebagai sumber insight**

Histori laporan sebenarnya dapat digunakan untuk mengetahui fasilitas yang memiliki frekuensi kerusakan tinggi dan membantu menentukan prioritas maintenance di masa depan.

---

# **3\. Product Vision**

> **Menciptakan sistem maintenance fasilitas kampus yang transparan, terdokumentasi, dan berbasis data sehingga pelapor dapat mengetahui perkembangan laporan dan pengelola fasilitas dapat mengambil keputusan maintenance secara lebih efektif.**

---

# **4\. Product Goals**

## **4.1 Untuk Pelapor**

Memberikan cara yang mudah untuk:

* melaporkan fasilitas bermasalah  
* memberikan detail dan bukti kerusakan  
* mengetahui status penanganan  
* melihat update dari pengelola  
* mengetahui fasilitas kampus yang sedang dalam perbaikan

## **4.2 Untuk Admin / Pengelola Fasilitas**

Memberikan kemampuan untuk:

* menerima dan mengelola laporan secara terpusat  
* memverifikasi laporan  
* menentukan prioritas  
* menugaskan teknisi  
* mencatat progres  
* mengelola data fasilitas  
* melihat histori maintenance  
* memperoleh insight dari data laporan

## **4.3 Untuk Sistem**

Memanfaatkan AI untuk:

* membantu klasifikasi laporan  
* membantu memberikan rekomendasi prioritas  
* mengekstrak informasi penting dari laporan  
* memberikan insight dari pola laporan yang telah terkumpul

---

# **5\. Target Users**

## **Primary User — Student / Campus Reporter**

Target utama adalah mahasiswa, tetapi sistem **tidak dibatasi hanya untuk mahasiswa**.

Pelapor dapat berupa:

* mahasiswa  
* dosen  
* tenaga kependidikan  
* sivitas kampus lainnya

## **Secondary User — Facility Administrator**

Admin/UMPER bertanggung jawab terhadap pengelolaan laporan dan maintenance.

## **Operational Actor — Technician**

Teknisi merupakan pihak yang melaksanakan perbaikan.

Pada MVP, teknisi **tidak memerlukan akun sendiri**. Admin menjadi pihak yang mencatat assignment dan update berdasarkan informasi dari teknisi.

---

# **6\. Core Product Concept**

Sistem mempunyai dua area utama:

                SMART CAMPUS  
             MAINTENANCE SYSTEM  
                       │  
          ┌────────────┴────────────┐  
          │                         │  
      REPORTER                    ADMIN  
          │                         │  
    Submit Report            Manage Reports  
    Track Status             Manage Facilities  
    View Campus Status       Assign Technician  
    View Updates             Update Progress  
                              Analytics

  ### Akses dan Peran

  MVP hanya memiliki dua role:

  * **REPORTER:** mahasiswa dan sivitas akademika lainnya yang dapat membuat laporan, melihat laporan miliknya, membaca update yang berhak dilihat, menerima notifikasi, dan melihat status fasilitas publik yang sudah disanitasi;
  * **ADMIN:** UMPER/pengelola fasilitas yang dapat melihat seluruh laporan, memverifikasi, menentukan klasifikasi dan prioritas final, mengubah status, menugaskan teknisi, mengelola master data, serta melihat analytics.

  Teknisi adalah data master pada MVP dan tidak memiliki akun atau akses login sendiri. Semua assignment dan update yang dicatat sistem dilakukan oleh admin berdasarkan informasi dari teknisi.

  Authentication menggunakan provider SSO abstraction: `MockSsoProvider` untuk local/staging dan `UpiSsoProvider` untuk production setelah integrasi SSO UPI tersedia. Tidak ada password lokal palsu sebagai pengganti SSO.

---

# **7\. User Flow — Reporter**

## **7.1 Submit Maintenance Report**

Pelapor masuk ke sistem dan memilih:

> **Laporkan Fasilitas**

Form berisi:

* kategori fasilitas  
* lokasi  
* fasilitas/aset  
* jenis masalah  
* deskripsi  
* foto pendukung (opsional; video tidak termasuk scope MVP)  
* waktu kejadian (opsional)

Contoh:

> **Lokasi:** Gedung A, Ruang 204  
> **Fasilitas:** AC  
> **Masalah:** Tidak dingin  
> **Deskripsi:** AC sudah menyala tetapi ruangan tetap panas sejak pagi.

Setelah dikirim, sistem menghasilkan:

> **Ticket ID: MNT-00124**

Jika ditemukan laporan aktif yang kemungkinan merupakan insiden yang sama dari reporter yang sama, sistem menampilkan duplicate warning dan referensi ticket utama. Reporter tetap dapat membuka ticket lama atau melanjutkan submit jika masalahnya berbeda; keputusan `DUPLICATE` hanya dapat dibuat oleh admin/UMPER. Laporan dari reporter berbeda tidak otomatis dianggap duplikat dan dapat ditautkan sebagai laporan `SUPPORTING` atau `RELATED`.

---

# **8\. AI Feature — Review Assistance**

Setelah laporan tersimpan, worker asynchronous dapat menjalankan review AI untuk membantu admin. Review ini bukan keputusan otomatis dan tidak mengubah data canonical laporan.

Contoh input:

> "AC ruang 204 bocor dan airnya netes ke meja."

AI dapat menghasilkan:

Verification recommendation:  
Perlu ditinjau admin

Possible duplicate:  
Sinyal tambahan, bukan keputusan

Suggested priority:  
High

Risk/impact factors:  
Kebocoran dapat mengganggu penggunaan ruangan

AI tidak mengisi atau mengubah kategori, issue type, lokasi/aset, status, relasi duplicate, atau `finalPriority`.

Admin tetap wajib menetapkan:

* hasil validasi laporan;
* kategori dan issue type final dari master data;
* priority final berdasarkan rubric deterministik;
* alasan override jika keputusan berbeda dari saran AI atau skor sistem.

Tujuannya adalah mengurangi beban review tanpa mengotomatisasi keputusan operasional.

---

# **9\. Report Status**

Setiap laporan memiliki lifecycle:

REPORTED  
    ↓  
VERIFIED  
    ↓  
ASSIGNED  
    ↓  
INSPECTION  
    ↓  
IN REPAIR  
    ↓  
RESOLVED  
    ↓  
CLOSED

Hanya admin/UMPER yang dapat mengubah status. Hasil verifikasi juga dapat berupa `REJECTED` atau `DUPLICATE`. Status `CLOSED`, `REJECTED`, dan `DUPLICATE` bersifat terminal pada MVP. `RESOLVED` dapat dikembalikan ke `IN_REPAIR` jika masalah belum selesai.

Syarat penting:

* `VERIFIED` membutuhkan kategori, issue type, asset/lokasi, dan priority final;
* `ASSIGNED` membutuhkan teknisi aktif;
* `RESOLVED` membutuhkan resolution note;
* `REJECTED` membutuhkan alasan;
* `DUPLICATE` membutuhkan referensi ticket utama.

---

# **10\. Progress Update**

Admin dapat menambahkan **comment/update** pada setiap laporan.

Contoh:

### **Status**

**IN REPAIR**

### **Update**

> "Teknisi telah melakukan pengecekan. Kerusakan berasal dari komponen AC yang perlu diganti. Saat ini sedang menunggu sparepart."

Update lain:

> "Sparepart telah tersedia dan perbaikan dijadwalkan besok."

Dengan demikian, pelapor tidak hanya melihat status tetapi juga mengetahui **konteks perkembangan penanganan**.

---

# **11\. Reporter — Track My Report**

Pelapor dapat melihat seluruh laporan yang pernah dibuat.

Contoh:

\#MNT-00124  
AC Ruang 204  
Status: IN REPAIR

Last update:  
Sedang menunggu sparepart.

\--------------------------------

\#MNT-00118  
HDMI Ruang 201  
Status: RESOLVED

Pelapor dapat membuka detail setiap ticket untuk melihat:

* informasi laporan  
* status  
* timeline  
* update dari admin  
* teknisi yang ditugaskan  
* waktu laporan  
* waktu penyelesaian

---

# **12\. Reporter — Campus Facility Status**

Selain melihat laporan milik sendiri, pelapor dapat melihat **status fasilitas kampus secara umum**.

Contoh:

Facility Status

Room 204 — AC  
🔴 In Repair

Room 201 — HDMI  
🟢 Operational

Room 105 — Projector  
🟠 Under Inspection

Toilet Building A  
🔴 Maintenance

Fungsi ini ditujukan agar sivitas kampus dapat mengetahui:

> **"Fasilitas mana yang sedang bermasalah saat ini?"**

dan mengurangi kemungkinan laporan duplikat.

---

# **13\. Admin Dashboard**

Admin memiliki dashboard terpusat.

## **13.1 Overview**

Contoh:

Total Reports             124  
Active Reports              18  
In Repair                   11  
Resolved This Month         37  
Critical Issues              3

## **13.2 Report Management**

Admin dapat:

* melihat seluruh laporan  
* mencari laporan  
* filter berdasarkan status  
* filter berdasarkan lokasi  
* filter berdasarkan kategori  
* melihat detail laporan  
* memverifikasi laporan  
* mengubah prioritas  
* mengassign teknisi  
* mengubah status  
* menambahkan progress update  
* menutup laporan

---

# **14\. Technician Assignment**

Admin dapat memilih teknisi yang menangani suatu laporan.

Contoh:

Ticket:  
MNT-00124

Issue:  
AC tidak dingin

Priority:  
High

Assigned Technician:  
Budi

Assignment Date:  
15 September 2026

Setelah assignment, pelapor dapat melihat:

> **Technician assigned: Budi**

Informasi personal teknisi yang tidak diperlukan tidak perlu ditampilkan.

---

# **15\. Facility Management**

Admin juga memiliki modul **Facility / Asset Management**.

Setiap fasilitas memiliki data:

Asset ID     : AC-204  
Category     : Air Conditioner  
Location     : Room 204  
Status       : In Repair  
Installed    : 2024

Setiap fasilitas mempunyai histori maintenance.

Contoh:

AC-204

Maintenance History  
├── MNT-00124 — 15 Sep 2026  
├── MNT-00098 — 28 Aug 2026  
├── MNT-00071 — 12 Jul 2026  
└── MNT-00032 — 05 May 2026

---

# **16\. AI Feature — Maintenance Insight**

Analytics deterministik tersedia sejak MVP. Insight historis berbantuan AI ditunda sampai data cukup dan kebijakannya disetujui.

Agar tidak menghasilkan insight dari data yang terlalu sedikit, sistem dapat menggunakan threshold awal:

> **Insight otomatis hanya ditampilkan ketika suatu fasilitas / kategori memiliki minimal 5 laporan historis.**

Contoh:

AC-204

Total Reports:  
8

Most Frequent Issue:  
"Not Cooling" — 5 reports

Latest Report:  
15 Sep 2026

Insight:  
AC-204 memiliki frekuensi laporan  
yang relatif tinggi dan sebagian besar  
berhubungan dengan masalah pendinginan.

Recommendation:  
Pertimbangkan pemeriksaan menyeluruh  
terhadap unit.

Insight historis (fase lanjutan, bukan keputusan otomatis) dapat membantu menghasilkan:

### **Frequent Problem Detection**

Menemukan fasilitas atau kategori dengan frekuensi laporan tinggi.

### **Pattern Detection**

Menemukan pola seperti:

> "Sebagian besar laporan AC berasal dari Gedung A."

### **Maintenance Insight**

Memberikan indikasi:

> "Fasilitas tertentu mengalami kerusakan berulang."

---

# **17\. Important AI Principle**

AI berfungsi sebagai **decision support**, bukan decision maker.

Contoh:

AI  
↓  
Recommendation  
↓  
Admin Review  
↓  
Final Decision

Jadi:

> AI menyarankan "High Priority"

tidak berarti sistem otomatis menjadikan laporan tersebut High Priority.

Admin tetap dapat mengubah keputusan.

---

# **18\. Notification**

Sistem dapat memberikan notifikasi kepada pelapor ketika terdapat perubahan penting.

Contoh:

> Laporan \#MNT-00124 telah diverifikasi.

> Laporan \#MNT-00124 telah ditugaskan kepada teknisi.

> Update baru tersedia untuk laporan \#MNT-00124.

> Laporan \#MNT-00124 telah diselesaikan.

Untuk MVP, notification dapat dimulai dari **in-app notification**.

Email/WhatsApp integration dapat menjadi pengembangan berikutnya.

---

# **19\. Functional Requirements**

## **Reporter**

Sistem harus memungkinkan reporter untuk:

1. Login.  
2. Membuat maintenance report.  
3. Mengunggah foto.  
4. Mendapatkan ticket ID.  
5. Melihat status laporan.  
6. Melihat progress update.  
7. Melihat laporan yang pernah dibuat.  
8. Melihat kondisi fasilitas kampus yang sedang bermasalah.  
9. Melihat fasilitas yang sedang dalam perbaikan.

## **Admin**

Sistem harus memungkinkan admin untuk:

1. Login.  
2. Melihat dashboard.  
3. Melihat seluruh laporan.  
4. Memverifikasi laporan.  
5. Menentukan atau mengubah kategori.  
6. Menentukan atau mengubah priority.  
7. Assign technician.  
8. Update status.  
9. Menambahkan progress comment.  
10. Mengelola data fasilitas.  
11. Melihat histori maintenance.  
12. Melihat analytics.  
13. Melihat AI-generated insights.

---

# **20\. Non-Functional Requirements**

Sistem diharapkan:

### **Usable**

Pelaporan harus dapat dilakukan dengan langkah sederhana.

### **Traceable**

Setiap laporan memiliki ID dan histori perubahan.

### **Transparent**

Pelapor dapat melihat perkembangan laporan.

### **Secure**

Reporter hanya dapat mengakses informasi yang sesuai dengan hak aksesnya.

### **Maintainable**

Struktur sistem memungkinkan penambahan AI, IoT, dan fitur lainnya di masa depan.

---

# **21\. MVP Scope**

Untuk prototype pertama, fitur wajib:

### **Reporter**

* Login  
* Submit report  
* Upload image  
* Ticket ID  
* Track report  
* Progress timeline  
* Campus facility status

### **Admin**

* Login  
* Dashboard  
* Report management  
* Verification  
* Priority  
* Technician assignment  
* Status update  
* Progress comment  
* Facility management  
* Maintenance history

### **AI**

* Verification assistance  
* Sinyal potensi duplicate  
* Suggested priority dan faktor risiko/dampak  
* Human review oleh admin sebelum keputusan final

### **Analytics**

* Number of reports  
* Reports by category  
* Reports by location  
* Reports by status  
* Resolution time

---

# **22\. Out of Scope — MVP**

Fitur berikut **belum diperlukan** untuk versi pertama:

* IoT sensor  
* real-time facility monitoring  
* predictive maintenance ML model  
* VR  
* automatic technician scheduling  
* WhatsApp bot  
* fully autonomous AI decision making  
* AI-generated progress update atau internal note  
* integration dengan seluruh sistem akademik UPI  
* mobile native application

Fitur tersebut dapat dipertimbangkan setelah MVP tervalidasi.

---

# **23\. Future Development**

## **Phase 2 — Advanced AI**

AI dapat dikembangkan menjadi:

* image-based damage classification  
* maintenance recommendation  
* automatic weekly maintenance summary

## **Phase 3 — Predictive Maintenance**

Dengan histori yang cukup:

Historical Reports  
\+  
Maintenance History  
\+  
Asset Data  
        ↓  
Predictive Model  
        ↓  
Failure Risk  
        ↓  
Preventive Maintenance Recommendation

## **Phase 4 — IoT Integration**

Sensor dapat ditambahkan untuk fasilitas tertentu:

Sensor  
 ↓  
IoT Platform  
 ↓  
Facility Data  
 ↓  
Maintenance System

Namun IoT bukan bagian dari MVP.

---

# **24\. Example End-to-End Scenario**

Seorang mahasiswa memasuki Ruang 204 dan menemukan AC bocor.

### **Step 1**

Mahasiswa membuka sistem.

### **Step 2**

Mahasiswa memilih:

> Room 204 → AC → Water Leakage

dan mengunggah foto.

### **Step 3**

AI membaca laporan:

> Category: HVAC  
> Issue: Water Leakage  
> Suggested Priority: High

### **Step 4**

Admin memverifikasi laporan.

Status:

> **VERIFIED**

### **Step 5**

Admin assign:

> Technician: Budi

Status:

> **ASSIGNED**

Mahasiswa mendapatkan notifikasi.

### **Step 6**

Teknisi melakukan pengecekan.

Admin mengubah status:

> **IN REPAIR**

dan menambahkan:

> "AC perlu penggantian komponen. Sparepart sedang dipesan."

### **Step 7**

Sparepart tersedia.

Admin menambahkan:

> "Sparepart sudah tersedia. Perbaikan dijadwalkan 16 September."

### **Step 8**

Perbaikan selesai.

Status:

> **RESOLVED**

### **Step 9**

Setelah beberapa bulan, sistem memiliki 8 laporan untuk AC yang sama.

AI/analytics mendeteksi:

> "AC-204 memiliki frekuensi maintenance yang relatif tinggi dengan mayoritas laporan terkait performa pendinginan."

Insight tersebut adalah indikator deskriptif untuk ditinjau admin, bukan keputusan otomatis. Admin dapat menggunakannya untuk menentukan apakah aset perlu diperiksa lebih lanjut atau diganti.

---

# **25\. Proposed Value Proposition**

## **Untuk Pelapor**

> **"Laporkan sekali, pantau sampai selesai."**

Pelapor tidak lagi hanya menyampaikan keluhan, tetapi dapat mengetahui apa yang terjadi setelah laporan dibuat.

## **Untuk Pengelola**

> **"Satu sistem untuk mengelola seluruh maintenance fasilitas kampus."**

Admin mendapatkan centralized reporting, tracking, asset history, dan analytics.

## **Untuk Kampus**

> **"From reactive complaints to data-driven facility management."**

Data maintenance dapat digunakan sebagai dasar untuk meningkatkan pengelolaan fasilitas.

---

# **26\. Key Success Metrics**

Setelah prototype/implementasi, beberapa indikator yang dapat diukur:

### **Reporting**

* jumlah laporan yang masuk melalui sistem  
* persentase laporan yang memiliki data lengkap  
* jumlah laporan duplikat

### **Process**

* rata-rata waktu dari report → verification  
* rata-rata waktu dari verification → assignment  
* rata-rata waktu report → resolution

### **Transparency**

* persentase laporan yang memiliki progress update  
* persentase laporan yang statusnya dapat ditelusuri

### **Facility Management**

* jumlah maintenance per kategori  
* jumlah maintenance per lokasi  
* jumlah recurring issues  
* jumlah aset dengan frekuensi kerusakan tinggi

### **User Adoption**

* jumlah active reporters  
* jumlah laporan per bulan  
* repeat usage

---

# **27\. Core Product Differentiation**

Produk ini **bukan sekadar sistem pengaduan**.

Fokus utamanya adalah:

> **Facility Maintenance Lifecycle Management**

yang mencakup:

REPORT  
  ↓  
VERIFY  
  ↓  
PRIORITIZE  
  ↓  
ASSIGN  
  ↓  
INSPECT  
  ↓  
REPAIR  
  ↓  
UPDATE  
  ↓  
RESOLVE  
  ↓  
HISTORICAL DATA  
  ↓  
INSIGHT

AI menjadi lapisan intelligence yang membantu proses tersebut.

---

# **28\. One-Sentence Product Definition**

> **Smart Campus Maintenance System adalah sistem informasi terpusat yang memungkinkan sivitas kampus melaporkan kerusakan fasilitas dan memantau proses penanganannya, sementara pengelola fasilitas dapat mengelola work order, teknisi, aset, histori maintenance, dan memperoleh insight berbasis AI untuk mendukung pengambilan keputusan maintenance.**

