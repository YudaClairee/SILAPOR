# Dashboard Manajerial Pure Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan dashboard manajerial berbasis aturan deterministik yang merangkum risiko aset, lokasi dengan keluhan terbanyak, tren, dan prioritas laporan.

**Architecture:** Gunakan endpoint overview analytics yang sudah menggabungkan seluruh query dalam satu response. Tambahkan route dashboard khusus dengan komponen presentasional yang hanya memetakan response menjadi kartu, ranking, tren, filter, dan drill-down; tidak ada pemanggilan AI atau kalkulasi prediktif.

**Tech Stack:** React 19, TanStack Router, TypeScript, Tailwind CSS, Vitest, paket workspace `@silapor/analytics`.

**Spec:** `docs/superpowers/specs/2026-11-15-dashboard-manajerial-pure-logic-design.md`

## Global Constraints

- Tidak menggunakan model AI, generative summary, atau prediksi machine learning pada tahap ini.
- Tidak mengubah workflow admin, status laporan, data master, atau aturan scoring yang sudah ada.
- Filter `from` dan `to` memakai format `YYYY-MM-DD`, inklusif pada hari Jakarta.
- Nilai kosong ditampilkan sebagai empty state atau em dash, bukan angka buatan.
- Copy antarmuka menggunakan Bahasa Indonesia yang ringkas.

## Review Focus

- Rentang tanggal kosong dan batas hari Jakarta harus diteruskan tanpa mengubah kontrak endpoint — diuji pada route/loader.
- Response analytics kosong harus menghasilkan empty state, bukan chart kosong yang ambigu — diuji pada komponen.
- Response endpoint gagal, tidak tersedia, atau forbidden harus terlihat jelas — diuji pada loader/komponen.
- Ranking lokasi dan aset harus mempertahankan urutan serta nilai dari analytics — diuji pada transformasi.
- Link drill-down tidak boleh kehilangan konteks entitas yang dipilih — diuji pada render link.

---

### Task 1: Membuat pure-logic view model dashboard manajerial

**Files:**
- Create: `apps/web/src/lib/managerial-dashboard.ts`
- Test: `apps/web/src/lib/managerial-dashboard.test.ts`

**Interfaces:**
- Consumes: `DashboardOverviewResponse` dari `apps/web/src/server/analytics.ts`.
- Produces: `ManagerialDashboardViewModel`, `buildManagerialDashboardViewModel(data)`, dan formatter durasi yang aman untuk nilai `null`.

- [ ] **Step 1: Write the failing tests**

  Tambahkan test untuk:
  - memetakan kartu ringkasan dan waktu penyelesaian;
  - mempertahankan ranking `byLocation`, `byBuilding`, `topAssets`, dan `priorityQueue`;
  - memetakan `trend` harian dan seluruh kartu analytics;
  - mengubah nilai kosong menjadi label presentasi yang eksplisit;
  - tidak mengubah response input.

- [ ] **Step 2: Run the focused test**

  Run: `pnpm --filter @silapor/web test -- src/lib/managerial-dashboard.test.ts`

  Expected: FAIL karena modul dan fungsi view model belum ada.

- [ ] **Step 3: Implement the view model**

  Implement `buildManagerialDashboardViewModel(data: DashboardOverviewResponse): ManagerialDashboardViewModel` sebagai transformasi murni tanpa fetch, Date.now, AI, atau side effect. Gunakan tipe analytics yang sudah ada dan formatter durasi yang konsisten dengan halaman analytics.

- [ ] **Step 4: Run the focused test**

  Run: `pnpm --filter @silapor/web test -- src/lib/managerial-dashboard.test.ts`

  Expected: PASS.

### Task 2: Menambahkan halaman dashboard manajerial

**Files:**
- Create: `apps/web/src/routes/admin.managerial.tsx`
- Modify: `apps/web/src/routeTree.gen.ts`
- Test: `apps/web/src/routes/admin.managerial.test.tsx`

**Interfaces:**
- Consumes: `ManagerialDashboardViewModel` dari Task 1 dan endpoint `/api/admin/analytics/overview`.
- Produces: route `/admin/managerial` dengan filter periode, kartu ringkasan, ranking lokasi/aset, tren harian, antrian prioritas global, serta state loading/error/forbidden/empty.

- [ ] **Step 1: Write the failing component tests**

  Uji render judul dan kartu, ranking lokasi/aset, empty state, error state, serta link ke detail laporan/aset dengan identifier yang benar.

- [ ] **Step 2: Run the focused test**

  Run: `pnpm --filter @silapor/web test -- src/routes/managerial.test.tsx`

  Expected: FAIL karena route dan komponen belum ada.

- [ ] **Step 3: Implement route and page**

  Salin pola request/loader dari `apps/web/src/routes/admin.analytics.tsx`, tetapi gunakan view model Task 1 untuk presentasi. Pertahankan query `from`/`to`, redirect unauthorized, pesan error eksplisit, dan navigasi drill-down ke route laporan/aset yang sudah ada. Label `resolvedThisMonth` sebagai “Selesai bulan ini”; tampilkan `priorityQueue` sebagai antrian global dan `trend` sebagai tren harian. Jangan menambahkan kalkulasi yang tidak berasal dari response analytics.

- [ ] **Step 4: Register route**

  Jalankan generator route yang sudah dipakai repository atau perbarui `routeTree.gen.ts` dengan pola yang dihasilkan, lalu pastikan TypeScript mengenali `/managerial`.

- [ ] **Step 5: Run focused tests**

  Run: `pnpm --filter @silapor/web test -- src/routes/managerial.test.tsx`

  Expected: PASS.

### Task 3: Menambahkan akses navigasi dashboard

**Files:**
- Modify: `apps/web/src/components/AdminShell.tsx`
- Test: `apps/web/src/components/AdminShell.test.tsx`

**Interfaces:**
- Consumes: route `/admin/managerial` dari Task 2.
- Produces: entry navigasi dashboard manajerial di shell admin; guard tetap memakai aturan admin yang ada.

- [ ] **Step 1: Write failing guard/navigation tests**

  Tambahkan test untuk visibility link dashboard manajerial dan tujuan `/admin/managerial`, mengikuti pola test yang sudah ada.

- [ ] **Step 2: Run focused tests**

  Run: `pnpm --filter @silapor/web test -- src/components/AdminShell.test.tsx`

  Expected: FAIL pada ekspektasi baru.

- [ ] **Step 3: Implement minimal access wiring**

  Tambahkan link “Dashboard Manajerial” ke navigasi admin. Jangan menambah role baru atau mengubah guard; route `/admin/managerial` otomatis berada di bawah layout dan guard admin.

- [ ] **Step 4: Run focused tests**

  Run: `pnpm --filter @silapor/web test -- src/components/AdminShell.test.tsx`

  Expected: PASS.

### Task 4: Verifikasi dashboard end-to-end

**Files:**
- Modify: `apps/web/e2e/reports.spec.ts` only if an existing e2e fixture can cover the new route without unrelated setup.

- [ ] **Step 1: Run targeted unit tests**

  Run: `pnpm --filter @silapor/web test -- src/lib/managerial-dashboard.test.ts src/routes/admin.managerial.test.tsx src/components/AdminShell.test.tsx`

  Expected: PASS.

- [ ] **Step 2: Run typecheck and lint**

  Run: `pnpm --filter @silapor/web typecheck && pnpm --filter @silapor/web lint`

  Expected: both commands exit 0.

- [ ] **Step 3: Run the relevant e2e smoke test**

  Run: `pnpm --filter @silapor/web test:e2e -- e2e/health.spec.ts`

  Expected: PASS, or document an environment-only blocker with the exact output.
