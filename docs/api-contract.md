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
  - Status tiket: `REPORTED → VERIFIED → ASSIGNED → INSPECTION → IN_REPAIR → RESOLVED → CLOSED`; terminal tambahan: `REJECTED`, `DUPLICATE`
  - Priority: `LOW | MEDIUM | HIGH` (tidak ada CRITICAL)
  - Visibility update: `PUBLIC | INTERNAL`

## 1. Auth

| Endpoint | Method | Request | Sukses | Gagal |
|---|---|---|---|---|
| `/api/auth/login` | POST | `{ "username": "...", "password": "..." }` | `200 { "user": { "id", "username", "role": "REPORTER"|"ADMIN" } }` + Set-Cookie | `401` kredensial salah; `429` rate-limit (5 gagal / 10 menit) |
| `/api/auth/logout` | POST | — | `200`, cookie dihapus | — |
| `/api/auth/me` | GET | — | `200 { "user": { "id", "username", "role" } }` | `401` belum login |


## 2. Reporter — form & daftar laporan

| Endpoint | Method | Request | Sukses |
|---|---|---|---|
| `/api/reports/form-options` | GET | — | `200 { "locations": [], "categories": [], "issueTypes": [], "assets": [] }` — hanya data aktif; untuk dependent select (lokasi → kategori → issue type → asset) |
| `/api/reports` | GET | query: `status`, `category_id`, `location_id`, `priority`, `from`, `to`, `q`, `limit`, `offset` | `200 { "items": ReportItem[], "total": number }` — selalu **hanya laporan milik sendiri** |
| `/api/reports` | POST | header **wajib** `x-idempotency-key`; body: `{ "location_id", "asset_id"?, "submitted_category_id", "submitted_issue_type_id"?, "description" (10–2000 char), "occurred_at"? }` | `201` (baru) / `200` (replay idempotent): `{ "report": {...}, "duplicateCandidates": [...], "idempotentReplay": boolean }` |
| `/api/reports/duplicate-check` | GET | query: `location_id`, `category_id`, `issue_type_id`?, `asset_id`? | `200 { "count": number, "candidates": [{ "ticketNumber", "status", "reportedAt" }] }` — **warning saja**, tidak memblokir submit; tawarkan link ke ticket existing |
| `/api/reports/:id` | GET | — | `200` detail; ownership dijaga server — 404 identik untuk tiket milik orang lain (jangan tampilkan "bukan milik Anda") |
| `/api/reports/:id/timeline` | GET | — | `200` array `TimelineEntry` terurut kronologis — **sudah disanitasi**: entri INTERNAL hilang, `actorId = null`, note hanya untuk event publik |

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
| `/api/admin/reports/:id/verify` | POST | `{ "finalCategoryId", "finalIssueTypeId", "finalPriority", "assetId"?, "locationId"?, "overrideReason"?, "expectedVersion" }` | `200` report |
| `/api/admin/reports/:id/reject` | POST | `{ "reason", "expectedVersion" }` | `200` |
| `/api/admin/reports/:id/duplicate` | POST | `{ "canonicalReportId", "expectedVersion" }` | `200` |
| `/api/admin/reports/:id/priority` | POST | `{ "priority", "reason", "expectedVersion" }` — `reason` wajib bila beda dari saran | `200` |
| `/api/admin/reports/:id/assign` | POST | `{ "technicianId", "expectedVersion" }` — hanya teknisi aktif | `200` |
| `/api/admin/reports/:id/transition` | POST | `{ "status", "note"?, "expectedVersion" }` — `note` wajib untuk inspection/resolution/reopen | `200` |
| `/api/admin/reports/:id/updates` | POST | `{ "visibility": "PUBLIC"\|"INTERNAL", "message" }` | `200/201` |

**Aturan UI wajib dari state machine:**

- hanya tampilkan tombol next status yang valid (server menolak transisi ilegal dengan 400);
- transisi ke status terminal minta confirmation;
- **selalu kirim `expectedVersion`** dari data terakhir yang dimuat admin — dua admin mengubah tiket sama menghasilkan 409 untuk yang lambat;
- tampilkan form resolution note pada transisi `RESOLVED`.

### Bidang yang harus tampil terpisah (jangan digabung)

Detail admin memuat `priorityScore` + `priorityFactors` (deterministik, hasil
rubric), placeholder AI (pending — Phase 8), dan `finalPriority` (keputusan
admin). UI harus memvisualkan ketiganya sebagai panel/kolom **berbeda** —
saran tidak boleh terlihat seperti keputusan final.

## 6. [Phase 6 — kontrak rencana, belum dibangun]

| Endpoint | Method | Sukses (rencana) |
|---|---|---|
| `/api/facilities/status` | GET | query: `location_id`, `category_id`, `status`, `limit`, `offset` → `{ "items": [{ "assetId", "assetName", "locationLabel", "categoryName", "derivedStatus", "lastUpdated" }], "total" }` — projection publik **tanpa identitas reporter, deskripsi, attachment, internal note** |
| `/api/admin/assets/:id/history` | GET | semua ticket per asset + status + tanggal (maintenance history) |
| `/api/notifications` | GET | `{ "items": [{ "id", "type", "title", "message", "reportId"?, "readAt"?, "createdAt" }], "total", "unreadCount" }` — milik sendiri saja |
| `/api/notifications/:id/read` | POST | `200` |

`derivedStatus`: `OPERATIONAL | REPORTED_ISSUE | UNDER_INSPECTION | IN_REPAIR`
— diturunkan dari laporan aktif (bukan field manual); precedence
`IN_REPAIR > UNDER_INSPECTION > REPORTED_ISSUE`.

## 7. Health

`GET /api/health` → status web + dependensi (db/storage/queue/worker).

## 8. UX states wajib semua halaman (EXECUTION-PLAN §10.3)

loading · empty · validation error · forbidden (403) · retryable server error
(5xx) · success feedback · responsive · keyboard focus terlihat · label form +
error message accessible.

Untuk 409: tampilkan "Tiket diperbarui admin lain — muat ulang data" dengan
aksi refresh eksplisit, **jangan** auto-retry.

