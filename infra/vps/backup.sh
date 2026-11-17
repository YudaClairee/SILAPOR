#!/usr/bin/env bash
# Backup harian SILAPOR: pg_dump (format custom), retensi 14 hari.
# Lampiran ada di Cloudflare R2 (lihat Bagian I untuk salinan R2 off-site).
# Dijalankan oleh silapor-backup.service (root).
set -euo pipefail

BACKUP_DIR=/var/backups/silapor
COMPOSE_FILE=/opt/silapor/infra/vps/docker-compose.yml
ENV_FILE=/etc/silapor/silapor.env
RETENTION_DAYS=14
TS="$(date -u +%Y%m%dT%H%M%SZ)"

umask 077
mkdir -p "$BACKUP_DIR"

# --env-file wajib: compose menolak berjalan tanpa POSTGRES_PASSWORD.
docker compose -p silapor-prod -f "$COMPOSE_FILE" --env-file "$ENV_FILE" \
  exec -T postgres pg_dump -U silapor -Fc silapor > "$BACKUP_DIR/db-$TS.dump.partial"
mv "$BACKUP_DIR/db-$TS.dump.partial" "$BACKUP_DIR/db-$TS.dump"

# Sanity: dump tidak boleh kosong.
if [[ ! -s "$BACKUP_DIR/db-$TS.dump" ]]; then
  echo "backup GAGAL: dump kosong" >&2
  exit 1
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name '*.partial' \) \
  -mtime +"$RETENTION_DAYS" -delete

echo "backup ok: db-$TS.dump ($(du -h "$BACKUP_DIR/db-$TS.dump" | cut -f1))"
