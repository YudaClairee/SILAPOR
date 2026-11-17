#!/usr/bin/env bash
# Deploy SILAPOR ke VPS dari ref git yang sudah di-push.
# Pakai (sebagai user silapor):  /opt/silapor/infra/vps/deploy.sh <git-ref>
# Contoh: deploy.sh v0.1.0-pilot   |   deploy.sh origin/main   |   deploy.sh 1a2b3c4
set -euo pipefail

REF="${1:?Usage: deploy.sh <git-ref>}"
APP_DIR=/opt/silapor
ENV_FILE=/etc/silapor/silapor.env
STATE_DIR=/var/lib/silapor
HEALTH_URL=http://127.0.0.1:3000/api/health
HEALTH_TIMEOUT=30

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

if [[ "$(id -un)" != "silapor" ]]; then
  echo "deploy.sh harus dijalankan sebagai user silapor (sudo -iu silapor)." >&2
  exit 1
fi

cd "$APP_DIR"

log "fetch origin"
git fetch --tags --prune origin

PREV_REF="$(git rev-parse HEAD)"
log "checkout $REF (sebelumnya: $PREV_REF)"
git checkout --detach "$REF"
NEW_REF="$(git rev-parse HEAD)"

log "pnpm install (frozen lockfile, termasuk devDependencies untuk build)"
# NODE_ENV belum di-load di sini; --prod=false memastikan vite/tsx ikut terpasang.
pnpm install --frozen-lockfile --prod=false

log "load env"
set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

log "migrate database"
pnpm --filter @silapor/database run db:migrate

log "seed master data (idempoten)"
pnpm --filter @silapor/database run db:seed

log "build web"
pnpm --filter @silapor/web run build

log "restart service"
sudo /usr/bin/systemctl restart silapor-web silapor-worker

log "health check (maks ${HEALTH_TIMEOUT}s; mencakup database, R2, dan worker beat)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
body=""
while (( $(date +%s) < deadline )); do
  if body="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null)"; then
    if [[ "$body" == *'"ok":true'* ]]; then
      log "sehat: $body"
      printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$NEW_REF" "$REF" \
        >> "$STATE_DIR/deploy-history.log"
      printf '%s\n' "$NEW_REF" > "$STATE_DIR/deployed-ref"
      log "bersihkan pnpm store (hemat disk)"
      pnpm store prune || true
      log "deploy selesai: $NEW_REF"
      exit 0
    fi
  fi
  sleep 2
done

log "GAGAL: health tidak ok dalam ${HEALTH_TIMEOUT}s. Respons terakhir: ${body:-<tidak ada>}"
log "Rollback cepat: $APP_DIR/infra/vps/deploy.sh $PREV_REF"
exit 1
