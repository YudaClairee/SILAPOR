# API Contract — UI/UX Handoff

> Sumber kebenaran: implementasi aktual di `apps/web/src/routes/api/**` dan
> `apps/web/src/server/**` (Phase 2–5). Endpoint bertanda **[Phase 6]** belum
> dibangun — bentuk di bawah adalah kontrak yang akan diimplementasikan;
> beri tahu backend sebelum mendesain alur yang bergantung padanya supaya
> field-nya dikunci lebih dulu.
>
> Semua endpoint mengembalikan JSON. Autentikasi memakai **session cookie**
> (setelah login) — tidak ada `Authorization` header / token manual.

## Konvensi umum

- **Request body:** field `snake_case` (contoh `location_id`); `camelCase`
  juga diterima (layer server menormalisasi keduanya).
  **Response:** field `camelCase` (bentuk row Drizzle).
- **Pagination:** query param `limit` & `offset`; response list selalu
  `{ "items": [...], "total": <number> }`.
- **Error envelope (sama untuk semua endpoint):**

  ```json
  { "error": { "code": "NOT_FOUND", "message": "Report not found" } }
  ```

- **Kode error yang stabil** (dipakai UI untuk copy/state):
  `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403),
  `NOT_FOUND` (404), `CONFLICT` (409), `UNAVAILABLE` (503), `INTERNAL` (500),
  plus khusus upload: `FILE_TOO_LARGE`, `TOO_MANY_FILES`,
  `UNSUPPORTED_TYPE`, `MIME_MISMATCH`, `CORRUPT_IMAGE`,
  `INVALID_FILENAME`, `EMPTY_FILE`.
- **409 CONFLICT** = optimistic locking: tiket diubah admin lain.
  UI wajib menampilkan pesan "refresh & tinjau ulang", bukan retry diam-diam.
- **401** memakai pesan generik (`"Kredensial salah"` / `"Belum login"`) —
  tidak boleh dipakai untuk menebak keberadaan akun.
- **Enum untuk UI:**
  - Status tiket (7 status — design AI verification 2026-10-14): `REPORTED → VERIFIED → ASSIGNED → INSPECTION → IN_REPAIR → RESOLVED → CLOSED`. Tidak ada lagi `REJECTED`/`DUPLICATE`: verifikasi gagal tidak menyimpan apapun (422), duplikat diblokir/merge otomatis di submit.
  - Priority: `LOW | MEDIUM | HIGH` (tidak ada CRITICAL)
  - Visibility update: `PUBLIC | INTERNAL`
- **Verifikasi (penting):** verifikasi laporan dilakukan **AI di submit** (lihat §2);
  admin hanya fallback manual untuk laporan yang disimpan sementara saat layanan
  AI down (§5 held-verify). Bagian manual-verification lama di §5 (verify bebas,
  reject, duplicate, priority) telah **SUPERSEDED** oleh design
  `docs/superpowers/specs/2026-10-14-ai-verification-design.md` — jangan
  membangun UI untuk endpoint lama tersebut.

## 1. Auth

| Endpoint | Method | Request | Sukses | Gagal |
|---|---|---|---|---|
| `/api/auth/login` | POST | `{ "username": "...", "password": "..." }` | `200 { "user": { "id", "username", "role": "REPORTER"|"ADMIN" } }` + Set-Cookie | `401` kredensial salah; `429` rate-limit (5 gagal / 10 menit) |
| `/api/auth/logout` | POST | — | `200`, cookie dihapus | — |
| `/api/auth/me` | GET | — | `200 { "user": { "id", "username", "role" } }` | `401` belum login |


## 2. Reporter — form & daftar laporan

| Endpoint | Method | Request | Sukses |
|---|---|---|---|
| `/api/reports/form-options` | GET | — | `200 { "locations": [], "categories": [], "issueTypes": [], "assets": [] }` — hanya data aktif. **Reporter tidak memilih kategori/issue**: kategori ditentukan dari asset (dependent select: lokasi → asset), issue type & priority ditetapkan AI. List `categories`/`issueTypes` tetap ada di response untuk pemakaian admin (filter). |
| `/api/reports` | GET | query: `status`, `category_id`, `location_id`, `priority`, `from`, `to`, `q`, `limit`, `offset` | `200 { "items": ReportItem[], "total": number }` — selalu **hanya laporan milik sendiri** (laporan sendiri yang di-hold tampil sebagai pending check di sini; antrian held penuh hanya untuk admin) |
| `/api/reports` | POST | header **wajib** `x-idempotency-key`; body: `{ "location_id" (UUID, wajib), "asset_id" (UUID, wajib), "description" (10–2000 char), "photo_keys" (1–3 storage key dari POST /api/uploads, wajib) }` — **tanpa** kategori/issue/occurred_at dari reporter (400 bila dikirim) | verifikasi sinkron saat submit — lihat kontrak submit AI di bawah |
| `/api/reports/duplicate-check` | GET | query: `location_id`, `category_id`, `issue_type_id`?, `asset_id`? | `200 { "count": number, "candidates": [{ "ticketNumber", "status", "reportedAt" }] }` — **warning saja**, tidak memblokir submit; tawarkan link ke ticket existing |
| `/api/reports/:id` | GET | — | `200` detail; ownership dijaga server — 404 identik untuk tiket milik orang lain (jangan tampilkan "bukan milik Anda") |
| `/api/reports/:id/timeline` | GET | — | `200` array `TimelineEntry` terurut kronologis — **sudah disanitasi**: entri INTERNAL hilang, `actorId = null`, note hanya untuk event publik |

### Kontrak submit AI (design `2026-10-14-ai-verification-design.md`)

Submit bersifat sinkron: reporter menunggu vonis verifikasi di momen submit.
Urutan pipeline: blokir/merge duplikat deterministik dulu (tanpa AI), lalu
verifikasi AI kedua.

| Respons | Arti | Body | Efek samping |
|---|---|---|---|
| `201` | AI **PASS** | `{ "ticketNumber", "report", "verification": { "status": "VERIFIED", "category", "issueType", "priority", "confidence" }, "relation"? , "duplicateCandidates" }` | status langsung `VERIFIED`, nomor tiket dikonsumsi, `finalCategory`/`finalIssueType`/`finalPriority` diisi AI — mengalir ke assignment/timeline seperti VERIFIED biasa |
| `200` | replay idempotent | `{ "ticketNumber", "report", "idempotentReplay": true, "verification": { "status": <status tersimpan> } }` | tanpa efek baru |
| `202` | layanan AI **down** (transien: timeout/5xx/429 setelah retry) | `{ "ticketNumber", "report", "analysisId", "message": "<notice menunggu>", "verification": { "status": "HELD" } }` | laporan **tetap tersimpan** status `REPORTED` tanpa klasifikasi final; nomor tiket tetap dikonsumsi; hanya admin yang melihat antrian penuh — reporter melihat laporannya sendiri sebagai menunggu verifikasi |
| `422` | AI **FAIL** deterministik (foto/deskripsi tidak jelas, deskripsi tidak cocok dengan asset, kode master data tidak dikenal, model menolak/4xx) | `{ "reason": "<teks plain-language yang bisa ditindak reporter>" , "machineCode"? }` | **tidak ada row, tidak ada tiket** — perbaiki = ajukan laporan baru |
| `409` | duplikat same-reporter aktif | error envelope standar + `ticketNumber` tiket aktif di root body — UI tawarkan membuka tiket itu | tidak ada submit baru; merge different-reporter (SUPPORTING) tetap jalan selama AI down |

Salah input juga gagal sebelum AI berjalan (0 foto, description <10 char, field
klasifikasi reporter dikirim, asset/location bukan UUID) → `400`.

Taxonomy closed-world: AI memilih kategori/issue type/priority **hanya** dari
master data aktif (`data/master/facility-categories.csv` — ELECTRICAL, HVAC,
FURNITURE, ELECTRONIC, PLUMBING, OTHER — dan `data/master/issue-types.csv` —
BROKEN, NOT_WORKING, MISSING, DIRTY, LEAKING, DANGEROUS, OTHER); tidak ada
teks bebas. `DANGEROUS` dijamin minimal HIGH; bila deskripsi menunjuk kategori
berbeda dari asset terpilih → FAIL `wrong-asset` (bukan re-categorize diam-diam).
Laporan unsure → FAIL `needs clearer evidence` — tidak pernah VERIFIED diam-diam.

`message` untuk 202 (copy keputusan): "Verifikasi sedang tidak tersedia.
Laporan Anda sudah tersimpan dan menunggu pemeriksaan."

### 2a. Reporter — staging foto pra-submit (`/api/uploads`)

Foto diunggah **sebelum** submit agar submit berbasis storage key (photo-first
flow) — submit tidak lagi menerima multipart langsung.

| Endpoint | Method | Request | Sukses | Ditolak dengan |
|---|---|---|---|---|
| `/api/uploads` | POST | `multipart/form-data` field `files` — **1–3 file/request, 5 MB/file, hanya JPEG/PNG/WebP** (metadata diperiksa server, termasuk MIME mismatch & corrupt image) | `201 { "keys": ["<opaque storage key>", ...] }` — client hanya menerima key, tidak ada URL/metadata file | `BAD_REQUEST` (bukan multipart / 0 file), `FILE_TOO_LARGE`, `TOO_MANY_FILES`, `UNSUPPORTED_TYPE`, `MIME_MISMATCH`, `CORRUPT_IMAGE`, `INVALID_FILENAME`, `EMPTY_FILE` |

- **Auth:** sama seperti form-options — user session (`REPORTER` atau `ADMIN`);
  401 bila belum login; key hanya dapat diklaim oleh uploader-nya sendiri.
- **Validasi:** tunduk pada angka di atas; kegagalan validasi tidak menyimpan byte.
- **TTL:** key kedaluwarsa **24 jam** setelah dibuat bila tidak diklaim. Submit
  VERIFIED/HELD mengklaim key menjadi `report_attachments`; submit yang gagal
  (422) dan resubmit idempotent menghapus key yang belum diklaim. Key asing/milik
  orang lain/kedaluwarsa ditolak submit dengan `400` dan tanpa efek samping.

### TimelineEntry (reporter — sanitized)

```json
{
  "id": "uuid",
  "kind": "event | update | assignment | relation",
  "at": "ISO-8601",
  "actorId": null,
  "label": "STATUS_CHANGED",
  "detail": { "": "tergantung kind" },
  "visibility": null
}
```

## 3. Reporter — attachment

| Endpoint | Method | Request | Sukses | Ditolak dengan |
|---|---|---|---|---|
| `/api/reports/:id/attachments` | POST | `multipart/form-data`; **maks 3 file/laporan, 5 MB/file, hanya JPEG/PNG/WebP** | `200/201` metadata attachment | `TOO_MANY_FILES`, `FILE_TOO_LARGE`, `UNSUPPORTED_TYPE`, `MIME_MISMATCH`, `CORRUPT_IMAGE` |
| `/api/reports/:id/attachments/:attachmentId` | GET | — | `200` bytes gambar (ownership dicek server) | `404` |

Tidak ada public URL untuk file — akses selalu lewat endpoint berotorisasi.

## 4. Admin — master data

Lima entitas pola identik: `locations`, `categories`, `issue-types`, `assets`,
`technicians`. Semua butuh role **ADMIN** (selain itu `403`).

| Endpoint | Method | Request | Sukses |
|---|---|---|---|
| `/api/admin/{entity}` | GET | query: `includeInactive=1`, `limit`, `offset` | `200 { "items": Row[], "total": number }` |
| `/api/admin/{entity}` | POST | JSON body sesuai entitas | `201` row |
| `/api/admin/{entity}/:id` | GET | — | `200` row |
| `/api/admin/{entity}/:id` | PATCH | partial JSON | `200` row |

**Tidak ada DELETE** — arsipkan dengan `PATCH { "is_active": false }`.
Data terarsip tidak muncul di pilihan baru, tapi histori lama tetap valid
(UI harus tetap bisa menampilkan label item terarsip di histori).

## 5. Admin — manajemen laporan

| Endpoint | Method | Request | Sukses |
|---|---|---|---|
| `/api/admin/reports` | GET | query: `status`, `category_id`, `location_id`, `priority`, `from`, `to`, `q` (ticket/deskripsi), `sort`, `limit`, `offset` | `200 { "items", "total" }` — semua laporan |
| `/api/admin/reports/:id` | GET | — | `200` detail lengkap (priority score, factors, version, dll.) |
| `/api/admin/reports/:id/timeline` | GET | — | `200` `TimelineEntry[]` **versi admin**: termasuk entri `visibility: "INTERNAL"`, actor terlihat |
| `/api/admin/reports/:id/verify` | POST | `{ "priority": "LOW"\|"MEDIUM"\|"HIGH" }` **atau** full codes `{ "category": "<CATEGORY_CODE>", "issueType": "<ISSUE_TYPE_CODE>", "priority": ... }` **atau** full ids `{ "finalCategoryId", "finalIssueTypeId", "finalPriority" }`; + `expectedVersion` **wajib** — hanya untuk tiket **HELD** (status `REPORTED`, belum punya klasifikasi final) | `200` report — setara `VERIFIED` AI: status jadi `VERIFIED`, klasifikasi final diset, lalu timeline/assignment/notification berjalan sama persis seperti hasil AI |
| `/api/admin/reports/:id/assign` | POST | `{ "technicianId", "expectedVersion" }` — hanya teknisi aktif | `200` |
| `/api/admin/reports/:id/transition` | POST | `{ "status", "note"?, "expectedVersion" }` — `note` wajib untuk inspection/resolution | `200` |
| `/api/admin/reports/:id/updates` | POST | `{ "visibility": "PUBLIC"\|"INTERNAL", "message" }` | `200/201` |

> **SUPERSEDED (legacy manual-verification oleh design AI 2026-10-14).** Verifikasi
> manual bebas (form lengkap di atas tiket mana pun), `reject`, `duplicate`,
> dan `priority` **sudah dihapus** — design AI: laporan gagal never exists
> (422 di submit), duplikat diatasi di submit, priority ditetapkan AI dan tidak
> bisa di-override admin saat AI bekerja. Yang tinggal hanya held-verify di
> atas sebagai fallback saat layanan AI down. UI lama yang memanggil
> `/reject`, `/duplicate`, `/priority`, atau verify-on-any-status akan
> mendapat error berikut:

- `400` — `expectedVersion` hilang/bukan integer, atau kode master data tidak
  dikenal / tidak cocok (termasuk issue type bukan anak kategori) — **tidak ada
  write** pada kasus apa pun.
- `410 GONE` — tiket bukan lagi tiket held (sudah diverifikasi ataupun
  statusnya bukan `REPORTED`): hold tidak pernah dioverride, hanya resolve
  sekali.
- `409` — `expectedVersion` usang (stale): tampilkan panel
  "Laporan diubah admin lain — muat ulang", jangan retry diam-diam.

**Aturan UI wajib dari state machine:**

- hanya tampilkan tombol next status yang valid (server menolak transisi ilegal dengan 400);
- transisi ke status terminal minta confirmation;
- **selalu kirim `expectedVersion`** dari data terakhir yang dimuat admin — dua admin mengubah tiket sama menghasilkan 409 untuk yang lambat;
- tampilkan form resolution note pada transisi `RESOLVED`.

### Bidang yang harus tampil terpisah (jangan digabung)

Detail admin memuat `priorityScore` + `priorityFactors` (deterministik, hasil
rubric) dan klasifikasi final (kategori/issue type/priority). Klasifikasi final
berasal dari **AI saat VERIFIED** atau keputusan held-verify (fallback); tidak
ada panel "saran AI yang bisa di-override" — admin tidak pernah mengubah hasil
AI yang sudah lolos (design 2026-10-14, no-override). Tampilkan keduanya
sebagai panel/kolom **berbeda**.

## 6. [Phase 6 — dibangun]

| Endpoint | Method | Sukses |
|---|---|---|
| `/api/facilities/status` | GET | query: `location_id`, `category_id`, `status`, `limit`, `offset` + `include_inactive` (admin-only flag; non-admin tidak relevan karena route admin-only) → `{ "items": [{ "assetId", "assetCode", "assetName", "locationLabel", "categoryName", "derivedStatus", "isActive", "activeReportCount", "lastUpdated" }], "total", "limit", "offset" }` — akses **admin-only** (sesi admin; bukan semua role); proyeksi tersanitasi **tanpa identitas reporter, deskripsi, attachment, internal note** |
| `/api/admin/assets/:id/history` | GET | admin-only — `200 { "asset": { ..., "derivedStatus" }, "items": [{ "reportId", "ticketNumber", "status", "reportedAt", "resolvedAt"?, "closedAt"?, "finalPriority"? }] }` (tanggal ISO, terbaru dulu) — semua tiket per asset; asset tidak ada → `404` |
| `/api/notifications` | GET | `200 { "items": [{ "id", "type", "title", "message", "reportId"?, "ticketNumber"?, "readAt"?, "createdAt" }], "total", "unreadCount" }` — milik sendiri saja; `ticketNumber` join untuk deeplink |
| `/api/notifications/:id/read` | POST | `200` — idempoten; id milik user lain/tidak ada → `404` |
| `/api/notifications/read-all` | POST | `200 { "updated" }` — tandai semua belum-dibaca milik sesi sebagai dibaca (idempoten, `updated: 0` valid) |

`derivedStatus`: `OPERATIONAL | UNDER_INSPECTION | IN_REPAIR` — diturunkan dari
laporan aktif (bukan field manual); precedence `IN_REPAIR > UNDER_INSPECTION > OPERATIONAL`.
Laporan aktif `REPORTED`/`VERIFIED` turun ke `UNDER_INSPECTION` (realignment 2026-10-17).

Jenis notifikasi yang diproduksi worker: `REPORT_VERIFIED`,
`REPORT_ASSIGNED`, `STATUS_CHANGED`, `PUBLIC_UPDATE_ADDED`,
`REPORT_RESOLVED`, `REPORT_CLOSED` (`INTERNAL_NOTE_ADDED`/`PRIORITY_CHANGED`
tidak pernah ber-notifikasi); diproses idempoten oleh worker outbox dengan
retry/backoff dan dead-letter.

## 7. Health

`GET /api/health` → status web + dependensi (db/storage/queue/worker).

## 8. UX states wajib semua halaman (EXECUTION-PLAN §10.3)

loading · empty · validation error · forbidden (403) · retryable server error
(5xx) · success feedback · responsive · keyboard focus terlihat · label form +
error message accessible.

Untuk 409: tampilkan "Tiket diperbarui admin lain — muat ulang data" dengan
aksi refresh eksplisit, **jangan** auto-retry.

