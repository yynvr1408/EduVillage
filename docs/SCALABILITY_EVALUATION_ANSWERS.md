# Scalability: evaluation answers

Short, defensible answers for reviews and demonstrations. Pricing checked 2026-10-16; all cost and capacity figures are **estimates from assumed workloads, not measurements** (see [INFRASTRUCTURE_COST_MODEL.md](INFRASTRUCTURE_COST_MODEL.md)). Detail: [architecture](SCALABILITY_ARCHITECTURE.md) · [roadmap](DEPLOYMENT_UPGRADE_ROADMAP.md) · [capacity test plan](CAPACITY_TEST_PLAN.md) · [README](../README.md).

## How does EduVillage scale?

Component by component, each upgradeable on its own. The frontend is static files on **Vercel** (a CDN; registered users add bandwidth, not compute). The **FastAPI** backend is a modular monolith on Render that can first be given more CPU/memory and later more instances; sessions, background jobs and sync idempotency already live in PostgreSQL, so adding instances is possible. **Neon** PostgreSQL scales compute and storage by plan. **LiveKit Cloud** carries live media, so the API never proxies video. **Cloudflare R2** holds recordings and uploads with presigned URLs and free egress. Two things must be fixed before multiple instances are *accurate*: login/OTP rate limits are per-process memory, and migrations run on every container start. Nothing has been load-tested yet.

## How many users can it support?

**It has not been measured.** Practical production capacity has not yet been established through representative load testing. As planning estimates only: the current free-tier stack is sized for roughly 100 registered users (a demonstration), one paid Render Standard instance plus paid LiveKit/Neon is planned for roughly 1,000, and about 10,000-100,000 registered users would need several instances and a larger database. The estimate assumes an unmeasured 40 requests/second per Standard instance and that only 40-60% of registered users are active in a month. These are not guarantees.

## What is the cost for 1,000 users?

Estimate (balanced hybrid usage): about **$174/month (about INR 16,700; about $2,083/year)**: Vercel Pro $20, Render Standard $25, Neon Launch about $39, LiveKit Ship about $86, R2 about $2, AI about $2, email $0. Range: **$134** if teaching is mostly recorded, **$582** if classes are live-heavy. The dominant, most variable cost is LiveKit participant-minutes. Prices verified 2026-10-16; INR at 96.5 per USD (third-party quote, timestamp unverified).

## What is the cost for 10,000 users?

Estimate (balanced hybrid): about **$1,020/month (about INR 98,400; about $12,239/year)**, with a range of **$337 to $4,129** depending on how much teaching is live. LiveKit is about 73% of the balanced total; two Render Standard instances and Neon at about 2 CU make up most of the rest. All figures are estimates.

## What happens when concurrent classes increase?

LiveKit connection limits and participant-minutes are the constraints: Build allows 100 concurrent connections, Ship 1,000, Scale 5,000; above that an Enterprise agreement is required. Cost rises roughly linearly with participant-minutes, and recording adds egress minutes (video room-composite recording, 60 minutes free per month). The backend only issues tokens, so API load grows with joins, not with media. Adaptive audio-only mode in the client lowers bandwidth per participant. The design carries **one room per class**; a branch-wide class is a single class, not a copy per section.

## What happens when database usage increases?

Neon Free stops at 1 GB (writes blocked) or 100 CU-hours (compute suspended), so a paid plan is needed at pilot scale. Relational data is small (the development database is 9.6 MB for 32 tables; the model estimates about 1 GB or less for 10,000 registered users); media is **not** stored in PostgreSQL. Connections are the real risk: the app uses SQLAlchemy's default pool, so a pooled Neon endpoint and `pool_pre_ping` are recommended before adding instances. A read replica is justified only if measurements show read-bound load.

## How are AI costs controlled?

AI is optional and never in the path of login, enrolment or class delivery. Summaries are generated **once per recorded class** and stored, so student views do not call the model. Estimated cost is about $0.04-0.05 per class-hour at Groq's current prices ($0.04/audio hour Whisper turbo; $0.15 / $0.60 per million tokens for `openai/gpt-oss-120b`). Not yet implemented but recommended: per-teacher daily limits, a fallback provider, and usage alerts.

## How is infrastructure cost minimised?

Static hosting for the frontend, free-tier-first for every service, direct-to-R2 recordings with free egress, offline-first behaviour that moves work off the network, one summary per class, and upgrades only when a measured trigger fires ([roadmap](DEPLOYMENT_UPGRADE_ROADMAP.md)). The largest further savings are recorded-first teaching, audio-only recording (not implemented), retention policies and a lower heartbeat frequency.

## Why use LiveKit Cloud?

A managed WebRTC SFU removes the hardest operational part (TURN/STUN, media servers, regional routing, scaling, Egress recording) for a small team, and its tokens and webhooks fit the backend's authorisation model. Cost scales with participant-minutes with a free tier for development. The code isolates it in `backend/app/integrations/livekit.py`, and LiveKit itself is open source, so self-hosting remains an option if usage justifies the operational burden. A real LiveKit Cloud suite (`frontend/e2e-live`) verifies signalling-level presence for several students; it does not verify audio or video content.

## Why use Vercel?

The frontend is a static React/Vite single-page app: a CDN is the simplest, cheapest and fastest way to serve it, and registered-user growth does not create server cost. Deploys are by Git push; the single SPA rewrite in `frontend/vercel.json` makes direct links (for example `/admin`) work. Caveats: the free Hobby plan is non-commercial, so a college pilot should use Pro ($20/month); the API's single CORS origin means preview deployments need extra configuration.

## Why not use Kubernetes immediately?

Measured load does not need it: the system is one stateless-ish API plus managed services (database, media, storage, email, AI) that already scale independently, and the first four stages are covered by larger instances and a second instance. Kubernetes adds cost and operational burden for a small team without removing any current bottleneck. Revisit only after load tests show instance-count or deployment-complexity limits that Render cannot meet.

## How does EduVillage support weak internet connections?

**Implemented in the frontend and tested** (not field-tested): audio-only fallback in live classes when connection quality degrades; assignment drafts saved on the device (IndexedDB) and synchronised later through an idempotent queue (retrying cannot create a second submission); explicit downloads of recordings and resources for offline viewing; a PWA service worker; connectivity detection with clear banners. Limits: a connectivity heartbeat adds request volume, browsers cap storage, and real-network field testing has not been done.

## How is vendor lock-in reduced?

Provider access is behind small seams: LiveKit in `integrations/livekit.py`; storage as an S3-compatible interface (R2, S3 or MinIO); AI through the OpenAI-compatible API (any compatible provider by changing `LLM_BASE_URL`); email in one `_send` function; PostgreSQL through SQLAlchemy and Alembic (any PostgreSQL host); the backend ships as a Dockerfile (any container host). The frontend is portable static files. Remaining lock-in is mostly commercial (LiveKit's participant-minute pricing) rather than technical.
