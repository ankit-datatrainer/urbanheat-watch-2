# ECOWATCH---OneEarth-NextGen-Innovators-2026-Project
## Satellite heat map (Home and Heat map tab)

The main map shows land-surface (ground) temperature measured by NASA's MODIS instruments on the Terra and Aqua satellites, read from NASA GIBS (no API key needed). The API picks the newest clear daytime pass from the last three days, falls back to the 8-day composite when it is cloudy, re-colours the tiles with a tropical heat palette (`/api/v1/satellite/tiles/...`) and reports the city's average, hottest spot and coverage (`/api/v1/satellite/lst`). Tap the map to read the satellite value at any point. The photo layer is Esri World Imagery (commercial use needs an ArcGIS key; on iOS/Android the native Apple/Google satellite map is used instead).

Satellites measure ground temperature, not air temperature or humidity, so the small live strip and the heat-stress (WBGT) guidance still use the nearest weather station; the app labels that source.

## Languages

English, Bahasa Melayu, 繁體中文 (Hong Kong), 简体中文, हिन्दी, தமிழ் and తెలుగు. Strings are keyed by their English text (`lib/i18n/locales/*.json`); the AI assistant is told to reply in the chosen language. After adding UI text, run `node scripts/extract-strings.mjs` to list strings each language is missing.

## Accounts and AI assistant setup

1. Copy `.env.example` to `.env` and fill in `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_ECOWATCH_API_URL`. Restart Expo after changing `.env`.
2. The AI assistant talks to the EcoWatch backend, which holds the OpenRouter key. Put `OPENROUTER_API_KEY` in `backend/api/.env` and start the API (`cd backend/api && npm install && npm run dev`). The key is never bundled into the app. See [`backend/README.md`](backend/README.md).
3. In the Supabase dashboard, open **SQL Editor**, paste [`supabase/schema.sql`](supabase/schema.sql) and run it. This creates the `profiles` table (filled automatically on sign-up), the `ai_messages` table that stores each signed-in user's AI chat history, and the `family_members` table plus `accept_family_invite` function behind Family tab invites. Until `family_members` exists, family lists are kept on the device. Row-level security limits every row to its owner.
4. Sign-up without verification emails: put the Supabase service key in `backend/api/.env` as `SUPABASE_SERVICE_ROLE_KEY` (Project Settings > API Keys; never in the app's `.env`) and restart the API. The app then creates accounts through `POST /api/v1/auth/signup`, already confirmed, and signs the person straight in. Without the key the app falls back to Supabase's own sign-up, which sends a confirmation email while **Confirm email** is on and is limited to a few emails per hour.

The Profile tab shows a live diagnostic for Supabase, the AI assistant and the satellite feed. Every feature needs an account (there is no guest mode).
