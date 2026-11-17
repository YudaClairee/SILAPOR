# Runbook Deploy VPS Pilot SILAPOR

> Runbook ringkas untuk operator. Isinya disalin dari panduan implementasi
> (Bagian B–K): provisioning VPS, user dan env, PostgreSQL di Docker, deploy
> pertama, Cloudflare Tunnel dan Access, smoke test, backup, operasional
> harian, dan troubleshooting.
>
> Arsitektur: web dan worker berjalan sebagai service systemd di VPS, PostgreSQL
> di Docker (bind `127.0.0.1`), lampiran foto di Cloudflare R2 (bucket privat),
> dan akses publik lewat Cloudflare Tunnel yang dilindungi Cloudflare Access.
>
> **Jangan pernah** memakai kredensial dev default (kredensial database dev dan
> kunci Garage) di production. Secret asli hanya ada di `/etc/silapor/silapor.env` (mode 0600).

## 3. Bagian B: Provisioning VPS

### B1. Login pertama dan user admin

Buat VPS Ubuntu 24.04 (2 vCPU / 2 GB / 20 GB) di penyedia pilihan dan
tambahkan **SSH public key** Anda saat pembuatan.

```bash
laptop$ ssh root@<ip-vps>

# Buat user admin pribadi (ganti 'operator' sesuai keinginan)
root# adduser operator
root# usermod -aG sudo operator
root# mkdir -p /home/operator/.ssh
root# cp /root/.ssh/authorized_keys /home/operator/.ssh/
root# chown -R operator:operator /home/operator/.ssh
root# chmod 700 /home/operator/.ssh && chmod 600 /home/operator/.ssh/authorized_keys
```

Buka terminal **baru** dan pastikan bisa login sebelum lanjut:

```bash
laptop$ ssh operator@<ip-vps>
vps$ sudo -v     # harus berhasil
```

### B2. Kunci SSH: key-only, tanpa root login

```bash
vps$ sudo tee /etc/ssh/sshd_config.d/99-silapor.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
EOF
vps$ sudo sshd -t && sudo systemctl restart ssh
```

> Jangan tutup sesi SSH yang sedang aktif sebelum login dari terminal baru
> terbukti berhasil.

### B3. Update, zona waktu, firewall, batas log

```bash
vps$ sudo apt update && sudo apt -y full-upgrade
vps$ sudo apt -y install git curl ca-certificates gnupg ufw shellcheck \
       unattended-upgrades fail2ban xz-utils jq
vps$ sudo timedatectl set-timezone Asia/Jakarta
vps$ sudo dpkg-reconfigure -plow unattended-upgrades   # pilih "Yes"

vps$ sudo ufw default deny incoming
vps$ sudo ufw default allow outgoing
vps$ sudo ufw allow OpenSSH
vps$ sudo ufw enable
vps$ sudo ufw status verbose
# Expected: hanya 22/tcp (OpenSSH) ALLOW IN
```

> **Catatan Docker vs ufw:** port yang di-publish Docker melewati aturan ufw.
> Karena itu compose kita mem-publish `127.0.0.1:5432:5432`, bukan
> `5432:5432`. Jangan pernah mengubahnya.

Batasi ukuran log journald agar disk 20 GB tidak habis oleh log:

```bash
vps$ sudo mkdir -p /etc/systemd/journald.conf.d
vps$ sudo tee /etc/systemd/journald.conf.d/99-silapor.conf >/dev/null <<'EOF'
[Journal]
SystemMaxUse=300M
MaxRetentionSec=30day
EOF
vps$ sudo systemctl restart systemd-journald
```

### B4. Swap 2 GB (wajib untuk VPS 2 GB)

`vite build` dan `pnpm install` bisa memakan lebih dari 1 GB RAM saat web,
worker, dan PostgreSQL masih berjalan. Tanpa swap, build bisa dimatikan sistem
(`Killed`).

```bash
vps$ sudo fallocate -l 2G /swapfile
vps$ sudo chmod 600 /swapfile
vps$ sudo mkswap /swapfile && sudo swapon /swapfile
vps$ echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
vps$ echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
vps$ sudo sysctl --system >/dev/null
vps$ free -h
# Expected: Swap: 2.0Gi
```

### B5. Install Docker Engine, Node 24.18.0, pnpm 11.21.0

**Docker Engine + compose plugin** (repo resmi Docker):

```bash
vps$ sudo install -m 0755 -d /etc/apt/keyrings
vps$ curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
vps$ sudo chmod a+r /etc/apt/keyrings/docker.gpg
vps$ echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
       | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
vps$ sudo apt update
vps$ sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
vps$ sudo systemctl enable --now docker
vps$ sudo docker run --rm hello-world
vps$ docker compose version
```

> User `silapor` **tidak** dimasukkan ke grup `docker` karena grup itu setara
> akses root. Perintah docker dijalankan dengan `sudo` oleh operator, dan
> backup dijalankan oleh root lewat systemd.

**Node 24.18.0** (dipin persis sama dengan `.moon/toolchains.yml` dan CI;
dipasang dari tarball resmi nodejs.org):

```bash
vps$ NODE_VER=24.18.0
vps$ ARCH=$(dpkg --print-architecture | sed 's/amd64/x64/')   # x64 atau arm64
vps$ cd /tmp
vps$ curl -fsSLO "https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-${ARCH}.tar.xz"
vps$ curl -fsSLO "https://nodejs.org/dist/v${NODE_VER}/SHASUMS256.txt"
vps$ grep " node-v${NODE_VER}-linux-${ARCH}.tar.xz\$" SHASUMS256.txt | sha256sum -c -
# Expected: ... OK
vps$ sudo tar -xJf "node-v${NODE_VER}-linux-${ARCH}.tar.xz" -C /usr/local --strip-components=1
vps$ rm -f "node-v${NODE_VER}-linux-${ARCH}.tar.xz" SHASUMS256.txt
vps$ node -v     # v24.18.0
vps$ which node  # /usr/local/bin/node
```

**pnpm 11.21.0** (dipasang global agar tersedia untuk semua user, termasuk
`silapor`, tanpa cache corepack per user):

```bash
vps$ sudo npm install -g pnpm@11.21.0
vps$ pnpm -v          # 11.21.0
vps$ which pnpm       # /usr/local/bin/pnpm  ← dipakai di ExecStart systemd
```

> `sharp` (dipakai `@silapor/storage` untuk memproses foto) mengunduh binary
> prebuilt untuk `linux-x64`/`linux-arm64` saat `pnpm install`. Tidak perlu
> `build-essential` atau `libvips` dari apt.

### B6. Install cloudflared

```bash
vps$ sudo mkdir -p --mode=0755 /usr/share/keyrings
vps$ curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
vps$ echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
       | sudo tee /etc/apt/sources.list.d/cloudflared.list
vps$ sudo apt update && sudo apt -y install cloudflared
vps$ cloudflared --version
```

---

## 4. Bagian C: User, Direktori, R2, dan File Env

### C1. User layanan `silapor`

```bash
vps$ sudo adduser --system --group --home /home/silapor --shell /bin/bash silapor
```

### C2. Direktori

```bash
vps$ sudo install -d -o silapor -g silapor -m 0750 /opt/silapor
vps$ sudo install -d -o silapor -g silapor -m 0750 /var/lib/silapor
vps$ sudo install -d -o root    -g root    -m 0700 /var/backups/silapor
vps$ sudo install -d -o root    -g silapor -m 0750 /etc/silapor
```

| Path | Owner | Mode | Isi |
| --- | --- | --- | --- |
| `/opt/silapor` | silapor | 0750 | clone repo |
| `/var/lib/silapor` | silapor | 0750 | `worker-beat.json`, `deployed-ref`, `deploy-history.log` (tidak ada lampiran; lampiran di R2) |
| `/var/backups/silapor` | root | 0700 | dump DB harian |
| `/etc/silapor/silapor.env` | silapor | 0600 | secret production |

### C3. Akses repo GitHub dari VPS

**Repo publik:** cukup clone lewat HTTPS:

```bash
vps$ sudo -u silapor git clone https://github.com/YudaClairee/SILAPOR.git /opt/silapor
```

**Repo privat:** pakai *deploy key* read-only:

```bash
vps$ sudo -iu silapor
silapor$ ssh-keygen -t ed25519 -N '' -C 'silapor-vps-deploy' -f ~/.ssh/id_ed25519
silapor$ cat ~/.ssh/id_ed25519.pub
# Salin ke GitHub → repo SILAPOR → Settings → Deploy keys → Add deploy key
# (centang "Allow write access": TIDAK)
silapor$ ssh-keyscan github.com >> ~/.ssh/known_hosts
silapor$ ssh -T git@github.com     # "Hi YudaClairee/SILAPOR! You've successfully authenticated..."
silapor$ git clone git@github.com:YudaClairee/SILAPOR.git /opt/silapor
silapor$ exit
```

### C4. Siapkan Cloudflare R2 (dashboard)

Di dashboard Cloudflare (dash.cloudflare.com) → **R2 Object Storage**:

**C4.1 Buat bucket**

| Field | Nilai |
| --- | --- |
| Bucket name | `silapor-pilot` |
| Location | **Specify jurisdiction/location hint → Asia-Pacific (APAC)** |
| Default storage class | Standard |

Setelah dibuat, buka bucket → **Settings**, lalu pastikan:

- **Public access → R2.dev subdomain: Disabled** (default)
- **Custom Domains:** kosong
- **CORS policy:** kosong (browser tidak pernah mengakses R2 langsung;
  semua foto lewat endpoint aplikasi)

**C4.2 Buat API token khusus bucket**

**R2 Object Storage → Manage API tokens → Create API token** (pilih *Account
API token* agar tidak terikat akun personal):

| Field | Nilai |
| --- | --- |
| Token name | `silapor-vps-pilot` |
| Permissions | **Object Read & Write** |
| Specify bucket(s) | **Apply to specific buckets only → `silapor-pilot`** |
| TTL | sesuai durasi pilot (mis. 6 bulan), atau Forever lalu rotasi manual |
| Client IP Address Filtering | *Include* → IP publik VPS (opsional, menambah lapisan keamanan) |

Setelah dibuat, Cloudflare menampilkan **sekali saja**:

- **Access Key ID** → `STORAGE_ACCESS_KEY_ID`
- **Secret Access Key** → `STORAGE_SECRET_ACCESS_KEY`
- **Endpoint S3** `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` → `STORAGE_ENDPOINT`

Simpan ketiganya di password manager. Jangan kirim lewat chat atau commit.

**C4.3 (Opsional) Bucket dev terpisah**

Buat `silapor-dev` dengan token terpisah untuk uji dari laptop (A2.5).
Jangan pernah memakai token production di laptop.

### C5. File env production

```bash
vps$ PW=$(openssl rand -hex 32)
vps$ sudo cp /opt/silapor/infra/vps/silapor.env.example /etc/silapor/silapor.env
vps$ sudo sed -i \
       -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PW}|" \
       -e "s|<POSTGRES_PASSWORD>|${PW}|" \
       /etc/silapor/silapor.env
vps$ unset PW
vps$ sudo chown silapor: /etc/silapor/silapor.env
vps$ sudo chmod 0600 /etc/silapor/silapor.env
```

Isi nilai R2 (dan `OPENROUTER_API_KEY` bila dipakai) dengan editor. Mengetik
langsung di editor mencegah secret tersimpan di riwayat shell:

```bash
vps$ sudo -u silapor nano /etc/silapor/silapor.env
#   STORAGE_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
#   STORAGE_ACCESS_KEY_ID=<dari C4.2>
#   STORAGE_SECRET_ACCESS_KEY=<dari C4.2>
#   OPENROUTER_API_KEY=<opsional>
```

Verifikasi:

```bash
vps$ sudo stat -c '%a %U' /etc/silapor/silapor.env
# Expected: 600 silapor
vps$ sudo grep -cE '<POSTGRES_PASSWORD>|<ACCOUNT_ID>' /etc/silapor/silapor.env
# Expected: 0 (semua placeholder sudah terganti)
vps$ sudo grep -E '^(NODE_ENV|STORAGE_ADAPTER|STORAGE_REGION|STORAGE_BUCKET|WORKER_BEAT_FILE|AUTH_PROVIDER)=' /etc/silapor/silapor.env
# Expected: production, s3, auto, silapor-pilot, /var/lib/silapor/worker-beat.json, mock
vps$ sudo awk -F= '/^STORAGE_(ACCESS_KEY_ID|SECRET_ACCESS_KEY)=/{print $1, (length($2)>0?"terisi":"KOSONG")}' /etc/silapor/silapor.env
# Expected: keduanya "terisi"
```

> Koneksi R2 tidak perlu diuji terpisah. Health check di akhir `deploy.sh`
> (E2) menulis dan menghapus objek probe di bucket. Kalau env R2 salah, deploy
> gagal dengan pesan `storage unavailable: ...` (lihat Bagian K).

### C6. Sudoers terbatas untuk restart service

Agar `deploy.sh` (berjalan sebagai `silapor`) bisa me-restart service tanpa
mendapat akses root penuh:

```bash
vps$ echo 'silapor ALL=(root) NOPASSWD: /usr/bin/systemctl restart silapor-web silapor-worker' \
       | sudo tee /etc/sudoers.d/silapor-deploy
vps$ sudo chmod 0440 /etc/sudoers.d/silapor-deploy
vps$ sudo visudo -cf /etc/sudoers.d/silapor-deploy     # "parsed OK"
```

> Perintah di `deploy.sh` harus **persis**
> `sudo /usr/bin/systemctl restart silapor-web silapor-worker`. Urutan atau
> argumen yang berbeda akan meminta password dan deploy gagal.

---

## 5. Bagian D: Database PostgreSQL

### D1. Jalankan PostgreSQL

```bash
vps$ cd /opt/silapor
vps$ sudo docker compose -p silapor-prod -f infra/vps/docker-compose.yml \
       --env-file /etc/silapor/silapor.env up -d
```

### D2. Verifikasi

```bash
# Password wajib (tanpa --env-file harus gagal)
vps$ sudo docker compose -p silapor-prod -f infra/vps/docker-compose.yml config >/dev/null
# Expected: error "POSTGRES_PASSWORD wajib diisi"

vps$ sudo docker compose -p silapor-prod -f infra/vps/docker-compose.yml \
       --env-file /etc/silapor/silapor.env ps
# Expected: postgres ... Up ... (healthy)

vps$ sudo ss -tlnp | grep 5432
# Expected: HANYA 127.0.0.1:5432 (bukan 0.0.0.0:5432 atau [::]:5432)

vps$ sudo docker compose -p silapor-prod -f infra/vps/docker-compose.yml \
       --env-file /etc/silapor/silapor.env exec postgres psql -U silapor -d silapor -c 'select version();'
```

> Container memakai `restart: unless-stopped` dan Docker sudah `enable`, jadi
> PostgreSQL ikut menyala otomatis setelah VPS reboot.

---

## 6. Bagian E: Deploy Pertama Aplikasi

### E1. Pasang unit systemd

```bash
vps$ sudo cp /opt/silapor/infra/vps/systemd/silapor-*.service \
            /opt/silapor/infra/vps/systemd/silapor-*.timer /etc/systemd/system/
vps$ sudo systemd-analyze verify /etc/systemd/system/silapor-web.service \
       /etc/systemd/system/silapor-worker.service \
       /etc/systemd/system/silapor-backup.service \
       /etc/systemd/system/silapor-backup.timer
vps$ sudo systemctl daemon-reload
vps$ sudo systemctl enable silapor-web silapor-worker silapor-backup.timer
vps$ (cd /opt/silapor && shellcheck infra/vps/deploy.sh infra/vps/backup.sh)
```

> Service belum di-start di sini. `deploy.sh` yang akan me-restart keduanya
> setelah build selesai.

### E2. Jalankan deploy

```bash
vps$ sudo -iu silapor
silapor$ /opt/silapor/infra/vps/deploy.sh v0.1.0-pilot
```

Urutan yang dikerjakan script:

1. `git fetch --tags` lalu checkout ref (detached)
2. `pnpm install --frozen-lockfile --prod=false`
3. load `/etc/silapor/silapor.env`
4. `db:migrate` (menerapkan `packages/database/drizzle/*.sql`)
5. `db:seed` (master data dari `data/master/*.csv`, idempoten)
6. `vite build` web
7. restart `silapor-web` dan `silapor-worker`
8. poll `/api/health` sampai `"ok":true` (maks 30 detik). Ini juga menguji
   tulis/hapus ke **R2** dan beat **worker**.
9. tulis ref ke `/var/lib/silapor/deployed-ref` dan `deploy-history.log`
10. `pnpm store prune`

Expected di akhir: `deploy selesai: <sha>` dan exit code 0. Deploy pertama di
VPS 2 GB bisa makan waktu 3–6 menit (install + build).

### E3. Verifikasi lokal di VPS

```bash
silapor$ curl -s 127.0.0.1:3000/api/health | jq
# Expected:
# {
#   "ok": true,
#   "service": "web",
#   "checks": {
#     "database": { "ok": true, ... },
#     "storage":  { "ok": true, "message": "storage writable at s3 bucket silapor-pilot" },
#     "queue":    { "ok": true, ... },
#     "worker":   { "ok": true, "message": "worker beat fresh (...)" }
#   }
# }
silapor$ ls -l /var/lib/silapor/worker-beat.json      # ada, ditulis worker
silapor$ exit

vps$ systemctl is-active silapor-web silapor-worker      # active, active
vps$ sudo ss -tlnp | grep -E ':3000|:5432'
# Expected: 127.0.0.1:3000 (node) dan 127.0.0.1:5432 (docker-proxy) — tidak ada 0.0.0.0
vps$ journalctl -u silapor-web -n 30 --no-pager           # "[silapor-web] listening on http://127.0.0.1:3000/"
vps$ journalctl -u silapor-worker -n 30 --no-pager        # "worker start", tanpa "outbox loop disabled"
vps$ free -h && df -h /                                   # RAM & disk masih lega
```

> Jika log worker berisi `worker start without DATABASE_URL; outbox loop
> disabled`, berarti env tidak terbaca. Periksa `EnvironmentFile` di unit worker.

---

## 7. Bagian F: Cloudflare Tunnel

> Lakukan bagian ini setelah persetujuan §12 didapat. Mulai dari sini aplikasi
> punya hostname publik, walaupun masih dilindungi Access.

**Penting:** buat aplikasi Cloudflare Access (Bagian G1–G3) **lebih dulu**, baru
jalankan F3 (route DNS). Kalau urutannya terbalik, ada jeda ketika hostname
terbuka tanpa proteksi dan siapa pun bisa login sebagai `admin`.

### F1. Login dan buat tunnel

```bash
vps$ sudo cloudflared tunnel login
# Buka URL yang muncul di browser, pilih zona domain Anda.
# Sertifikat tersimpan di /root/.cloudflared/cert.pem

vps$ sudo cloudflared tunnel create silapor
# Output: "Created tunnel silapor with id <TUNNEL_ID>"
# Kredensial: /root/.cloudflared/<TUNNEL_ID>.json
```

### F2. Konfigurasi

```bash
vps$ TUNNEL_ID=<TUNNEL_ID>
vps$ HOSTNAME=<HOSTNAME>          # mis. silapor.contoh-kampus.my.id
vps$ sudo mkdir -p /etc/cloudflared
vps$ sudo cp /root/.cloudflared/${TUNNEL_ID}.json /etc/cloudflared/
vps$ sudo chmod 600 /etc/cloudflared/${TUNNEL_ID}.json
vps$ sudo sed -e "s|<TUNNEL_ID>|${TUNNEL_ID}|g" -e "s|<HOSTNAME>|${HOSTNAME}|g" \
       /opt/silapor/infra/vps/cloudflared/config.example.yml | sudo tee /etc/cloudflared/config.yml
vps$ sudo cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate   # "OK"
vps$ sudo cloudflared tunnel --config /etc/cloudflared/config.yml ingress rule https://${HOSTNAME}/
# Expected: Matched rule #0 ... service: http://127.0.0.1:3000
```

### F3. DNS dan service

```bash
vps$ sudo cloudflared tunnel route dns silapor ${HOSTNAME}
vps$ sudo cloudflared --config /etc/cloudflared/config.yml service install
vps$ sudo systemctl enable --now cloudflared
vps$ systemctl is-active cloudflared                       # active
vps$ sudo cloudflared tunnel info silapor                  # menampilkan koneksi aktif
```

> `cloudflared` otomatis mengirim header `X-Forwarded-For`,
> `X-Forwarded-Proto: https`, dan `Cf-Connecting-Ip` ke origin. Aplikasi
> memakai `X-Forwarded-For` untuk kunci rate-limit login dan
> `X-Forwarded-Proto` untuk atribut cookie `Secure`
> (`apps/web/src/routes/api/auth/login.ts`).

---

## 8. Bagian G: Cloudflare Access

Di dashboard Cloudflare: **Zero Trust** (one.dash.cloudflare.com). Saat pertama
kali masuk, pilih *team name* dan paket **Free** (hingga 50 user).

### G1. Metode login

**Settings → Authentication → Login methods → Add new → One-time PIN.**
(Tersedia default. Tidak perlu IdP.)

### G2. Buat aplikasi

**Access → Applications → Add an application → Self-hosted**

| Field | Nilai |
| --- | --- |
| Application name | `SILAPOR Pilot` |
| Session duration | `24 hours` |
| Public hostname | subdomain + domain = `<HOSTNAME>`, path kosong |
| Identity providers | **One-time PIN** saja |
| Instant Auth | aktif (langsung ke OTP karena hanya satu IdP) |

### G3. Policy

**Add a policy:**

| Field | Nilai |
| --- | --- |
| Policy name | `Allowlist penguji` |
| Action | **Allow** |
| Include → Emails ending in | `@student.kampus.ac.id` (domain kampus, jika semua sivitas boleh) |
| Include → Emails | daftar email penguji spesifik (dosen, tim) |

Hanya **Allow** policy yang dipakai. Email yang tidak cocok otomatis ditolak.

> Jangan buat policy *Bypass* atau *Everyone* untuk `/api/health` atau path
> lain. Health check cukup dilakukan dari dalam VPS (`127.0.0.1:3000`).
>
> Paket Free Zero Trust dibatasi 50 user. Bila penguji lebih dari 50 orang,
> pertimbangkan paket berbayar atau batasi allowlist.

### G4. (Opsional) Validasi JWT Access di origin

Lapisan tambahan: tolak request yang tidak membawa header
`Cf-Access-Jwt-Assertion`. Tidak wajib untuk pilot karena origin hanya bind
`127.0.0.1` dan tidak bisa dijangkau tanpa tunnel. Catat sebagai pekerjaan
lanjutan bila nanti ada jalur akses lain.

---

## 9. Bagian H: Smoke Test dari Luar

Jalankan dari **perangkat lain** (laptop/HP), bukan dari VPS.

| # | Uji | Perintah / langkah | Hasil yang diharapkan |
| --- | --- | --- | --- |
| 1 | Access aktif | `curl -sI https://<HOSTNAME>/` | `302` ke `https://<team>.cloudflareaccess.com/...`, bukan HTML aplikasi |
| 2 | Origin tidak terbuka | `curl -s --max-time 5 http://<ip-vps>:3000/` | timeout / connection refused |
| 3 | DB tidak terbuka | `nc -vz -w 5 <ip-vps> 5432` | timeout / refused |
| 4 | Port publik | `nmap -Pn <ip-vps>` (opsional) | hanya `22/tcp open` |
| 5 | Bucket R2 tidak publik | `curl -s -o /dev/null -w '%{http_code}\n' https://<ACCOUNT_ID>.r2.cloudflarestorage.com/silapor-pilot/` | `400`/`401`/`403` (butuh tanda tangan S3), bukan daftar objek |
| 6 | Login admin | Browser → email allowlist → OTP → login aplikasi `admin` | `/admin` tampil |
| 7 | Cookie Secure | DevTools → Network → `POST /api/auth/login` → Response headers | `Set-Cookie: …; HttpOnly; …; Secure` |
| 8 | Akun manajerial | Logout → login `manajerial` | `/managerial` tampil (desain baru), tanpa menu admin; buka `/admin` → dialihkan ke `/managerial` |
| 9 | Reporter + lampiran ke R2 | Login username lain (mis. `mahasiswa1`) → buat laporan dengan 1–3 foto | laporan muncul di admin, foto tampil; di dashboard R2 → bucket `silapor-pilot` → **Objects** muncul objek baru berawalan `att` |
| 10 | Foto tidak di disk VPS | Di VPS: `sudo find /opt/silapor /var/lib/silapor -path '*attachments*' -type f \| head` | tidak ada output |
| 11 | Lampiran persisten | Di VPS: `sudo systemctl restart silapor-web silapor-worker` → refresh laporan | foto masih tampil |
| 12 | URL foto lewat aplikasi | Klik kanan foto → *Copy image address* | URL di `<HOSTNAME>` (endpoint aplikasi), bukan `r2.cloudflarestorage.com` |
| 13 | Worker memproses outbox | Admin mengubah status laporan → cek notifikasi pelapor | notifikasi muncul; `journalctl -u silapor-worker` tanpa error berulang |
| 14 | Allowlist | Email di luar allowlist | ditolak Access ("That account does not have access") |

Cek juga di VPS bahwa header proxy sampai:

```bash
vps$ journalctl -u silapor-web --since '10 min ago' --no-pager | grep -i login | tail
# Rate-limit login memakai IP klien asli, bukan "unknown"
```

### Akun uji

| Username | Peran |
| --- | --- |
| `admin` | ADMIN |
| `manajerial` | MANAGERIAL |
| username lain | REPORTER |

Password **tidak diverifikasi** (mock SSO). Karena itu Cloudflare Access adalah
satu-satunya kontrol akses. Jangan pernah menonaktifkannya selama
`AUTH_PROVIDER=mock`.

---

## 10. Bagian I: Backup dan Restore

Data SILAPOR ada di **dua tempat**:

| Data | Lokasi | Backup |
| --- | --- | --- |
| Relasional (laporan, user, status, metadata lampiran) | PostgreSQL di VPS | `pg_dump` harian 02:00 WIB, retensi 14 hari di `/var/backups/silapor` (I1) + salin ke laptop (I4) |
| Byte foto | Cloudflare R2 | Disimpan redundan oleh Cloudflare (tahan kerusakan hardware). **Tidak** terlindung dari penghapusan oleh aplikasi atau operator. Salin berkala dengan `rclone` (I5) |

### I1. Uji backup manual

```bash
vps$ sudo systemctl start silapor-backup.service
vps$ sudo journalctl -u silapor-backup -n 20 --no-pager      # "backup ok: db-<ts>.dump (...)"
vps$ sudo ls -lh /var/backups/silapor
# Expected: db-<ts>.dump, ukuran > 0
vps$ systemctl list-timers silapor-backup.timer
# Expected: NEXT ... 02:00:00 WIB
```

### I2. Uji restore (wajib dicoba minimal sekali sebelum go-live)

Restore ke database sementara agar data asli tidak tersentuh:

```bash
vps$ C="sudo docker compose -p silapor-prod -f /opt/silapor/infra/vps/docker-compose.yml --env-file /etc/silapor/silapor.env"
vps$ LATEST=$(sudo ls -1t /var/backups/silapor/db-*.dump | head -1)
vps$ $C exec -T postgres createdb -U silapor silapor_restore_test
vps$ sudo cat "$LATEST" | $C exec -T postgres pg_restore -U silapor -d silapor_restore_test --no-owner
vps$ $C exec postgres psql -U silapor -d silapor_restore_test -c 'select count(*) from users;'
vps$ $C exec postgres psql -U silapor -d silapor_restore_test -c 'select count(*) from report_attachments;'
vps$ $C exec -T postgres dropdb -U silapor silapor_restore_test
```

### I3. Restore sungguhan (insiden database)

```bash
vps$ sudo systemctl stop silapor-web silapor-worker
vps$ C="sudo docker compose -p silapor-prod -f /opt/silapor/infra/vps/docker-compose.yml --env-file /etc/silapor/silapor.env"
vps$ DUMP=/var/backups/silapor/db-<ts>.dump
vps$ sudo cat "$DUMP" | $C exec -T postgres pg_restore -U silapor -d silapor --clean --if-exists --no-owner
vps$ sudo systemctl start silapor-web silapor-worker
vps$ curl -s 127.0.0.1:3000/api/health | jq .ok
```

> **Konsistensi DB ↔ R2:** dump DB berasal dari pukul 02:00, sedangkan R2
> selalu berisi kondisi terbaru. Setelah restore:
> - Foto yang diunggah **setelah** dump tetap ada di R2 tetapi tidak punya baris
>   DB (yatim). Aman, hanya memakan ruang. Bisa dibersihkan dengan janitor
>   `packages/database/src/attachment-cleanup.ts` (memakai `listS3Keys`).
> - Foto yang **dihapus** setelah dump sudah hilang dari R2, sehingga baris DB
>   hasil restore menunjuk objek yang tidak ada (`brokenRefs`). Foto tersebut
>   tampil sebagai gagal dimuat. Kalau perlu, pulihkan dari salinan rclone (I5).

### I4. Salin dump DB ke luar VPS (disarankan)

Backup yang hanya ada di VPS ikut hilang kalau VPS rusak. Tarik secara berkala
ke laptop:

```bash
vps$ sudo install -d -o operator -g operator -m 0700 /home/operator/silapor-dumps
vps$ sudo sh -c 'cp /var/backups/silapor/db-*.dump /home/operator/silapor-dumps/ && chown operator: /home/operator/silapor-dumps/*'
laptop$ rsync -avz operator@<ip-vps>:silapor-dumps/ ./backup-silapor/db/
vps$ rm -f /home/operator/silapor-dumps/*.dump
```

### I5. Salin isi R2 ke luar (disarankan, misalnya mingguan)

Pakai `rclone` dari **laptop** (bukan VPS, agar disk 20 GB tidak terpakai).
Buat token R2 **terpisah** dengan izin **Object Read only** untuk bucket
`silapor-pilot`.

```bash
laptop$ rclone config create r2-pilot s3 provider=Cloudflare \
          access_key_id=<read-only-key> secret_access_key=<read-only-secret> \
          endpoint=https://<ACCOUNT_ID>.r2.cloudflarestorage.com acl=private
laptop$ rclone copy r2-pilot:silapor-pilot ./backup-silapor/r2/ --progress
```

`rclone copy` tidak menghapus file lokal yang sudah dihapus di R2, sehingga
salinan lokal juga berfungsi sebagai arsip foto yang terhapus.

---

## 11. Bagian J: Operasional Harian

### J1. Redeploy versi baru

```bash
laptop$ git tag v0.1.1-pilot && git push origin v0.1.1-pilot

laptop$ ssh operator@<ip-vps>
vps$ sudo systemctl start silapor-backup.service          # backup dulu bila ada migrasi baru
vps$ sudo -iu silapor /opt/silapor/infra/vps/deploy.sh v0.1.1-pilot
```

### J2. Rollback

```bash
vps$ sudo -u silapor tail -5 /var/lib/silapor/deploy-history.log   # lihat ref sebelumnya
vps$ sudo -iu silapor /opt/silapor/infra/vps/deploy.sh <sha-sebelumnya>
```

> Migrasi Drizzle hanya maju (tidak ada down migration). Bila versi baru
> menambahkan migrasi yang tidak kompatibel dengan kode lama, rollback kode
> saja tidak cukup. Restore DB dari backup sebelum deploy (I3). Untuk itu,
> **jalankan backup manual sebelum setiap deploy yang membawa migrasi baru**
> (sudah ada di J1).

### J3. Log

```bash
vps$ journalctl -u silapor-web -f
vps$ journalctl -u silapor-worker -f
vps$ journalctl -u cloudflared -f
vps$ sudo docker logs -f silapor-prod-postgres-1
```

### J4. Status cepat

```bash
vps$ systemctl is-active silapor-web silapor-worker cloudflared docker
vps$ curl -s 127.0.0.1:3000/api/health | jq '{ok, db: .checks.database.ok, storage: .checks.storage.message, worker: .checks.worker.message}'
vps$ cat /var/lib/silapor/deployed-ref
vps$ free -h && df -h / && sudo du -sh /var/backups/silapor
```

Pemakaian R2 (ukuran bucket, jumlah operasi) dipantau di dashboard Cloudflare
→ **R2 → silapor-pilot → Metrics**.

### J5. Mengubah env

```bash
vps$ sudo -u silapor nano /etc/silapor/silapor.env
vps$ sudo systemctl restart silapor-web silapor-worker
```

Jika `POSTGRES_PASSWORD` diganti, ubah juga password di database. Variabel
`POSTGRES_PASSWORD` hanya dipakai saat volume pertama kali dibuat:

```bash
vps$ C="sudo docker compose -p silapor-prod -f /opt/silapor/infra/vps/docker-compose.yml --env-file /etc/silapor/silapor.env"
vps$ $C exec postgres psql -U silapor -d silapor -c "ALTER USER silapor PASSWORD '<password-baru>';"
```

### J6. Rotasi token R2

1. Dashboard R2 → **Manage API tokens** → buat token baru (izin dan bucket sama
   seperti C4.2).
2. Ganti `STORAGE_ACCESS_KEY_ID` dan `STORAGE_SECRET_ACCESS_KEY` di env file
   (J5), lalu restart web.
3. `curl -s 127.0.0.1:3000/api/health | jq .checks.storage` → `ok: true`.
4. Hapus (*Roll/Delete*) token lama di dashboard.

### J7. Reboot VPS

Setelah `sudo reboot`, semua komponen menyala sendiri: Docker → PostgreSQL
(`unless-stopped`), `silapor-web`, `silapor-worker`, `cloudflared` (enabled).
Cek dengan J4.

### J8. Yang tidak boleh dilakukan di production

- `pnpm --filter @silapor/database run db:reset-reports` (diblok oleh
  `NODE_ENV=production`; jangan pakai `--allow-production`). Script ini juga
  hanya mengenal filesystem, sehingga tidak membersihkan R2.
- `docker compose down -v` (menghapus volume `silapor-pgdata` beserta semua data).
- Mengubah port compose menjadi `5432:5432` atau `HOST=0.0.0.0` di web.
- Mengaktifkan *Public access* / `r2.dev` / custom domain pada bucket
  `silapor-pilot`.
- Memakai token R2 dengan izin *Admin* atau berlaku untuk semua bucket.
- Mematikan aplikasi Cloudflare Access.

---

## 12. Bagian K: Troubleshooting

| Gejala | Kemungkinan penyebab | Solusi |
| --- | --- | --- |
| `deploy.sh` berhenti di `pnpm install` dengan error lockfile | lockfile tidak sinkron dengan `package.json` di ref tersebut | Jalankan `pnpm install` di laptop, commit `pnpm-lock.yaml`, push, deploy ulang |
| `vite build` terbunuh (`Killed`) | RAM habis | Pastikan swap aktif (`free -h`, B4). Bila tetap gagal: `sudo systemctl stop silapor-worker` sebelum deploy atau naikkan RAM |
| `db:migrate failed: unable to apply migrations` | PostgreSQL mati atau `DATABASE_URL` salah | `docker compose … ps`; periksa password di URL sama dengan `POSTGRES_PASSWORD` |
| `password authentication failed for user "silapor"` | volume dibuat dengan password lama | Lihat J5 (ALTER USER) |
| `sudo: a password is required` di akhir deploy | perintah restart tidak persis sama dengan sudoers | Samakan dengan C6 |
| `silapor-web` restart terus, log `Cannot find module .../dist/server/server.js` | build belum dijalankan | Jalankan `deploy.sh` (melakukan build), bukan restart manual |
| `silapor-web` gagal: `pnpm: not found` (status 203/EXEC) | path pnpm berbeda | `command -v pnpm`, sesuaikan `ExecStart`, `daemon-reload` |
| Health: `storage unavailable: Missing STORAGE_ENDPOINT` / `Missing STORAGE_ACCESS_KEY_ID` | env R2 kosong atau tidak terbaca | Periksa C5; nilai tanpa tanda kutip/spasi |
| Health: `storage unavailable: ... InvalidRegionName` / `region` | `STORAGE_REGION` bukan `auto`, atau perubahan A2 belum ter-deploy | Set `STORAGE_REGION=auto`; pastikan ref berisi commit A2 |
| Health: `storage unavailable: Access Denied` / `403` | token salah, kedaluwarsa, tidak mencakup bucket, atau IP filter tidak cocok | Cek token di dashboard R2 (bucket, izin, TTL, IP filter); rotasi (J6) |
| Health: `storage unavailable: NoSuchBucket` | nama bucket salah | `STORAGE_BUCKET` harus persis `silapor-pilot` |
| Health: `storage unavailable: ... checksum` / `NotImplemented` | header checksum SDK ditolak | Pastikan `requestChecksumCalculation: 'WHEN_REQUIRED'` (A2.2/A2.3) ter-deploy |
| Health: `storage unavailable: timed out after 2000ms` | jaringan VPS → R2 lambat sesaat | Ulangi; bila sering, cek `curl -sI https://<ACCOUNT_ID>.r2.cloudflarestorage.com` dari VPS |
| Health: `storage writable at ./.data/attachments` | `STORAGE_ADAPTER` tidak terbaca (jatuh ke filesystem) | Pastikan `STORAGE_ADAPTER=s3` di env file dan unit memakai `EnvironmentFile` |
| Upload foto gagal `413` / "exceeds the maximum" | foto > 5 MB | Batas aplikasi (`MAX_ATTACHMENT_BYTES`); kompres foto |
| Foto lama "gagal dimuat" setelah restore DB | objek sudah dihapus dari R2 setelah waktu dump | Lihat catatan konsistensi di I3; pulihkan dari salinan rclone (I5) |
| Health: `worker beat stale` padahal worker `active` | worker hanya memperbarui beat saat start/memproses pesan; saat sepi beat bisa melewati 5 menit | Keterbatasan pilot yang sudah diketahui. Cek `journalctl -u silapor-worker`. Tidak memengaruhi deploy karena health dicek tepat setelah restart |
| Health: `worker beat not found` | `WORKER_BEAT_FILE` berbeda antara web dan worker, atau worker mati | Pastikan keduanya membaca env file yang sama; `systemctl status silapor-worker` |
| Log worker: `outbox loop disabled` | `DATABASE_URL` tidak terbaca worker | Periksa `EnvironmentFile` di `silapor-worker.service` |
| Notifikasi tidak muncul | worker mati atau error DB | `journalctl -u silapor-worker -n 100`; outbox tertahan `PENDING` dan diproses saat worker hidup lagi |
| `https://<HOSTNAME>` → error 1033 | tunnel tidak terhubung | `systemctl status cloudflared`, `cloudflared tunnel info silapor` |
| `https://<HOSTNAME>` → 502 Bad Gateway | web mati atau port berbeda | `systemctl status silapor-web`, `curl 127.0.0.1:3000/api/health` |
| Aplikasi tampil tanpa halaman OTP | aplikasi Access belum dibuat atau hostname salah | Periksa G2; hostname harus persis sama |
| Semua user kena rate-limit login bersamaan | header `X-Forwarded-For` tidak sampai (kunci `unknown`) | Pastikan akses lewat tunnel, bukan SSH port-forward |
| Cookie tanpa `Secure` | `X-Forwarded-Proto` tidak `https` dan `NODE_ENV` bukan `production` | Periksa env file |
| `silapor-web` mati dengan `oom-kill` di journal | melewati `MemoryMax=700M` | Naikkan `MemoryMax` di unit, `daemon-reload`, restart |
| Disk hampir penuh | log, pnpm store, atau dump menumpuk | `sudo du -xh / --max-depth=2 \| sort -h \| tail`; `pnpm store prune`; `sudo journalctl --vacuum-size=200M`; `sudo docker system prune` (tanpa `--volumes`) |

---

## 13. Lampiran: Checklist Go-Live

### Repo (Bagian A)
- [ ] A1 runner production: test 4 passed, smoke test lokal OK, commit
- [ ] A2 storage R2-compatible (`STORAGE_REGION`, checksum `WHEN_REQUIRED`, health via factory): test lulus, commit
- [ ] A3 compose + env template + worker start, commit
- [ ] A4 systemd + deploy.sh + backup.sh, shellcheck bersih, commit
- [ ] A5 cloudflared config + `docs/deploy-vps.md` + README + `.env.example`, commit
- [ ] A6 PR di-merge, gate Moon hijau, tag rilis di-push

### Cloudflare R2 (Bagian C4)
- [ ] Bucket `silapor-pilot` (APAC), public access/r2.dev **mati**, tanpa custom domain
- [ ] Token *Object Read & Write* hanya untuk `silapor-pilot`, tersimpan di password manager
- [ ] (Opsional) token read-only untuk rclone, bucket `silapor-dev` untuk laptop

### VPS (Bagian B–E)
- [ ] SSH key-only, root login mati
- [ ] `ufw status` → hanya OpenSSH
- [ ] Swap 2 GB aktif, journald dibatasi 300 MB
- [ ] `node -v` = v24.18.0, `pnpm -v` = 11.21.0, `docker compose version` OK
- [ ] `stat /etc/silapor/silapor.env` → `600 silapor`, semua placeholder terganti
- [ ] PostgreSQL healthy, hanya `127.0.0.1:5432`
- [ ] `deploy.sh <ref>` exit 0
- [ ] `/api/health` → `ok`; `storage` = `s3 bucket silapor-pilot`; `database`, `worker` ok
- [ ] `systemctl is-active silapor-web silapor-worker` → active ×2

### Publik (Bagian F–H), setelah persetujuan §12
- [ ] Aplikasi Access dibuat **sebelum** route DNS
- [ ] `cloudflared` active, `ingress validate` OK
- [ ] Smoke test 1–14 lulus (termasuk foto masuk R2, bukan disk VPS)
- [ ] Email di luar allowlist ditolak

### Backup (Bagian I)
- [ ] Backup manual menghasilkan `db-*.dump` > 0 byte
- [ ] Timer terjadwal 02:00 WIB
- [ ] Uji restore ke DB sementara berhasil
- [ ] Salinan dump ke laptop (I4) dan salinan R2 via rclone (I5) dicoba sekali

### Dokumentasi
- [ ] Catat output verifikasi (tanpa secret, tanpa IP publik, tanpa Account ID) di
  `docs/bukti/2026-11-<dd>-vps-golive.txt`
- [ ] Perbarui `docs/decisions/PHASE-0-PRODUCT-DECISIONS.md` §12
  (VPS + PostgreSQL Docker + Cloudflare R2)
- [ ] Commit: `docs: record VPS go-live evidence`
