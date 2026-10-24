#!/usr/bin/env bash
# Get the latest code from GitHub, rebuild the web app and API, and restart. Run as root on the VPS:
#   bash /opt/uhw/app/deploy/update.sh
set -euo pipefail

APP=/opt/uhw/app
WEB=/var/www/uhw
DOMAIN=$(cat /opt/uhw/domain)

# The code folder belongs to the uhw user; allow root to update it.
git config --global --get-all safe.directory | grep -qx "$APP" || git config --global --add safe.directory "$APP"
git -C "$APP" pull --ff-only

# npm ci is exact; older npm versions can reject a lock made by newer npm, so fall back to npm install.
cd "$APP/backend/api" && { npm ci --no-audit --no-fund || npm install --no-audit --no-fund; }
cd "$APP" && { npm ci --no-audit --no-fund || npm install --no-audit --no-fund; }
git -C "$APP" checkout -- package-lock.json backend/api/package-lock.json 2>/dev/null || true
npx expo export -p web --output-dir dist
# Fill the real address into the link-preview tags.
sed -i "s#__SITE_URL__#https://$DOMAIN#g" dist/index.html
rsync -a --delete dist/ "$WEB/"
chown -R uhw:uhw /opt/uhw "$WEB"

if [ "${1:-}" != "--no-restart" ]; then
  systemctl restart uhw-api
  sleep 3
  curl -fsS http://127.0.0.1:8787/health && echo " <- API is running"
  echo "Updated: https://$DOMAIN"
fi
