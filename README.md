# Marketplace Search

A self-hosted tool for searching, mapping, grouping and monitoring Facebook Marketplace listings.
It cross-checks every result against what you actually searched for (keyword scoring plus an optional
photo + description check by Claude), shows everything on a free OpenStreetMap map, splits results
into price groups with a dedicated **Free** page, and lets you track items and get alerted the moment
a listing meets your rules.

The UI is deliberately minimal: white, light-gray accents, no clutter.

## Try it without installing anything

- **Browser demo on GitHub Pages:** <https://zacabrewer.github.io/facebook-marketplace-search/>
  The full UI running on generated listings, entirely in your browser. Nothing is fetched from
  Facebook and there is no photo cross-check; tracked items and alerts persist in your browser's
  local storage. It deploys automatically from `main` once GitHub Pages is enabled
  (repo **Settings → Pages → Source: GitHub Actions**).
- **Full app in GitHub Codespaces:**
  [![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ZacABrewer/facebook-marketplace-search)
  One click builds the project, installs Chromium for Playwright and starts the server on a
  forwarded port. Set `SOURCE=facebook`, `FB_COOKIES` and `ANTHROPIC_API_KEY` as Codespaces
  secrets to use real listings and the Claude cross-check from there.

GitHub Pages can only host static files, so the scraper, the scheduler that runs tracked items in
the background, and the Claude cross-check need the Node server (locally, in Codespaces, or on any
small host).

## Features

- **Search with cross-checking.** Type an item; results are scored for relevance. Accessories, parts,
  "ISO / wanted" posts, rentals and look-alikes are demoted by a local keyword scorer, and (with an
  Anthropic API key) confirmed or rejected by Claude looking at the listing photo, title and description.
  Filter to "photo-verified matches only" or set a minimum match confidence.
- **Map view.** Every listing in your radius on a Leaflet + OpenStreetMap map (free, no key), with an
  optional satellite layer, colour-coded by price group, radius ring, hover sync with the list.
- **Price groups.** Free / under $25 / $25–100 / $100–500 / $500+ tabs. The Free page is the default;
  listings matched by your tracked items are highlighted and sorted first.
- **Tracked items.** Save a search with rules: max/min price, must-include / must-exclude words,
  minimum match confidence, photo-verified only. Each runs on its own schedule and alerts you on new
  matches, price drops and free listings.
- **Alerts.** In-app alert centre plus browser notifications, a generic webhook (Discord, Slack,
  Home Assistant…) and [ntfy](https://ntfy.sh) for free phone push.
- **Advanced filters and sort.** Price range, condition, exclude words, posted-within, has photo,
  favorites, hidden; sort by best match, price, distance, newest, recently seen.
- **Fast browsing.** Results are cached in SQLite and served instantly; fetches and photo checks run in
  the background and stream updates to the page over server-sent events.
- **Extras.** Favorites, hide, private notes, price history and price-drop badges, "new" badges,
  recent searches, listings that disappeared are marked "Gone".

## Quick start

**Running it on a server or NAS? Skip to [Run on a NAS with Docker](#run-on-a-nas-with-docker)** —
one `docker compose up -d --build` and you are done.

To run it directly, you need Node.js 22.13 or newer (the built-in SQLite driver is used, so there is
nothing to compile).

```bash
npm install
npm run build
npm start          # http://127.0.0.1:4310
```

Development (Vite dev server with hot reload, API proxied to the backend):

```bash
npm run dev        # web on http://localhost:5173, API on :4310
```

Out of the box the server runs with `SOURCE=demo`, which generates realistic synthetic listings around
your location so you can try every feature offline. Switch to real data as described below.

## Real Facebook Marketplace data

Facebook has no public Marketplace API. The `facebook` source drives a headless Chromium with
Playwright, opens the Marketplace search page and captures the listing objects Facebook embeds in the
page and returns from its GraphQL calls. That is much more robust than scraping CSS class names, but it
is still scraping: expect Facebook to change things occasionally, and keep request volume modest
(tracked items default to every 15 minutes).

1. Install the browser once: `npx playwright install chromium`
   (or set `CHROMIUM_PATH` to an existing Chrome/Chromium binary).
2. Start with `SOURCE=facebook npm start`.
3. Strongly recommended: export cookies from a browser where you are logged in to Facebook
   (any "cookies.txt" / "EditThisCookie" style extension works, JSON or Netscape format) and point
   `FB_COOKIES` at the file. Anonymous sessions often hit a login wall.
4. In **Settings**, set your home location and, optionally, the Facebook location slug: browse
   Marketplace for your city and copy the part after `facebook.com/marketplace/` (e.g. `boston` or a
   numeric id). With a slug, Facebook applies your radius server-side; without it, results are
   filtered by distance after fetching.

Listings from Facebook usually only carry a city name, not coordinates. The server geocodes the city
with Nominatim (free) and places those markers at the city centre, flagged "approx." in the UI.

## Photo cross-check with Claude

Set `ANTHROPIC_API_KEY` and the server sends each ambiguous listing's photo, title and description to
Claude, which returns a structured verdict (item / accessory / part / want-ad / service / different
item) with a confidence. Verified matches get a green ✓, rejected ones a red ✕, and the relevance
score is updated live. `VERIFY_MODE=all` checks every listing; `ambiguous` (default) only checks the
ones the keyword scorer is unsure about, which keeps API spend low. Any listing can be re-checked from
its detail view.

## Configuration

All configuration is through environment variables; see [`.env.example`](.env.example) for the full
annotated list, or the table in the [Docker section](#environment-variables). Home location, radius
and alert delivery are set in the app's Settings page and stored in SQLite.

## Run on a NAS with Docker

The image bundles the API, the built web UI and (optionally) Chromium for
scraping. Everything persists in one volume: `/data`.

### 1. Get the files onto the NAS

```bash
git clone https://github.com/ZacABrewer/facebook-marketplace-search.git
cd facebook-marketplace-search
cp .env.example .env      # then edit .env
```

### 2. Start it

```bash
mkdir -p data
docker compose up -d --build
```

First build takes several minutes: it compiles the app and downloads Chromium
plus its system libraries. Open `http://<nas-ip>:4310`, then set your home
location under **Settings**.

Useful commands:

```bash
docker compose logs -f          # follow logs
docker compose restart          # restart
docker compose down             # stop and remove the container
docker compose up -d --build    # rebuild after a git pull
```

### 3. Switch on real Facebook data

Demo mode needs no setup and works offline. For real listings:

1. Export cookies from a browser logged in to Facebook (any "cookies.txt" or
   "EditThisCookie" style extension; JSON or Netscape format both work).
2. Save the file next to `docker-compose.yml` as `cookies.json`.
3. Uncomment the cookies volume and `FB_COOKIES` lines in `docker-compose.yml`,
   and set `SOURCE=facebook` in `.env`.
4. `docker compose up -d`

Without cookies Facebook usually shows a login wall and returns few or no
results.

### Image variants

| Build | Command | Size | Scraping |
|---|---|---|---|
| Full | `docker compose up -d --build` | ~1.2 GB | yes |
| Demo only | `docker build --build-arg INSTALL_CHROMIUM=false -t marketplace-search:demo .` | ~250 MB | no |

The demo image has no Chromium, so it only runs `SOURCE=demo`.

### Environment variables

| Variable | Default in image | Purpose |
|---|---|---|
| `SOURCE` | `demo` | `demo` or `facebook` |
| `FB_COOKIES` | empty | Path **inside the container** to your cookies file |
| `ANTHROPIC_API_KEY` | empty | Enables the Claude photo cross-check |
| `VERIFY_MODE` | `ambiguous` | `ambiguous`, `all` or `off` |
| `AUTH_USER` / `AUTH_PASS` | empty | Set both to require HTTP basic auth |
| `DATA_DIR` | `/data` | SQLite database location |
| `HOST` / `PORT` | `0.0.0.0` / `4310` | Listen address |
| `TZ` | unset | Timezone for alert timestamps |
| `SCHEDULER_TICK_SECONDS` | `60` | How often due tracked items are checked |

Full list with comments: [`.env.example`](.env.example).

### Storage

`/data` holds `marketplace.sqlite` and your settings, tracked items and alerts.
Back up that folder and you have backed up everything.

Keep it on the NAS's **internal disk**, not an SMB or NFS share. SQLite's
locking is unreliable over network mounts and will eventually corrupt the
database.

### Security

The app has **no login by default** and the API can read your Anthropic key's
budget and your saved searches. Before exposing it beyond your own machine:

- Set `AUTH_USER` and `AUTH_PASS` in `.env` to require HTTP basic auth.
- Keep it on your LAN. If you want it remotely, reach it over a VPN
  (WireGuard/Tailscale) or put it behind a reverse proxy that terminates HTTPS.
  Basic auth over plain HTTP sends the password in reversible encoding on every
  request, so it is only meaningful behind TLS or on a trusted network.

`/api/health` stays reachable without credentials so Docker's health check
works; it returns no listing or account data.

### Synology / QNAP notes

- **Synology**: install "Container Manager", then either use its Project
  feature pointed at this folder's `docker-compose.yml`, or run the commands
  above over SSH. SSH is enabled under Control Panel → Terminal & SNMP.
- **QNAP**: Container Station supports compose files under "Applications".
- Both run Docker as root, so `./data` normally just works. If the container
  exits with a `Cannot write to DATA_DIR` error, the mounted folder is owned by
  another user. Fix it either way:

  ```bash
  sudo chown -R 1000:1000 ./data     # give it to the container's user
  ```

  or uncomment `user:` in `docker-compose.yml` and set it to your own
  `id -u`:`id -g`.
- On ARM-based models the build works the same; Chromium has an arm64 build.

### Updating

```bash
git pull
docker compose up -d --build
```

Your `/data` volume is untouched, so tracked items and alerts survive updates.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Container restarts with `Cannot write to DATA_DIR` | Volume permissions — see the chown command above |
| `http://<nas-ip>:4310` refuses to connect | Another service holds port 4310. Change the host side of `ports:` to e.g. `8410:4310` |
| Chromium crashes or pages time out | Raise `shm_size` in `docker-compose.yml`; 1 GB is the default here |
| Facebook returns nothing in `facebook` mode | Cookies missing or stale. Re-export them and restart |
| Photo cross-check shows "off" in Settings | `ANTHROPIC_API_KEY` is not reaching the container. Check `.env` and `docker compose config` |
| Alerts never fire | Tracked items run on their own interval; use "Run now" on the Tracked page to test |

## Project layout

```
server/   Fastify API, SQLite storage, sources (demo, facebook), relevance scoring, watch scheduler
web/      React + Vite frontend (Leaflet map, pages for search, map, price groups, tracked, alerts, settings)
```

Useful scripts: `npm test` (server unit tests), `npm run typecheck`, `npm run build`.

Static demo build (what the Pages workflow produces):

```bash
VITE_STATIC_DEMO=true BASE_PATH=/facebook-marketplace-search/ npm run build --workspace=web
```

The web app talks to `/api/*`; with `VITE_STATIC_DEMO=true` those calls are answered in the
browser by `web/src/demo/mockApi.ts`, which reuses the server's demo generator, keyword scorer and
filtering code.

## API overview

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/search` | Start (or join) a fetch for a query; results stream via SSE |
| GET | `/api/listings` | Query cached listings with filters and sort |
| GET | `/api/listings/groups` | Counts per price group |
| GET/PATCH | `/api/listings/:id` | Details with price history; favorite / hide / note |
| POST | `/api/listings/:id/verify` | Force a Claude cross-check |
| CRUD | `/api/watches` | Tracked items; `POST /api/watches/:id/run` runs one now |
| GET | `/api/notifications` | Alerts; `POST /api/notifications/read` |
| GET | `/api/events` | Server-sent events: job progress, listings, relevance, notifications |
| GET | `/api/geocode?q=` | Nominatim geocoding (cached) |

## Notes and limits

- This tool is for personal use. Scraping may be against Facebook's terms; use your own account
  and reasonable polling intervals.
- Facebook sometimes returns fewer results to anonymous sessions or shows a login dialog. Cookies fix
  most of that.
- The demo source simulates a periodic price drop on one listing so you can see price-drop alerts.
