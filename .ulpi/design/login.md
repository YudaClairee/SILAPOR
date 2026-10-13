# Login — SCMS UPI Tasikmalaya

## Design Read

Login harus terasa seperti gerbang layanan institusional: tenang, terverifikasi,
dan langsung mengarahkan pengguna ke autentikasi SSO tanpa dekorasi yang tidak
menambah kepercayaan.

## Reference binding

Implementasi terikat pada frame `1:8` dari [SCMS tugas smt 7](https://www.figma.com/design/EzAw6vTYxyATdJgTYRzqTg/SCMS-tugas-smt-7?node-id=1-8).
Nilai warna, radius, tipografi, spacing, dan signature mengikuti
[`DESIGN.md`](./DESIGN.md).

## Flow dan states

1. Pengguna membuka `/login`.
2. Header menampilkan identitas UPI, status koneksi SSO, dan bantuan teknis.
3. Pengguna mengisi `ID SSO UPI`, lalu memilih `Masuk dengan Akun SSO UPI`.
4. Saat request berjalan, field dan tombol dinonaktifkan dan label tombol berubah
   menjadi `Memeriksa…`.
5. Sukses mengarahkan pengguna ke `/`.
6. Kredensial salah, rate limit, provider tidak tersedia, jaringan gagal, dan
   respons tidak valid memakai pesan error yang eksplisit namun generik.

Edge cases:

- field kosong ditolak di client tanpa request;
- fokus keyboard tetap terlihat dan urutan tab mengikuti urutan visual;
- layout menyempit menjadi satu kolom pada viewport di bawah 640px;
- reduced motion tidak menerima animasi tambahan.

## Component specification

### Institutional header

- 36px logo UPI, nama universitas 12px, kampus 11px;
- status pill hijau muda dengan dot status;
- link bantuan menuju bagian helpdesk;
- pada mobile link bantuan disembunyikan agar header tetap ringkas.

### Authentication card

- lebar maksimum 480px, radius 12px, border `#E2E8F0`, shadow ringan;
- aksen maintenance rail 6px di sisi atas dengan gradasi `#0A3947` →
  `#007B8A` → `#0A3947`;
- logo 64px dalam shell 74px;
- judul 22px, subjudul uppercase teal 14px;
- role preview membedakan `Pelapor Fasilitas` dan `Tim Operasional`;
- field pilot `ID SSO UPI` tetap dipertahankan karena provider mock saat ini
  membutuhkan username, sementara CTA dan visual mengikuti SSO reference;
- CTA berbentuk pill, target sentuh minimal 44px, memiliki focus ring 2px;
- error memakai `role="alert"` dan tidak mengungkap akun yang valid.

### Footer

- guidance helpdesk dan copyright berada tepat di bawah kartu;
- footer bawah memuat unit UMPER dan tiga tautan utilitas;
- tautan memiliki focus state dan kontras yang memadai.

## Design pre-flight

- [x] Identity locked to the institutional Swiss/grid language.
- [x] No gradients except the single reference-matched top accent.
- [x] Loading, success, validation, auth error, unavailable, and network error
      states are covered by the existing login behavior.
- [x] Keyboard focus, accessible labels, alert semantics, and skip link are
      preserved.
- [x] Desktop and mobile layouts are specified.
- [x] Static Figma assets are local files, not temporary URLs.
- [x] Typecheck, lint, and production build pass.

## Build handoff

Target: existing React + Vite + TanStack Router web app.

Implement exactly this spec and theme the screen with the locked tokens in
[`DESIGN.md`](./DESIGN.md); do not redesign or re-implement unrelated routes.
