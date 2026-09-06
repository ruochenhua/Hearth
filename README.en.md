# Hearth (围炉) · Family Photo Album

A private, self-hosted family photo album that runs on a computer in your home. Originals stay on your local disk; the family browses photos, plays videos, edits tags and locations, favorites and comments from any browser on any device — no cloud service involved, your media never leaves your house.

**[中文 README](README.md)**

## Why Hearth

Chinese families gather around the hearth (围炉, *wéilú*) to share stories. Hearth brings that feeling to your photos: every family member walks in through the same door, everything is kept at home, and nothing is sent to a third party.

## Features

- **Quick Share** — family phones on the same Wi-Fi upload photos and videos in batches through a mobile-friendly page; scan a QR code from the desktop to jump straight in. Works on Android and iPhone, no cable required.
- **USB Cable Wizard** — connect an Android phone over USB directly from the browser (WebUSB/ADB): pick a directory, scan, stream files with incremental SHA-256 dedupe, live speed and ETA. No adb installation, no command line.
- **Android ADB import (CLI)** — incremental recursive scan of `/sdcard` or any set of directories, with watch mode for continuous import.
- **Web upload** — multi-select, drag & drop, folder picker, per-file progress, failure retry; 2 GB per file.
- **Auto organization** — EXIF/video capture time (falls back to file mtime), archived by month, SHA-256 content dedupe.
- **Tags & places** — reads IPTC/XMP keywords and GPS; an offline reverse-geocoding dataset (2,875 county-level boundaries for China, ~16 MB, bundled) turns GPS coordinates into "Province · City · District" without any network call; places browser groups hierarchically (province → city → district).
- **Video** — FFmpeg transcodes to H.264/AAC MP4 previews; original files downloadable.
- **Family interaction** — one shared password, favorites, per-person display names, comments.
- **Built to keep running** — Docker Compose with health checks and auto-restart, SQLite migrations, job resume after restart, full offline backup and restore scripts.

## Quick Start (Docker, recommended)

Requires Docker Desktop (Linux containers). Node.js 24.13+ (24.x) for the setup script; or copy `.env.example` to `.env` and set a dedicated password of at least 12 characters.

```powershell
node scripts/maintenance/setup.mjs
docker compose up -d --build
```

- Desktop: `http://localhost:3080`
- Phones on the same Wi-Fi: `http://<your-LAN-IP>:3080`

Double-click `Start-Hearth.cmd` (Windows), `Start-Hearth.command` (macOS), or run `Start-Hearth.sh` (Linux) to start everything through a local browser control center; matching `Stop-Hearth` scripts stop it. On Windows, a firewall rule limited to the local subnet on TCP 3080 is created automatically (one-time admin elevation). No public port forwarding is ever configured.

Compose mounts `./data` (database, originals, thumbnails, previews, upload staging) and a read-only `./inbox` import directory, so nothing is lost when the container is recreated. `.env` holds your private password; `.local-access.txt` stores the initial password locally.

```text
Hearth/
  data/album.sqlite        # index, tags, comments, settings, sessions
  data/originals/YYYY/MM/  # originals, content-hashed filenames
  data/thumbnails/         # list thumbnails
  data/previews/           # JPEG and MP4 previews
  inbox/                   # drop-in import directory
  backups/                 # full backups, private config included
  .env                     # private config and password
```

Health: `docker compose ps` · Logs: `docker compose logs -f --tail 100 album` · Stop: `docker compose stop`

If Docker Hub is unreachable, set `NODE_IMAGE=public.ecr.aws/docker/library/node:24-bookworm-slim` in `.env` (official Docker images on Amazon ECR Public).

## Importing photos and videos

**Quick Share (recommended).** Family phones join the home Wi-Fi, open the album in a mobile browser and sign in, then use the "Quick Share" page to batch-select and upload. A desktop-opened Quick Share page shows QR codes that jump a phone straight into it; after the first sign-in the session lasts 7 days. Add the page to the phone home screen for one-tap access.

**Mobile browser.** Sign in on the phone and upload from the Import Center. Web pages cannot read arbitrary phone folders without authorization.

**USB cable wizard (Android).** From desktop Chrome or Edge at `http://localhost:3080`, open the Android import wizard in the sidebar: enable USB debugging on the phone (on OPPO/ColorOS: tap "Build number" repeatedly under Settings → About phone, then enable USB debugging under developer options), connect the cable, allow the debugging prompt, pick a scan range, confirm the file count, and start importing. Verified on an OPPO Find X7 Ultra. Requires desktop Chrome/Edge and a `localhost` origin (browser USB APIs); if the port is busy, unplug and replug the cable.

**ADB command line.** Install the [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools), then:

```powershell
npm run android                                            # scan all media under /sdcard
npm run android -- --source /sdcard/DCIM                   # one directory
npm run android -- --watch 60                              # re-check every minute
npm run android -- --serial DEVICE_SERIAL --source /sdcard/DCIM
```

The CLI script uses only the Node standard library, preserves file mtimes, writes `.part` files before renaming, and never deletes originals on the phone.

## Media notes

- Photos: JPEG, PNG, WebP, GIF, TIFF, AVIF, HEIC/HEIF (preview depends on local Sharp/FFmpeg codecs; originals always preserved).
- Videos: MP4, MOV, M4V, WebM, MKV, 3GP, AVI — transcoded to H.264/AAC MP4 up to 1920 px wide.
- Upload limit 2 GB per file (larger videos via ADB/inbox).
- Originals are stored by content hash and never modified; original filenames are kept for download.
- Capture time comes from EXIF/video metadata, falling back to file mtime; timezone-less EXIF times are interpreted in the server timezone (`TZ`, default `Asia/Shanghai`).
- GPS and tags depend on the camera settings and whether sharing apps stripped metadata; enable location tagging in the phone camera.
- There is no delete-originals API in this version.

## Offline geocoding data

`server/src/geo/counties.json` is generated by `scripts/maintenance/build-geo-data.mjs` from the public [DataV](https://geo.datav.aliyun.com/) boundary dataset (Alibaba Cloud, GCJ-02 coordinates) and shipped with the repo. EXIF GPS (WGS-84) is converted before lookup; lookups run entirely locally. Re-run the generator to refresh boundaries. Backfill existing photos with:

```powershell
docker compose exec album node server/cli/backfill-location.mjs
```

It only fills empty locations and never overwrites manually entered ones.

## Update, backup, restore

```powershell
npm run backup          # full backup: data dir + .env, integrity-checked, service paused and resumed
docker compose up -d --build   # update after backup; keep .env, data, inbox
```

Migrations follow SQLite `user_version`; a v1→v2 migration snapshots the database first. Rotating the password needs `docker compose up -d --force-recreate` (a plain `restart` won't refresh env). Backups land in `backups/<timestamp>` with a `COMPLETE` marker. To restore: stop the app, copy the backup's `data` into a fresh directory, restore `.env`, and `docker compose up -d` with the same or a newer app version.

## Development (without Docker)

Node 24.x with FFmpeg/FFprobe on PATH:

```powershell
node scripts/maintenance/setup.mjs
npm ci
npm --prefix web ci
npm run build
npm start
```

Frontend dev server: `npm --prefix web run dev` → `http://localhost:5173` (proxies `/api` to 3080).

```powershell
npm test
npm run build
docker compose config --quiet
```

Tests use an isolated `test-output` directory with generated media fixtures; they never touch your real album. Coverage includes auth/CSRF, EXIF, original integrity, dedupe, batch hash-check, tags/comments, folder scan, video transcode/range requests, job retry, restart recovery, password rotation, offline reverse geocoding, and network address discovery. The Windows launcher test skips automatically when PowerShell 7 (`pwsh`) is unavailable. The USB cable wizard is verified on a real OPPO Find X7 Ultra; browser visual/interaction automation is not covered yet.

## Architecture

React + TypeScript + Shadcn/Base UI on the front; Express + Node's built-in SQLite on the back. Sharp/exifr handle photos and metadata; FFmpeg/ffprobe handle video; the cable wizard uses @yume-chan/adb (WebUSB) with @noble/hashes for incremental SHA-256; QR codes use `qrcode`.

```text
Phones (Quick Share / USB cable wizard / ADB / folder sync)
  → uploads staging / inbox
  → persistent SQLite job queue
  → private snapshot → SHA-256 dedupe → metadata + offline geocoding → originals + previews
  → session-protected HTTP API → family album web app
```

Sessions are HttpOnly + SameSite=Strict cookies; login is rate-limited; writes require a same-origin check plus a custom header. Media URLs require authentication. Pending jobs are replayed after a crash; re-imports are idempotent. The default deployment is plain HTTP on the LAN — put it behind HTTPS with proper access control before exposing it to the internet, and never forward a public router port by default.

References: [ADB](https://developer.android.com/tools/adb), [Node SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html), [Express security best practices](https://expressjs.com/en/advanced/best-practice-security/).
