# Deploy UrbanHeat Watch (Hostinger VPS + your domain)

When it's done, anyone can open `https://YOUR_DOMAIN` on a phone. It installs like an app via "Add to Home Screen", and the link shows a preview card when shared.

## Before you start, have these ready

1. **VPS IP address** and **root password** (Hostinger → VPS → Overview)
2. **Your domain**
3. From your laptop's `backend/api/.env`:
   - `OPENROUTER_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

## Step 1: Point the domain to the VPS

Hostinger → **Domains** → your domain → **DNS / Nameservers** → **DNS records**:

| Type | Name | Points to |
|---|---|---|
| A | `@` | VPS IP |
| A | `www` | VPS IP |

Delete any old `A` records for `@` or `www` first. Wait 10–30 minutes.

## Step 2: Open the VPS terminal

Hostinger → **VPS** → **Browser terminal**. Or on your laptop run `ssh root@VPS_IP` and enter the password.

## Step 3: Run the setup (one command)

```bash
curl -fsSL https://raw.githubusercontent.com/ankit-datatrainer/urbanheat-watch-2/main/deploy/setup.sh -o setup.sh && bash setup.sh
```

It asks 5 questions:
1. domain
2. email
3. OpenRouter key
4. Supabase URL
5. Supabase service key (hidden while typing)

Then it installs, builds and starts everything. This takes about 5–10 minutes.

## Step 4: Supabase setting

Supabase dashboard → **Authentication** → **URL Configuration** → **Site URL** = `https://YOUR_DOMAIN` → Save.

## Step 5: Test

- `https://YOUR_DOMAIN/health` returns `{"ok":true}`
- Open `https://YOUR_DOMAIN` on your phone: splash, login, Home map, AI chat
- **Install it:**
  - **Android (Chrome):** menu ⋮ → **Install app** (or **Add to Home screen**)
  - **iPhone (Safari):** Share → **Add to Home Screen**

## Updating later

Push changes to GitHub, then in the VPS terminal:

```bash
bash /opt/uhw/app/deploy/update.sh
```

## If something goes wrong

- **API logs:** `journalctl -u uhw-api -n 50`
- **HTTPS failed:** DNS isn't ready yet. Wait, then run `certbot --nginx -d YOUR_DOMAIN -d www.YOUR_DOMAIN`
- **Page doesn't load:** run `systemctl status nginx`. If another web server is using port 80 (some Hostinger templates have one), stop it with `systemctl disable --now apache2`.
- **Private GitHub repo:** make it public, or the setup can't download the code.
