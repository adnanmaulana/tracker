# monitoring-tools

Self-hosted, cookie-free event tracking for my personal sites (portfolio, Reanimated Cookbook, and future projects).

**Stack:** Go API · Postgres · Next.js dashboard

**Live:** https://tracker.adnanradjam.com (dashboard; `/t.js` and `/e` for sites)

```
[sites] ── t.js ──POST /e──► Go API ──(buffer + COPY)──► Postgres ◄── stats API ◄── Next.js dashboard
```

## Status
- [x] Postgres schema (monthly-partitioned `events`, `sites`, `stats_hourly`)
- [x] `POST /e` ingest: validation, enrichment, bot filter, rate limit, batched writes
- [x] `t.js` tracker (~1.9 KB gzipped)
- [x] Stats API (overview, summary, timeseries, top-N, event feed, site management)
- [x] Next.js dashboard (overview + per-site page, password login)
- [x] Deployed to the VPS (systemd + Caddy), portfolio and cookbook sending events

## Run locally (no Docker)
Requires Go 1.26+ and Node 20+. Run each command in its own terminal:

```bash
make devdb       # Postgres 17 on :5432 (embedded, data in api/.devdb)
make api-local   # API on :8080
make demo-data   # optional: ~120 days of sample traffic
cp web/.env.example web/.env.local && (cd web && npm install)
make web         # dashboard on http://localhost:3001
```

## Run locally (Docker)
Requires Docker (Postgres 16+), Go 1.26+ and Node 20+.

```bash
make up       # build tracker, start Postgres + API on :8080 (migrations run automatically)
make seed     # add dev sites: portfolio, reanimated-cookbook
make example  # tracker test page on http://localhost:3000, click around
make events   # or send sample events with curl
make psql     # then: SELECT name, path, device, props FROM events;
make test
make test-integration  # ingest -> Postgres -> stats API, using embedded Postgres
```

## Tracker
Add to any site:

```html
<script defer src="https://tracker.adnanradjam.com/t.js" data-site="portfolio"></script>
```

In Next.js (App Router), put it in `app/layout.tsx`:

```tsx
import Script from "next/script";
// inside <body>
<Script src="https://tracker.adnanradjam.com/t.js" data-site="portfolio" strategy="afterInteractive" />
```

**What it tracks automatically**
- `pageview` on load and on client-side route changes (`pushState`, `replaceState`, `popstate`). Hash-only changes are ignored.
- `outbound`, for clicks on links to other domains.

**Custom events**
```js
track("copy_snippet", { recipe: "gesture-swipe" });
```
```html
<a href="/cv.pdf" data-track="resume_download" data-track-format="pdf">CV</a>
```
To call `track()` before the script loads, add the queue stub:
```html
<script>window.track=window.track||function(){(window.track.q=window.track.q||[]).push(arguments)}</script>
```

**Script options:** `data-api` (custom ingest URL, defaults to the script's origin + `/e`), `data-auto="false"`, `data-outbound="false"`.

**Behaviour:** events are batched and sent after 1s, or when the tab is hidden or closed, using `sendBeacon` with a `fetch` keepalive fallback. Sessions live in `sessionStorage` and expire after 30 minutes idle. No cookies are set.

**Privacy:** nothing is sent when Do Not Track or Global Privacy Control is on, or in automated browsers. To exclude your own visits, run `mtIgnore()` in the browser console on each site; `mtIgnore(false)` undoes it.

## Ingest API
`POST /e` takes one event or an array of up to 50:

```json
{
  "site": "portfolio",
  "name": "project_click",
  "url": "https://yourname.dev/projects?utm_source=twitter",
  "referrer": "https://t.co/",
  "session_id": "abc12345",
  "ts": 1763380800000,
  "props": { "project": "reanimated-cookbook" }
}
```

Returns `202 {"accepted": n, "rejected": m, "errors": [...]}`, or `400` if nothing was accepted.

- **Origin check:** browser requests must come from the site's registered domain (or a subdomain).
- **Server events:** requests without an `Origin` need `Authorization: Bearer $SERVER_KEY` when `SERVER_KEY` is set.
- **Privacy:** no cookies, raw IPs are never stored. `visitor_id = sha256(daily_salt, site, ip, ua)`, so it rotates every day.
- Send the body as `text/plain` from browsers; this avoids a CORS preflight and works with `navigator.sendBeacon`.

## Tracked sites
| Site id | Domain | Repo | Custom events |
|---|---|---|---|
| `portfolio` | adnanradjam.com | `adnan-personal` | `resume_download` (`from`), `contact_click` (`channel`, `from`), `project_click` (`project`) |
| `reanimated-cookbook` | reanimated.adnanradjam.com | `reanimated-cookbook` | `copy_code` / `copy_prompt` / `copy_command` (`anim`, `version`), `demo_replay` (`anim`), `version_switch` (`anim`, `version`), `filter` (`level`), `search` (`query`, `results`) |

Each site loads the tracker through an `Analytics` component that renders only when `NEXT_PUBLIC_ANALYTICS_URL` is set at build time. In CI, that comes from the `ANALYTICS_URL` GitHub repo variable. Clicks are tracked with `data-track` attributes via a small `trackAttrs()` helper in `lib/analytics.ts`.

**Local dev:** run the API with `ALLOW_LOCALHOST=true` (`make api-local` does this) and start a site with `NEXT_PUBLIC_ANALYTICS_URL=http://localhost:8080 npm run dev`.

## Stats API
All endpoints need `Authorization: Bearer $API_TOKEN`. The exceptions are the three `stats/*` endpoints of sites marked `is_public`, which can be read without a token.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sites` | List sites |
| `POST` | `/api/sites` | Add a site: `{"id":"blog","domain":"blog.dev","name":"Blog","is_public":false}` |
| `GET` | `/api/stats/overview` | Totals, previous-period totals and a pageview sparkline for every site |
| `GET` | `/api/sites/{site}/stats/summary` | Totals plus previous period for one site |
| `GET` | `/api/sites/{site}/stats/timeseries` | Gap-filled series of `{t, events, visitors}`. `event` defaults to `pageview`; `*` means all events |
| `GET` | `/api/sites/{site}/stats/top` | Top-N for `dim`: `path` (default), `referrer`, `utm_source`, `utm_medium`, `utm_campaign`, `country`, `device`, `browser`, `os`, `event`, `prop:<key>`. `limit` ≤ 100 |
| `GET` | `/api/sites/{site}/events` | Raw events, newest first. Filter with `name`; paginate with `limit` ≤ 200 and `before=<next>`. Never public |

**Time parameters** (all stats endpoints):
- `range=today|yesterday|24h|7d|30d|90d|12mo` (default `30d`), or `from=YYYY-MM-DD&to=YYYY-MM-DD` with inclusive dates.
- `tz=Asia/Jakarta` sets where days start (default `UTC`).
- `interval=hour|day|week|month` defaults to hour for ranges up to 2 days, day up to 92 days, and month beyond that.

Every response includes `range` with the resolved `from`, `to` and `prev_from`, so the dashboard can label "vs previous period".

```bash
curl -H "Authorization: Bearer dev-token-change-me-please" \
  "localhost:8080/api/sites/reanimated-cookbook/stats/top?dim=prop:recipe&event=copy_snippet&range=7d"
```

> **Visitors** are counted as distinct daily visitor hashes. Because the hash rotates every day for privacy, one person visiting on 3 days counts as 3 visitors in a 30-day range. Plausible makes the same trade-off.

## Dashboard
A Next.js 16 app in `web/`. It uses the portfolio's typography (Space Grotesk + JetBrains Mono), motion (reveal, stagger, count-up, spring pills) and layout, with a neutral, high-contrast palette for data. It follows `prefers-color-scheme` for light and dark mode.

- **Overview:** total pageviews across all sites, plus a card per site with change vs the previous period and a sparkline.
- **Site page:** visitors, pageviews, visits and custom events; a traffic chart with a crosshair tooltip, keyboard navigation and a table view; and top pages, referrers, custom events, campaigns, countries, devices, browsers and operating systems.
- **Auth:** a single password (`DASHBOARD_PASSWORD`) creates an HMAC-signed, HttpOnly session cookie. `proxy.ts` redirects signed-out visitors, and the data layer checks the session again. The API token never reaches the browser.
- **Config:** see [`web/.env.example`](web/.env.example). `DASHBOARD_TZ` sets where days start.

## Design notes
- **Buffered writes:** events go into an in-memory channel and are flushed with Postgres `COPY` every 2s or 500 events. The buffer drains on shutdown.
- **Partitioning:** `events` is range-partitioned by month. The API creates the current and next two months on startup and daily.
- **Stats queries** run on raw `events`, using `date_trunc(interval, ts, tz)` in Postgres. Buckets with no data are filled with zeros in Go, so charts never have holes. Rollups into `stats_hourly` come later, if they become necessary.
- **Site cache:** sites are cached in memory and refreshed every minute, so ingest never hits the DB for lookups.

## Deploy
Runs on the same VPS as the sites (Ubuntu 24.04), next to them behind Caddy:

| Piece | Where |
|---|---|
| Go API | `tracker-api.service`, `127.0.0.1:8080`, binary at `/srv/tracker/api` |
| Dashboard | `tracker-web.service`, `127.0.0.1:3002`, releases in `/srv/tracker/web/releases` |
| Postgres 16 | local, database and role `tracker`; daily `pg_dump` to `/var/backups/tracker` (14 days kept) |
| Secrets | `/etc/tracker/api.env`, `/etc/tracker/web.env` (generated once by `setup.sh`) |
| GeoIP | DB-IP City Lite at `/var/lib/tracker/dbip-city-lite.mmdb`, refreshed monthly by `tracker-geoip-update` (cron) |
| Caddy | `tracker.adnanradjam.com`: `/e`, `/t.js`, `/healthz` go to the API, everything else to the dashboard |

```sh
ssh adnan@103.193.179.175 'sudo bash -s' < deploy/setup.sh   # once: Postgres, user, secrets, backups
./deploy/deploy.sh                                             # build locally (go + node), upload, restart, smoke test
```

The dashboard password is in `/etc/tracker/web.env` (`DASHBOARD_PASSWORD`). New sites: add a row to `sites` (see `api/scripts/seed-dev.sql`) or `POST /api/sites`.

## Visitors and location
Each site page shows recent visitors, with a full **Visitors** page and a per-visitor timeline grouped into visits. Visitors stay anonymous:
- no cookies and no stored IPs; the IP is used once for a daily-rotating visitor hash and a local GeoIP lookup, then dropped;
- only country, region and city are kept (set `GEOIP_DB`; without it location is blank unless an edge proxy sends a country header);
- a visitor ID resets daily, so a returning person appears as a new visitor each day;
- per-visitor endpoints (`/api/sites/{site}/visitors[/{id}]`) always need the API token, even for public sites.

## Config
See [`api/.env.example`](api/.env.example). `HOST` sets the bind address (production uses `127.0.0.1`).
