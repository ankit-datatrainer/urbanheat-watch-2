#!/usr/bin/env bash
# One-time setup of UrbanHeat Watch on a fresh Ubuntu VPS (Hostinger). Run as root:
#   curl -fsSL https://raw.githubusercontent.com/ankit-datatrainer/urbanheat-watch-2/main/deploy/setup.sh -o setup.sh && bash setup.sh
# It asks for your domain, email and the three secret keys, then installs, builds and starts everything.
set -euo pipefail

REPO="https://github.com/ankit-datatrainer/urbanheat-watch-2.git"
APP=/opt/uhw/app
WEB=/var/www/uhw

[ "$(id -u)" = 0 ] || { echo "Please run as root (sudo -i)"; exit 1; }

echo "== UrbanHeat Watch setup =="
read -rp "Your domain (e.g. urbanheatwatch.com, no https://): " DOMAIN
read -rp "Your email (for the free HTTPS certificate): " EMAIL
read -rp "OpenRouter API key (sk-or-...): " OPENROUTER_KEY
read -rp "Supabase URL (https://xxxx.supabase.co): " SUPABASE_URL
read -rsp "Supabase service_role / secret key (hidden): " SUPABASE_KEY; echo

echo "== 1/6 Installing Node.js, Nginx, Git, Certbot =="
apt-get update -y
apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx rsync ufw
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
ufw allow OpenSSH >/dev/null; ufw allow 'Nginx Full' >/dev/null; ufw --force enable >/dev/null

echo "== 2/6 Getting the code =="
id uhw >/dev/null 2>&1 || adduser --system --group --home /opt/uhw uhw
mkdir -p /opt/uhw "$WEB"
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only; else git clone "$REPO" "$APP"; fi
echo "$DOMAIN" > /opt/uhw/domain

echo "== 3/6 Writing settings =="
cat > "$APP/backend/api/.env" <<EOF
PORT=8787
HOST=127.0.0.1
TRUST_PROXY=1
CORS_ORIGINS=https://$DOMAIN,https://www.$DOMAIN
OPENROUTER_API_KEY=$OPENROUTER_KEY
OPENROUTER_MODEL=google/gemma-4-26b-a4b-it:free
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_KEY
EOF
chmod 600 "$APP/backend/api/.env"
# App settings: public values only (Supabase URL + anon key come from .env.example).
sed "s#^EXPO_PUBLIC_ECOWATCH_API_URL=.*#EXPO_PUBLIC_ECOWATCH_API_URL=https://$DOMAIN#" "$APP/.env.example" > "$APP/.env"
chown -R uhw:uhw /opt/uhw "$WEB"

echo "== 4/6 Building the app and API (takes a few minutes) =="
bash "$APP/deploy/update.sh" --no-restart

echo "== 5/6 Starting the API service =="
cp "$APP/deploy/uhw-api.service" /etc/systemd/system/uhw-api.service
systemctl daemon-reload
systemctl enable --now uhw-api
sleep 3
curl -fsS http://127.0.0.1:8787/health && echo " <- API is running"

echo "== 6/6 Website + HTTPS =="
sed "s/YOUR_DOMAIN/$DOMAIN/g" "$APP/deploy/nginx-uhw.conf" > /etc/nginx/sites-available/uhw
ln -sf /etc/nginx/sites-available/uhw /etc/nginx/sites-enabled/uhw
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx --non-interactive --agree-tos -m "$EMAIL" -d "$DOMAIN" -d "www.$DOMAIN" --redirect \
  || echo "!! HTTPS failed. Check the domain's DNS A records point to this VPS, then run: certbot --nginx -d $DOMAIN -d www.$DOMAIN"

echo
echo "Done! Open https://$DOMAIN on your phone."
echo "Health check: https://$DOMAIN/health"
