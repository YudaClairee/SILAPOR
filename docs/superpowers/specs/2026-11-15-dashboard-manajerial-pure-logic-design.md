# Dashboard Manajerial Pure Logic

## Intent

Memberikan akses mandiri kepada manajerial kampus untuk memahami kondisi fasilitas dan menentukan prioritas tindakan tanpa bergantung pada admin. Dashboard harus menjawab dua pertanyaan utama: lokasi mana yang menerima keluhan terbanyak dan aset mana yang paling rentan rusak.

## Goals

- Menampilkan overview keputusan pada satu halaman manajerial.
- Menampilkan volume keluhan, status aktif, tren, waktu penyelesaian, lokasi bermasalah, dan aset dengan laporan berulang.
- Menyediakan filter periode dengan batas hari Jakarta yang konsisten dengan analytics admin.
- Dashboard tersedia di `/admin/managerial` dan mengikuti akses role `ADMIN` yang sudah ada sampai role manajerial tersedia.
- Membuat prioritas yang dapat dijelaskan melalui data dan aturan deterministik.
- Memungkinkan penelusuran dari ringkasan menuju laporan atau aset pendukung.

## Non-goals

- Tidak menggunakan model AI, generative summary, atau prediksi machine learning pada tahap ini.
- Tidak mengubah workflow admin, status laporan, data master, atau aturan scoring yang sudah ada.
- Tidak membuat role autentikasi baru; akses mengikuti guard admin yang ada sampai role manajerial tersedia.
- Tidak mengarang metrik biaya atau dampak yang belum tersedia dalam database.

## Dashboard content

- Kartu ringkasan: total laporan, laporan aktif, laporan prioritas tinggi, laporan selesai bulan ini, dan waktu penyelesaian.
- Peringkat lokasi berdasarkan jumlah laporan pada periode terpilih.
- Peringkat aset berdasarkan jumlah laporan terkait pada periode terpilih.
- Tren laporan dan penyelesaian harian yang sudah didukung analytics.
- Antrian prioritas yang dapat ditelusuri ke detail laporan.
- Antrian prioritas ditampilkan sebagai antrian global karena query saat ini tidak menerima filter periode.
- Filter `from` dan `to` dalam format `YYYY-MM-DD`, inklusif pada hari Jakarta.
- State loading, error, forbidden, empty, dan data normal.

## Pure-logic rules

- Semua angka berasal dari query analytics atau transformasi deterministik dari response tersebut.
- Peringkat mempertahankan urutan query analytics; ties tidak dipecahkan dengan heuristik baru.
- Nilai kosong ditampilkan sebagai empty state atau em dash, bukan angka buatan.
- Dashboard tidak menampilkan rekomendasi naratif yang tidak memiliki sumber data.

## Constraints

- Reuse `@silapor/analytics`, `getDashboardOverviewRoute`, komponen UI, dan pola route `/admin/analytics`.
- Pertahankan kontrak endpoint analytics yang sudah diuji.
- Tambahkan pengujian terfokus untuk transformasi/presentasi baru dan edge case empty/error.
- Copy antarmuka menggunakan Bahasa Indonesia yang ringkas.
