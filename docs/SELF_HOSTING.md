# Self-hosting LanternEd

LanternEd is centrally hosted by default (see [README.md § 8 Deployment](../README.md)) so most
institutions get the platform with zero infrastructure to run. This guide is for the smaller
number of institutions that have the means and want to run their own instance instead — keeping
their own students' videos, materials, and submissions on their own infrastructure, under their
own control.

This is **the same codebase**, not a fork or a reduced edition. The central LanternEd team's role
toward a self-hosted instance is limited to maintaining the source and shipping updates — we do
not have access to a self-hosted instance's database or files.

## Who this is for

You need someone comfortable with: a Linux server (a small VPS is enough — 2 vCPU / 4GB RAM
handles one institution comfortably), Docker, and pointing a domain's DNS at a server. If that's
not available in-house, the centrally-hosted version is almost certainly the better fit — that's
exactly the "zero IT burden" case it's built for.

## What you get

- Your own Postgres database, your own file storage (local disk by default), your own instance
  of the full application — nothing routes through LanternEd's central servers.
- The exact same features as the hosted version: live classes, offline-first assignments, AI
  lecture summaries, multi-section course management, your own `/admin` platform-admin account.
- Automatic HTTPS (via Caddy + Let's Encrypt) for one domain you point at this server.

## What's still external by default: LiveKit

Live classes run on [LiveKit](https://livekit.io), which needs a real-time media server. LiveKit
is itself open-source and self-hostable, but its server needs a public IP and an open UDP port
range (default `50000–60000`) for WebRTC — easy to get right on a cloud VPS, easy to get wrong
behind a campus router/firewall/NAT, and a live class is the one feature where getting this wrong
is immediately visible to every student in the room.

**Recommended default:** point `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` at
[LiveKit Cloud's free tier](https://cloud.livekit.io) even in an otherwise fully self-hosted
deployment. Everything else — your students' and teachers' accounts, course data, submissions,
recordings, and AI summaries — still lives entirely on your own server; only the live
audio/video packets for active classes transit LiveKit Cloud, and LiveKit does not retain them.

If you want to self-host LiveKit's media server too, see
[LiveKit's own self-hosting guide](https://docs.livekit.io/home/self-hosting/deployment/) and
swap the three `LIVEKIT_*` values in `.env` for your own server — nothing in this app's code
needs to change, since it only ever talks to whatever `LIVEKIT_URL` points to.

## Setup

1. **Provision a server** with Docker and Docker Compose installed, and a domain's DNS A record
   pointing at its public IP (e.g. `lanterned.yourcollege.edu`).

2. **Clone the repo** on that server:
   ```bash
   git clone https://github.com/yynvr1408/LanternEd.git
   cd LanternEd/deploy/self-hosted
   ```

3. **Configure:**
   ```bash
   cp .env.example .env
   ```
   Fill in every value in `.env` — at minimum `DOMAIN`, `POSTGRES_PASSWORD`, `SESSION_SECRET`,
   and a `LIVEKIT_*` triple from LiveKit Cloud's free tier (classes won't work without it, but
   everything else will). See the comments in `.env.example` for what each one does.

4. **Start it:**
   ```bash
   docker compose up -d --build
   ```
   This builds the backend and frontend images, runs database migrations automatically (same
   `alembic upgrade head` the hosted deployment runs on every start — safe to re-run), and brings
   up Postgres, the API, the background worker, and Caddy. The first start takes a few minutes
   while images build and Caddy requests its certificate; `docker compose logs -f caddy` shows
   certificate issuance progress.

5. **Visit `https://<your domain>`.** Sign up a teacher account (or set `ADMIN_USERNAME` /
   `ADMIN_PASSWORD` in `.env` before first start, then sign in at `/admin`, to create the
   college and issue teacher/student registration codes from there).

## Updating

```bash
git pull
docker compose up -d --build
```
Migrations run automatically on start and are safe to re-run (`alembic upgrade head` is a no-op
if there's nothing new to apply).

## Backups

Everything that matters lives in two Docker volumes on the host: `pgdata` (the database) and
`media` (uploaded/recorded files, when using the default local storage backend). Back up both —
e.g. `docker run --rm -v self-hosted_pgdata:/data -v $(pwd):/backup alpine tar czf /backup/pgdata-$(date +%F).tar.gz -C /data .`
(adjust the volume name prefix to whatever `docker volume ls` shows on your host) — on whatever
schedule matters to you; this app does not manage backups for you.

## Switching to S3-compatible storage (optional)

The default (`STORAGE_BACKEND=local`) writes to the `media` volume and needs no extra setup. If
you'd rather use a bucket (e.g. a self-hosted [MinIO](https://min.io), or a cloud S3-compatible
service), set `STORAGE_BACKEND=s3` plus `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`,
`OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY` on both the `api` and `worker` services
in `docker-compose.yml` — the backend already supports both transparently (see
`backend/app/integrations/object_storage.py`), no code changes needed either way.
