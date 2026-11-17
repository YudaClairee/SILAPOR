# VPS Deploy (Pilot Uji Sivitas Akademika) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menjalankan SILAPOR (web + worker + PostgreSQL) di satu VPS yang selalu menyala, dapat diakses penguji lewat HTTPS tanpa laptop developer, dan hanya oleh orang yang diizinkan.

**Architecture:** Satu VPS Ubuntu menjalankan PostgreSQL via Docker Compose (bind `127.0.0.1`), web TanStack Start sebagai proses Node (runner `srvx` yang melayani `dist/client` + handler `dist/server/server.js`, bind `127.0.0.1:3000`), dan worker sebagai proses Node, keduanya diawasi systemd. `cloudflared` di VPS membuka Cloudflare Tunnel ke `127.0.0.1:3000`; Cloudflare Access (email OTP + allowlist) berdiri di depan hostname karena login pilot masih mock SSO. Tidak ada port aplikasi yang terbuka ke internet.

**Tech Stack:** Ubuntu 24.04 LTS, Docker Compose, Node 24.18.0, pnpm 11.21.0, `srvx` 0.11.22, `tsx`, systemd, Cloudflare Tunnel (`cloudflared`), Cloudflare Access, `pg_dump`.

**Spec:** Keputusan percakapan 2026-11-16 (belum ada dokumen spec): uji coba ke sivitas akademika di luar kelas membutuhkan host yang selalu menyala; Cloudflare Tunnel dijalankan dari VPS, bukan laptop; akses dibatasi Cloudflare Access karena mock SSO tidak memverifikasi password; kredensial dev diganti; backup harian. Catatan: `docs/decisions/PHASE-0-PRODUCT-DECISIONS.md` §12 masih menyatakan "VPS ditunda" — butuh persetujuan tim/dosen sebelum Task 5 (go-live).

## Global Constraints

- Prasyarat: perubahan dashboard manajerial yang masih uncommitted di `main` sudah di-commit dan di-push; VPS men-deploy dari ref git yang di-push, bukan dari laptop.
- Node `24.18.0` dan pnpm `11.21.0` (sama dengan `.moon/toolchains.yml` dan CI). Install dengan `pnpm install --frozen-lockfile`.
- Web dan PostgreSQL hanya bind ke `127.0.0.1`; satu-satunya port publik VPS adalah SSH (22).
- Semua path data absolut di bawah `/var/lib/silapor` (`STORAGE_DIR=/var/lib/silapor/attachments`, `WORKER_BEAT_FILE=/var/lib/silapor/worker-beat.json`), tidak bergantung pada cwd.
- File env production: `/etc/silapor/silapor.env`, mode `0600`, owner `silapor`; tidak pernah di-commit. Repo hanya berisi `infra/vps/silapor.env.example` tanpa secret.
- `NODE_ENV=production` di web dan worker (mengaktifkan cookie `Secure` fallback dan proteksi `db:reset-reports`).
- `AUTH_PROVIDER=mock` tetap (satu-satunya nilai pilot); akses publik wajib di belakang Cloudflare Access.
- Garage tidak dijalankan di VPS (pilot memakai filesystem adapter; YAGNI).
- Kode aplikasi (`packages/*`, route) tidak diubah kecuali runner production di Task 1.

## Review Focus

- **Origin bypass Access:** seseorang mengakses `http://<ip-vps>:3000` atau `:5432` langsung → harus gagal (bind `127.0.0.1` + ufw). Dipinned di Task 1 (default hostname `127.0.0.1`) dan Task 2 (port mapping `127.0.0.1:5432`), diverifikasi di Task 5.
- **Path traversal di runner static:** `GET /assets/../../server/server.js` atau `/%2e%2e/server/server.js` → tidak boleh mengembalikan isi bundle server. Test di Task 1.
- **Data hilang saat redeploy/restart:** lampiran dan beat file ditulis relatif ke cwd → hilang/terpisah. Path absolut di Task 2; `GET /api/health` `checks.storage.ok === true` diverifikasi di Task 4.
- **Password DB default/kosong:** compose dijalankan tanpa `POSTGRES_PASSWORD` → harus gagal, bukan jatuh ke `silapor`. Verifikasi `docker compose config` di Task 2.
- **Header proxy hilang:** tanpa `X-Forwarded-For`/`X-Forwarded-Proto` semua login berbagi kunci rate-limit `unknown` dan cookie tanpa `Secure`. Verifikasi header lewat tunnel di Task 5.

---

## File Structure

| File | Tanggung jawab |
| --- | --- |
| `apps/web/src/server/production-server.ts` | Factory server production: static `dist/client` + delegasi ke handler Start, bind default `127.0.0.1`. |
| `apps/web/src/server/production-server.test.ts` | Test runner (static, delegasi, traversal, hostname default). |
| `apps/web/scripts/start.ts` | Entry tipis: baca `PORT`, import `dist/server/server.js`, panggil factory. |
| `apps/web/package.json` | Dependensi `srvx` 0.11.22, script `start`. |
| `apps/worker/package.json` | Script `start`. |
| `infra/vps/docker-compose.yml` | PostgreSQL production (127.0.0.1, password wajib, volume). |
| `infra/vps/silapor.env.example` | Daftar env production tanpa secret. |
| `infra/vps/systemd/silapor-web.service`, `silapor-worker.service` | Unit systemd. |
| `infra/vps/systemd/silapor-backup.service`, `silapor-backup.timer` | Backup harian. |
| `infra/vps/deploy.sh` | Pull ref → install → migrate → seed → build → restart → health check. |
| `infra/vps/backup.sh` | `pg_dump` + arsip lampiran, retensi 14 hari. |
| `infra/vps/cloudflared/config.example.yml` | Ingress tunnel ke `127.0.0.1:3000`. |
| `docs/deploy-vps.md` | Runbook operator (provisioning, Cloudflare, rollback, smoke test). |

---

### Task 1: Runner production untuk web

**Files:**
- Create: `apps/web/src/server/production-server.ts`
- Create: `apps/web/src/server/production-server.test.ts`
- Create: `apps/web/scripts/start.ts`
- Modify: `apps/web/package.json` (dependencies `"srvx": "0.11.22"` dan `"tsx": "^4.23.15"` — versi sama dengan `apps/worker`; `tsx` di `dependencies` karena dipakai saat runtime; script `"start": "tsx scripts/start.ts"`)

**Interfaces:**
- Produces:
  ```ts
  export interface ProductionServerOptions {
    readonly fetch: (request: Request) => Response | Promise<Response>;
    readonly clientDir: string;   // absolut, mis. apps/web/dist/client
    readonly port: number;
    readonly hostname?: string;   // default '127.0.0.1'
  }
  export function createProductionServer(options: ProductionServerOptions): import('srvx').Server;
  ```
  Memakai `serve` dari `srvx` dan middleware `serveStatic({ dir: clientDir })` dari `srvx/static`; request yang bukan file static diteruskan ke `options.fetch`.
- `scripts/start.ts`: `PORT` dari env (default `3000`), `clientDir = resolve(import.meta.dirname, '../dist/client')`, handler = default export `../dist/server/server.js` (`{ fetch }`).

- [ ] **Step 1: Tulis test yang gagal** di `production-server.test.ts` (env node). Siapkan `clientDir` sementara (`mkdtemp`) berisi `assets/app.js` (`console.log(1)`) dan file rahasia di luar dir (`../secret.txt`). Server dibuat dengan `port: 0` dan `fetch: () => new Response('ssr', { status: 200 })`, lalu `await server.ready()` dan pakai `server.url`.
  - `it('melayani file static dari clientDir')` → `GET /assets/app.js` status 200, body `console.log(1)`, `content-type` mengandung `javascript`.
  - `it('meneruskan path non-static ke handler Start')` → `GET /login` body `ssr`.
  - `it('tidak melayani file di luar clientDir')` → `GET /assets/../../secret.txt` dan `GET /%2e%2e/secret.txt` body bukan isi `secret.txt`.
  - `it('bind ke 127.0.0.1 secara default')` → `new URL(server.url).hostname === '127.0.0.1'`.
  - `afterEach` menutup server (`await server.close()`).
- [ ] **Step 2: Jalankan dan pastikan gagal**
  Run: `pnpm --filter @silapor/web exec vitest run src/server/production-server.test.ts`
  Expected: FAIL — modul `./production-server` tidak ada.
- [ ] **Step 3: Tambah `srvx` 0.11.22 ke `apps/web/package.json`, `pnpm install` (lockfile sudah memuat versi ini), implementasikan `createProductionServer` dan `scripts/start.ts`.**
- [ ] **Step 4: Jalankan test, pastikan lulus**
  Run: `pnpm --filter @silapor/web exec vitest run src/server/production-server.test.ts`
  Expected: 4 passed.
- [ ] **Step 5: Smoke test lokal**
  Run: `pnpm --filter @silapor/web run build && PORT=3100 NODE_ENV=production pnpm --filter @silapor/web run start` lalu di terminal lain `curl -s localhost:3100/api/health` dan `curl -sI localhost:3100/login`.
  Expected: health JSON `"service":"web"`; `/login` status 200 dan HTML memuat `<script` yang menunjuk `/assets/…` yang juga bisa di-`curl` dengan status 200.
- [ ] **Step 6: Gate repo**
  Run: `pnpm exec moon run web:lint web:typecheck web:test`
  Expected: semua hijau.
- [ ] **Step 7: Commit**
  ```bash
  git add apps/web/src/server/production-server.ts apps/web/src/server/production-server.test.ts apps/web/scripts/start.ts apps/web/package.json pnpm-lock.yaml
  git commit -m "feat(web): add production node runner"
  ```

### Task 2: Konfigurasi production (PostgreSQL, env, worker start)

**Files:**
- Create: `infra/vps/docker-compose.yml`
- Create: `infra/vps/silapor.env.example`
- Modify: `apps/worker/package.json` (script `"start": "tsx src/index.ts"`)

**Interfaces:**
- Produces: nama env yang dibaca Task 3–5: `NODE_ENV`, `PORT`, `DATABASE_URL`, `POSTGRES_PASSWORD`, `STORAGE_DIR`, `WORKER_BEAT_FILE`, `AUTH_PROVIDER`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `AI_VERIFY_TIMEOUT_MS`.
- Service compose bernama `postgres`, project name `silapor-prod`, volume `silapor-pgdata`.

- [ ] **Step 1: Tulis `infra/vps/docker-compose.yml`**: image `postgres:16`, `POSTGRES_DB=silapor`, `POSTGRES_USER=silapor`, `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD wajib diisi}`, `ports: ['127.0.0.1:5432:5432']`, healthcheck sama dengan `docker-compose.yml` root, `restart: unless-stopped`.
- [ ] **Step 2: Tulis `silapor.env.example`** dengan nilai:
  `NODE_ENV=production`, `PORT=3000`, `POSTGRES_PASSWORD=` (kosong, wajib diisi ≥ 32 karakter acak), `DATABASE_URL=postgres://silapor:<POSTGRES_PASSWORD>@127.0.0.1:5432/silapor`, `STORAGE_DIR=/var/lib/silapor/attachments`, `WORKER_BEAT_FILE=/var/lib/silapor/worker-beat.json`, `AUTH_PROVIDER=mock`, `OPENROUTER_API_KEY=` (kosong = laporan di-hold untuk review admin), `OPENROUTER_MODEL=google/gemini-2.5-flash`. Sertakan komentar bahwa file asli berada di `/etc/silapor/silapor.env` mode `0600`.
- [ ] **Step 3: Verifikasi password wajib**
  Run: `docker compose -p silapor-prod -f infra/vps/docker-compose.yml config` (tanpa env)
  Expected: gagal dengan pesan `POSTGRES_PASSWORD wajib diisi`.
  Run: `POSTGRES_PASSWORD=x docker compose -p silapor-prod -f infra/vps/docker-compose.yml config`
  Expected: sukses, output memuat `host_ip: 127.0.0.1`.
  (Bila Docker tidak tersedia di mesin dev, jalankan langkah ini di VPS pada Task 5 Step 3.)
- [ ] **Step 4: Commit**
  ```bash
  git add infra/vps/docker-compose.yml infra/vps/silapor.env.example apps/worker/package.json
  git commit -m "chore(infra): add production postgres compose and env template"
  ```

### Task 3: systemd, deploy script, dan backup

**Files:**
- Create: `infra/vps/systemd/silapor-web.service`
- Create: `infra/vps/systemd/silapor-worker.service`
- Create: `infra/vps/systemd/silapor-backup.service`, `infra/vps/systemd/silapor-backup.timer`
- Create: `infra/vps/deploy.sh`
- Create: `infra/vps/backup.sh`

**Interfaces:**
- Consumes: script `start` (Task 1, Task 2), env file `/etc/silapor/silapor.env` (Task 2).
- Produces: unit `silapor-web`, `silapor-worker`, `silapor-backup.timer`; `deploy.sh <git-ref>`; `backup.sh` menulis ke `/var/backups/silapor`.

- [ ] **Step 1: Unit web/worker**: `User=silapor`, `WorkingDirectory=/opt/silapor`, `EnvironmentFile=/etc/silapor/silapor.env`, `ExecStart=/usr/bin/env pnpm --filter @silapor/web run start` (worker: `@silapor/worker`), `Restart=always`, `RestartSec=5`, `After=docker.service network-online.target`, `ReadWritePaths=/var/lib/silapor`, `NoNewPrivileges=true`.
- [ ] **Step 2: `deploy.sh <ref>`** (`set -euo pipefail`, dijalankan sebagai `silapor` di `/opt/silapor`): `git fetch --tags origin` → `git checkout --detach <ref>` → `pnpm install --frozen-lockfile` → load env (`set -a; . /etc/silapor/silapor.env; set +a`) → `pnpm --filter @silapor/database run db:migrate` → `pnpm --filter @silapor/database run db:seed` → `pnpm --filter @silapor/web run build` → `sudo systemctl restart silapor-web silapor-worker` → poll `curl -fsS http://127.0.0.1:3000/api/health` maks 30 detik; exit non-zero bila health tidak `"ok":true`. Cetak ref yang ter-deploy ke `/var/lib/silapor/deployed-ref`.
- [ ] **Step 3: `backup.sh`**: `docker compose -p silapor-prod -f /opt/silapor/infra/vps/docker-compose.yml exec -T postgres pg_dump -U silapor -Fc silapor > /var/backups/silapor/db-<UTC timestamp>.dump`, `tar -czf /var/backups/silapor/attachments-<timestamp>.tar.gz -C /var/lib/silapor attachments`, hapus file > 14 hari (`find … -mtime +14 -delete`). Timer: `OnCalendar=*-*-* 02:00 Asia/Jakarta`, `Persistent=true`.
- [ ] **Step 4: Lint script**
  Run: `shellcheck infra/vps/deploy.sh infra/vps/backup.sh && systemd-analyze verify infra/vps/systemd/*.service infra/vps/systemd/*.timer`
  Expected: tanpa error (peringatan path `/opt/silapor` yang belum ada di mesin dev boleh diabaikan; ulangi di VPS pada Task 5).
- [ ] **Step 5: Commit**
  ```bash
  git add infra/vps/systemd infra/vps/deploy.sh infra/vps/backup.sh
  git commit -m "chore(infra): add systemd units, deploy and backup scripts"
  ```

### Task 4: Konfigurasi tunnel dan runbook operator

**Files:**
- Create: `infra/vps/cloudflared/config.example.yml`
- Create: `docs/deploy-vps.md`
- Modify: `README.md` (satu paragraf di bawah "Pilot note" yang menautkan `docs/deploy-vps.md`)

**Interfaces:**
- Consumes: semua artefak Task 1–3.
- Produces: runbook yang dieksekusi di Task 5.

- [ ] **Step 1: `config.example.yml`**: `tunnel: <TUNNEL_ID>`, `credentials-file: /etc/cloudflared/<TUNNEL_ID>.json`, `ingress: - hostname: <HOSTNAME> service: http://127.0.0.1:3000` lalu `- service: http_status:404`.
- [ ] **Step 2: `docs/deploy-vps.md`** berisi bagian berurutan:
  1. *Keputusan operator* (diisi sebelum mulai): penyedia VPS (≥ 2 GB RAM, Ubuntu 24.04), domain di Cloudflare, `<HOSTNAME>`, daftar email/domain allowlist Access.
  2. *Provisioning*: user `silapor`, SSH key-only, `ufw default deny incoming; ufw allow OpenSSH; ufw enable`, install Docker Engine + compose plugin, Node 24.18.0, `corepack enable && corepack prepare pnpm@11.21.0 --activate`, `shellcheck`.
  3. *Direktori*: `/opt/silapor` (clone), `/var/lib/silapor/attachments`, `/var/backups/silapor`, `/etc/silapor/silapor.env` (0600) — semua milik `silapor`; sudoers terbatas untuk `systemctl restart silapor-web silapor-worker`.
  4. *Database*: `docker compose -p silapor-prod -f infra/vps/docker-compose.yml --env-file /etc/silapor/silapor.env up -d`.
  5. *Deploy pertama*: salin unit ke `/etc/systemd/system`, `systemctl daemon-reload`, `enable silapor-web silapor-worker silapor-backup.timer`, jalankan `infra/vps/deploy.sh <ref>`.
  6. *Cloudflare Tunnel*: `cloudflared tunnel login`, `tunnel create silapor`, salin config, `tunnel route dns silapor <HOSTNAME>`, `cloudflared service install`.
  7. *Cloudflare Access*: Zero Trust → Applications → Self-hosted untuk `<HOSTNAME>`, policy *Allow* dengan *Emails ending in* domain kampus dan/atau daftar email penguji, login method *One-time PIN*, session 24 jam.
  8. *Rollback*: `deploy.sh <ref-sebelumnya>` (dari `/var/lib/silapor/deployed-ref` riwayat git); restore DB: `pg_restore --clean -d silapor` dari dump terakhir.
  9. *Smoke test* (checklist Task 5 Step 5).
  10. *Akun uji*: `admin` (ADMIN), `manajerial` (MANAGERIAL), username lain → REPORTER; password tidak diverifikasi — karena itu Access wajib.
- [ ] **Step 3: Review runbook** terhadap Global Constraints (port, path, mode file, Node/pnpm versi). Tidak ada command yang memakai nilai default dev (`silapor:silapor`, kunci Garage).
- [ ] **Step 4: Commit**
  ```bash
  git add infra/vps/cloudflared docs/deploy-vps.md README.md
  git commit -m "docs: add VPS deploy runbook and tunnel config"
  ```

### Task 5: Go-live di VPS (operator + verifikasi)

**Prasyarat:** persetujuan tim/dosen atas perubahan keputusan deployment §12; Task 1–4 ter-merge dan di-push; keputusan operator di runbook terisi.

- [ ] **Step 1: Provisioning dan direktori** sesuai runbook bagian 2–3.
  Verify: `ss -tlnp` hanya menampilkan `0.0.0.0:22` sebagai listener publik.
- [ ] **Step 2: Isi `/etc/silapor/silapor.env`** dari template; `POSTGRES_PASSWORD` dari `openssl rand -base64 36`.
  Verify: `stat -c '%a %U' /etc/silapor/silapor.env` → `600 silapor`.
- [ ] **Step 3: Database + verifikasi compose** (Task 2 Step 3 bila belum).
  Verify: `docker compose -p silapor-prod -f infra/vps/docker-compose.yml ps` → `postgres` healthy; `ss -tlnp | grep 5432` → `127.0.0.1:5432` saja.
- [ ] **Step 4: Deploy pertama + tunnel + Access** (runbook 5–7).
  Verify: `infra/vps/deploy.sh <ref>` exit 0; `curl -s 127.0.0.1:3000/api/health` → `"ok":true` dengan `checks.storage.ok` dan `checks.database.ok` true; `systemctl is-active silapor-web silapor-worker cloudflared` → `active` ×3.
- [ ] **Step 5: Smoke test dari luar** (perangkat lain, bukan VPS):
  - `curl -sI https://<HOSTNAME>/` → redirect ke halaman login Cloudflare Access (bukan aplikasi).
  - `curl -s --max-time 5 http://<ip-vps>:3000/` dan `:5432` → timeout/ditolak.
  - Login Access dengan email allowlist → login aplikasi sebagai `admin` → `/admin` tampil; header respons login memuat `Set-Cookie: …; Secure`.
  - Login `manajerial` → `/managerial` tampil dengan desain baru, tanpa menu admin; buka `/admin` → dialihkan ke `/managerial`.
  - Login reporter → buat laporan dengan foto → laporan muncul di admin; restart `silapor-web` → foto masih tampil.
  - Email di luar allowlist → ditolak Access.
- [ ] **Step 6: Backup**
  Run: `sudo systemctl start silapor-backup.service && ls -l /var/backups/silapor`
  Expected: satu `db-*.dump` dan satu `attachments-*.tar.gz` berukuran > 0; `systemctl list-timers silapor-backup.timer` menampilkan jadwal 02:00.
- [ ] **Step 7: Catat hasil** di `docs/bukti/2026-11-<dd>-vps-golive.txt` (output Step 4–6, tanpa secret/IP publik) dan commit `docs: record VPS go-live evidence`.
