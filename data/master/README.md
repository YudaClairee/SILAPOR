# Master Data Awal

Data di folder ini berasal dari dokumen:

`Kode-Ruangan-dan-Nama-Gedung20260507_09193414 (1).pdf`

Status data saat ini adalah **draft**. File ini menjadi sumber impor awal, bukan
pengganti database runtime. Sebelum diimpor, data perlu diverifikasi terhadap
dokumen resmi dan dikonfirmasi oleh UMPER/admin.

## File

- `buildings.csv`: daftar gedung yang tercantum pada PDF.
- `rooms_lengkap.csv`: daftar ruangan yang sudah diverifikasi dan menjadi
  acuan resmi terbaru.
- `facility-categories.csv`: taxonomy kategori fasilitas sementara untuk form.
- `issue-types.csv`: taxonomy jenis masalah sementara untuk form.
- `asset-profiles.csv`: aturan/perlengkapan umum berdasarkan tipe ruangan atau
  gedung; ini belum menjadi inventaris aset individual.
- `technicians.csv`: lima teknisi dummy untuk pengembangan dan pengujian MVP;
  harus diganti atau dilengkapi dengan data resmi sebelum production.
- `assets.csv`: template inventaris aset individual, masih kosong sampai kode
  aset dan pemetaan per ruangan tersedia.

`assets.csv` belum berisi aset individual karena kode aset dan pemetaan setiap
aset ke ruangan belum tersedia. Informasi umum seperti TV, HDMI, papan tulis,
AC, lampu, stop kontak, dan perlengkapan toilet dicatat lebih dulu di
`asset-profiles.csv`.

## Aturan pemodelan perlengkapan

- Ruang kelas adalah ruangan dengan `room_name` yang mengandung `KULIAH` (mencakup `R. KULIAH` dan `RUANG KULIAH`; total 27 ruangan: 24 di Gedung C + 3 di Gedung I).
- Toilet pria memiliki urinal; toilet wanita dan toilet difabel tidak memiliki
  urinal. Tiga toilet generik (`TOILET DIREKTUR`, `TOILET (R. SEKSI ADUM)`,
  `TOILET` di lantai 4 Gedung A) status urinalnya masih `NEEDS_REVIEW` sampai
  survei fisik.
- Gedung satu lantai (B, D, E, F, G, J) memakai `floor_number=1` sesuai segmen
  `01` pada `room_code`; tidak ada `floor_number` kosong.
- Ruang lift (`room_name` mengandung `LIFT`) hanya dapat dilaporkan melalui
  alur admin (tidak tampil pada form reporter); ruang server, listrik, dan
  gudang tetap dapat dilaporkan reporter umum.
- Setiap ruang kelas memiliki satu fasilitas agregat `Meja dosen`.
- Laboratorium yang memiliki penanda `IOT` dapat memiliki fasilitas agregat
  `Komputer lab`; jumlah unit sengaja dikosongkan sampai inventaris lab
  tersedia.
- Kursi mahasiswa tidak perlu dibuat satu record per kursi. Gunakan satu aset
  agregat per ruangan, dengan jumlah mengikuti kapasitas atau inventaris bila
  nanti diketahui.
- Lampu juga dikelola sebagai satu aset agregat per ruangan walaupun terdapat
  dua titik lampu. Kolom `quantity=1` berarti satu fasilitas yang dapat dipilih
  pada form, bukan satu bohlam.
- Untuk kebutuhan pelaporan, reporter memilih fasilitas agregat seperti
  `Lampu`, `AC`, atau `Kursi mahasiswa`; sistem tidak perlu menampilkan nomor
  unit individual.

## Aturan impor

- Gunakan `building_code` dan `room_code` sebagai kode eksternal dari dokumen.
- Jangan menghapus data historis ketika gedung atau ruangan tidak lagi aktif.
- `area_m2` disimpan sebagai angka desimal dalam satuan meter persegi.
- `asset-profiles.csv` tidak boleh langsung dipakai untuk membuat satu aset
  per ruangan tanpa mengisi tipe ruangan, jumlah, dan pengecualian terlebih
  dahulu.
- Baris yang memiliki `verification_status=NEEDS_REVIEW` harus diverifikasi
  sebelum dipakai untuk validasi laporan.
- Nama dan kode pada PDF adalah sumber asli; normalisasi nama untuk tampilan
  sebaiknya dilakukan di layer aplikasi, bukan dengan mengubah kode sumber.

## Catatan

`rooms_lengkap.csv` sudah diverifikasi oleh pengguna dan menjadi acuan baru.
Ballroom Gedung C sementara dimodelkan memiliki enam AC central sesuai
keputusan produk saat ini. Jika verifikasi fisik berbeda, ubah profile tanpa
mengubah histori laporan. Data kategori, issue type, bobot, threshold, status
operasional, dan kode aset individual tetap dapat dilengkapi setelah keputusan
produk disahkan.

## Hasil validasi Step 2 (2026-10-10)

- 165 ruangan terbaca dari `rooms_lengkap.csv`.
- 10 gedung terdaftar pada `buildings.csv`.
- Tidak ditemukan `room_code` duplikat.
- Semua `building_code` pada rooms memiliki pasangan di `buildings.csv`.
- Semua gedung dan ruangan saat ini memiliki `is_active=true`.
- Ballroom `22.4C.05.064` tersedia dan memakai asumsi enam AC central.
- Profil ruang kelas sudah mencakup fasilitas agregat TV, HDMI, papan tulis,
  meja dosen, kursi mahasiswa, lampu, stop kontak, dan AC sesuai gedung.
- Profil Lab IoT mencakup komputer agregat dengan jumlah yang belum ditentukan.

Scoring lokasi memakai tier manual pada `location-usage.csv` (TIER_1 30 untuk
27 ruang kuliah + 18 lab, TIER_2 22, TIER_3 15, TIER_4 8); slot jadwal resmi
dapat menggantikannya nanti via kolom `slots_per_week`. Bobot kategori/aset
(`facility-weights.csv` v1) dan ambang `HIGH`/`MEDIUM`/`LOW`
(`priority-thresholds.csv` v1: 70/40) adalah baseline provisional yang dapat
dikalibrasi via versi konfigurasi baru tanpa mengubah histori laporan lama.
