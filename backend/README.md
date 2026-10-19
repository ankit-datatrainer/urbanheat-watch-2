# Eco Watch backend: city environment and satellite heat map

This backend powers the **City heat & satellite** tab (`app/(tabs)/heatmap.tsx`). It has two parts:

| Service | Path | Stack | Role |
|---|---|---|---|
| API gateway | `backend/api` | Node 24, TypeScript, Fastify, zod | Public API for the app: place search, weather, advisory, official-warning slot, OpenRouter explanation, the AI assistant chat proxy, and a proxy for tiles and pixel values |
| Geospatial worker | `backend/worker` | Python 3.13, FastAPI, xarray/netCDF4, rasterio/GDAL, pyproj, scipy | Internal only: Copernicus STAC discovery, authenticated S3 download, LST decoding, quality masking, regridding, COG output, tiles and pixel queries |

The mobile app never contacts Copernicus, OpenRouter or Open-Meteo directly, and no credentials are bundled into it.

## Three separate concepts

1. **Satellite land-surface temperature (LST).** Sentinel-3 SLSTR Level-2 radiative skin temperature of ground and roofs, about 1 km resolution. It is not air temperature, not WBGT and not a warning.
2. **Air temperature and forecasts.** Open-Meteo numerical-model output for a grid cell (`dataType: "modelled"`). It is not a station reading.
3. **Human heat-stress guidance.**
   - **Official warning:** only from a configured authoritative provider. None is configured yet, so the API reports `provider_not_configured` and says that this does *not* mean no warning exists.
   - **Eco Watch advisory:** deterministic rules. A band is assigned only where a documented scheme exists. Today that means Singapore, using the NEA-published WBGT category from the nearest station within 10 km. Everywhere else the advisory is `unclassified` (forecast shown, no fabricated band). Missing or stale data gives `unknown`, never "safe".
   - **AI explanation:** OpenRouter, validated against a strict JSON schema. The classification is attached by the server, so the model cannot change it. Timeouts or invalid output fall back to deterministic text.

## Setup

### 1. CDSE registration and S3 credentials (needed for satellite processing)

1. Create a free account at <https://dataspace.copernicus.eu/>.
2. Generate S3 credentials as described in <https://documentation.dataspace.copernicus.eu/APIs/S3.html>. Use the S3 key manager linked there and sign in with your CDSE account.
3. Put them in `backend/worker/.env`:
   ```
   CDSE_S3_ACCESS_KEY_ID=...
   CDSE_S3_SECRET_ACCESS_KEY=...
   ```
4. S3 keys have an expiry date and usage quotas set by CDSE. Check the S3 documentation and the CDSE terms; processing is not unlimited.

Without credentials, STAC discovery (public) still runs. The satellite section then returns `configuration_required` and lists the products it found. No heat map is generated or faked.

### 2. Worker

```bash
cd backend/worker
py -3.13 -m venv .venv              # or: python3.13 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # macOS/Linux: .venv/bin/python
cp .env.example .env                # then fill in values
.venv/Scripts/python -m uvicorn ecowatch_worker.app:app --host 127.0.0.1 --port 8790 --env-file .env
```

Keep the worker on a private interface. The API authenticates to it with `WORKER_TOKEN`.

### 3. API gateway

```bash
cd backend/api
npm install
cp .env.example .env                # same WORKER_TOKEN as the worker; OPENROUTER_API_KEY for AI
npm run dev                         # or: npm start
```

### 4. Mobile app

In the repository root, set `EXPO_PUBLIC_ECOWATCH_API_URL` in `.env`. On a phone, use your computer's LAN IP instead of `localhost`. For Expo web on another port or host, add that origin to `CORS_ORIGINS`. Then:

```bash
npm install
npx expo start
```

`react-native-maps` is included in Expo Go. A store build for Android needs a Google Maps API key (see the Expo `react-native-maps` docs). On web the map is a fixed-view tile mosaic over OpenStreetMap tiles.

## Tests

```bash
cd backend/worker && .venv/Scripts/python -m pytest -q
cd backend/api && npm test && npm run typecheck
npx tsc --noEmit                    # repository root: mobile type check
```

The raster unit tests use a **synthetic** NetCDF fixture (`backend/worker/tests/synthetic_product.py`, clearly labelled). It copies the documented SL_2_LST structure: packed Kelvin LST with scale/offset/fill, packed lat/lon, and `confidence_in` flags with `flag_meanings`/`flag_masks`. Upstream HTTP responses in tests are mocks. Real-product verification is an opt-in live test:

```bash
cd backend/worker
EW_LIVE=1 CDSE_S3_ACCESS_KEY_ID=... CDSE_S3_SECRET_ACCESS_KEY=... .venv/Scripts/python -m pytest -q -s -k live
# optional: EW_LIVE_LAT=... EW_LIVE_LON=...  (default New Delhi)
```

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/places/search?countryCode=IN&q=Delhi&language=en` | Open-Meteo geocoding, filtered by ISO alpha-2 country. No matches returns `results: []` |
| POST | `/api/v1/cities/environment` | Body `{placeId, areaMode: "city-centre", radiusKm}`. The place is resolved server-side by ID. Returns **202** with weather and advisory while satellite processing runs, otherwise 200 |
| GET | `/api/v1/cities/environment/:requestId` | Combined data with the current satellite status |
| GET | `/api/v1/cities/environment/:requestId/advice` | AI explanation or deterministic fallback |
| GET | `/api/v1/jobs/:jobId` | `queued`, `processing`, `completed`, `failed`, `expired`, `cancelled` |
| GET | `/api/v1/heatmap/:layerId/{z}/{x}/{y}.png` | Transparent PNG tiles rendered from the COG with nearest-neighbour resampling |
| GET | `/api/v1/heatmap/:layerId/value?lat=&lng=` | Stored numeric pixel value, quality code, units and acquisition time |
| GET | `/api/v1/ai/status` | `{configured}`: whether the server has an OpenRouter key. The key itself is never returned |
| POST | `/api/v1/ai/chat` | Body `{messages: [{role: "user" \| "assistant", content}]}` (1 to 40 turns, last one from the user, 8,000 characters each). Streams Server-Sent Events: `{model, choices:[{delta:{content}}]}` chunks, or `{error:{code, message}}`, then `[DONE]`. Returns 400 for invalid input, 429 above `AI_RATE_LIMIT_PER_MINUTE` per client IP (default 10), and 503 when no key is set |

### AI assistant proxy

The app's AI assistant (`app/ai.tsx`) sends only the conversation to `/api/v1/ai/chat`. The server adds the system prompt (clients cannot send `system` turns), keeps the last 20 turns, and calls OpenRouter with the key from `OPENROUTER_API_KEY`. OpenRouter accepts at most 3 models per request, so the server tries two tiers of free models (`MODEL_TIERS` in `src/chat.ts`) and moves to the second tier only when the first is rate-limited or unavailable before any text is sent. The upstream request is cancelled when the app disconnects (the Stop button) or when the stream is silent for `OPENROUTER_STREAM_IDLE_TIMEOUT_MS`. The free OpenRouter tier allows about 50 requests a day per account.

Source statuses: `available`, `processing`, `stale`, `partial_coverage`, `unavailable`, `configuration_required`, `error`. Missing numbers are `null`, never `0`.

## Satellite processing details

- **Catalogue.** `https://stac.dataspace.copernicus.eu/v1/search`. The collections `sentinel-3-sl-2-lst-nrt` and `sentinel-3-sl-2-lst-ntc` were verified against the live `/collections` list on 2026-10-10. The search sorts by `properties.datetime` descending and follows `next` links (same host only, page and item caps). When an acquisition exists as both NRT and NTC, the NTC version is kept.
- **Windows.** The worker searches the last 72 h first, then 7 days. It processes up to `LST_MAX_PRODUCTS_PER_JOB` candidates, newest first, and stops at the first that meets minimum coverage. Otherwise it returns the best partial result, or `unavailable` with "No usable recent satellite observation."
- **Access.** Asset hrefs come from STAC (`LST_in`, `geodetic_in`, `flags_in`, as `s3://eodata/...`). Only these three NetCDF files are downloaded, through the CDSE S3 endpoint, with bucket and host allowlists and a size cap. Temporary files are deleted after each product.
- **Decoding.** Files are opened with CF decoding off. `scale_factor`/`add_offset` are applied exactly once, after fill and valid-range masking on the packed values. Values are converted from Kelvin to °C only when `units` says Kelvin.
- **Quality.** Flags are resolved by name from `confidence_in` `flag_meanings`/`flag_masks`:
  - cloud: `summary_cloud` (required; the product is rejected if it is absent)
  - water: `ocean`, `inland_water`, plus `tidal` by default
  - invalid: `unfilled`, `cosmetic`, `duplicate`, `summary_pointing`
  - any set bit in an `exception` variable, if present
  - No bit positions are hard-coded.
- **Grid.** An Azimuthal Equidistant projection centred on the city, 1 km cells. Swath pixels are placed by nearest neighbour from the product's own lat/lon arrays, with a 1.5 km maximum distance. There is no interpolation or smoothing; gaps stay transparent. Distances from the centre are exact, so the city-centre circle is geodesic and has no antimeridian seam.
- **Day and night.** A single granule is used, never a composite. If the area mixes day, night or twilight pixels, only the dominant class is kept and a note is added.
- **Coverage.**
  - `validAreaPercent` is the share of the whole circle with valid LST.
  - `validLandAreaPercent` excludes pixels flagged as water. This value is compared with `LST_MIN_VALID_AREA_PERCENT` (default 30).
  - `landQaPassPercent` is the share of observed land pixels that passed QA.
  - Below the minimum, `summary` is `null` and only an explicitly scoped `partialSummary` is returned.
- **Cache.** Layers are keyed by product ID + area + QA config + processing version + grid resolution. Tiles are cached on disk. Identical requests within the same hour share one job.
- **Not implemented.** Multi-granule compositing, urban-heat-island or anomaly metrics (no validated baseline), and the full-product OData ZIP download route.

## Source attribution and licences

- **Copernicus Sentinel-3:** "Contains modified Copernicus Sentinel data [year]". Free and open under the Copernicus data licence. CDSE quotas and terms apply.
- **Open-Meteo:** CC BY 4.0 attribution is required. The free API is for **non-commercial** use. Commercial or production use needs an Open-Meteo API subscription (`customer-api.open-meteo.com` with an API key). Check this before deploying.
- **Geocoding:** GeoNames data (CC BY 4.0) via Open-Meteo.
- **NEA WBGT (Singapore):** data.gov.sg, Singapore Open Data Licence.
- **OpenStreetMap tiles (web map only):** © OpenStreetMap contributors. The public tile servers have a usage policy and are not meant for heavy production traffic.
- **OpenRouter:** subject to the terms of OpenRouter and of the chosen model provider.
