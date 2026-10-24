#!/usr/bin/env bash
# Get the latest code from GitHub, rebuild the web app and API, and restart. Run as root on the VPS:
#   bash /opt/uhw/app/deploy/update.sh
set -euo pipefail

APP=/opt/uhw/app
WEB=/var/www/uhw
DOMAIN=$(cat /opt/uhw/domain)

git -C "$APP" pull --ff-only

cd "$APP/backend/api" && npm ci --no-audit --no-fund
cd "$APP" && npm ci --no-audit --no-fund
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
