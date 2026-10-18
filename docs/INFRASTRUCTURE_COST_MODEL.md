# LanternEd infrastructure cost model

Prices checked: **2026-10-16**, from the official provider pages listed in [Sources](#sources). Workload figures are **assumptions made for planning, not measurements**: LanternEd has no production analytics yet, so nothing below is measured capacity. The numbers are reproducible with [`cost_model.py`](cost_model.py) (`python docs/cost_model.py`), which is the single source for every figure in this file, in the [README](../README.md) and in the other planning documents ([architecture](SCALABILITY_ARCHITECTURE.md), [roadmap](DEPLOYMENT_UPGRADE_ROADMAP.md), [evaluation answers](SCALABILITY_EVALUATION_ANSWERS.md), [capacity test plan](CAPACITY_TEST_PLAN.md)).

Contents: [1. Verified pricing](#1-verified-pricing) · [2. What is actually used](#2-what-is-actually-used) · [3. Method](#3-method-and-assumptions) · [4. Results](#4-results) · [5. What drives cost](#5-what-drives-cost) · [6. Caveats](#6-caveats-and-unknowns) · [Sources](#sources)

## 1. Verified pricing

| Service | Free / entry | Paid plan(s) and overage | Hard limits worth knowing |
|---|---|---|---|
| **Vercel** (frontend) | Hobby $0: 100 GB Fast Data Transfer, 1M CDN requests, 1M function invocations, 4 h Fluid Active CPU. "Hobby plan is for personal, non-commercial use." Usage over the caps cannot be purchased. | Pro $20/month: 1 TB transfer, 10M requests, $20 usage credit; then from $0.15/GB and $2 per 1M requests; no cap. | Hobby is non-commercial; a college pilot should be on Pro. |
| **Render** (backend, Docker) | Free web service: 750 instance-hours/workspace/month, spins down after 15 min idle (~1 min cold start), ephemeral filesystem, single instance, no SSH, outbound SMTP ports blocked, may restart any time. | Starter $7 (512 MB, <1 CPU) · Standard $25 (1 CPU, 2 GB) · Pro $85 (2 CPU, 4 GB). A workspace plan ("Pro", $25/month + compute) exists; whether a paid instance requires it is UNKNOWN (see §6). | Free: bandwidth/build overages suspend free services unless a card is on file. |
| **Neon** (PostgreSQL) | Free $0: 1 GB/project (20 GB across projects), 100 CU-hours/project, up to 2 CU, 6 h point-in-time restore, always suspends after 5 min idle. Exceeding storage blocks writes; exhausting CU-hours suspends compute until next period. | Launch: pay-as-you-go, $0.106/CU-hour, $0.35/GB-month, up to 16 CU, 7-day restore. Scale: $0.222/CU-hour, $0.35/GB-month, 30-day restore, fixed sizes to 56 CU. Egress $0.10/GB after 500 GB/project. | Connection-pooler numeric limits are not published on the pricing page: UNKNOWN. |
| **LiveKit Cloud** (live classes) | Build $0: 5,000 WebRTC participant-min, 100 concurrent connections, 50 GB downstream, 60 egress (recording) min, 2 concurrent exports. | Ship from $50/month: 150,000 min, 1,000 concurrent, 250 GB; overage $0.0005/min, $0.12/GB, egress $0.02/min video ($0.005 audio-only). Scale from $500/month: 1.5M min, 5,000 concurrent, 3 TB; overage $0.0004/min, $0.10/GB, $0.015/min video egress. Enterprise above that: price UNKNOWN. | The free plan's overage rates are not listed; assume a hard stop. Room-composite **video** recording counts as egress transcode minutes. |
| **EmailJS** (OTP email) | Free $0: 200 requests/month, 2 templates. | Personal $9: 2,000 · Professional $15: 5,000 · Business $40: 25,000 (the page also shows larger figures for Professional/Business; the lower, clearly attributable value is used). | REST API limit: **1 request/second**. Whether the free plan allows server-side (non-browser) calls is not stated on the pages read: UNKNOWN, confirm in the account. |
| **Groq** (AI: summaries and speech-to-text) | A free tier exists; its exact per-model limits could not be confirmed (the rate-limit page shows "base" limits of 30 RPM / 1K RPD / 8K TPM / 200K TPD for `openai/gpt-oss-120b` and 20 RPM / 2K RPD / 7.2K audio-seconds per hour / 28.8K per day for `whisper-large-v3-turbo`; which plan they belong to is ambiguous). | `openai/gpt-oss-120b`: $0.15 / $0.60 per 1M input / output tokens. `whisper-large-v3-turbo`: $0.04 per audio hour, 10 s minimum per request. Developer-plan limits: 1K RPM / 250K TPM (LLM), 400 RPM / 400K audio-s per hour (Whisper). | Third-party aggregators were used to cross-check the per-token prices; confirm in the Groq console. |
| **Cloudflare R2** (recordings, uploads) | Free: 10 GB-month, 1M Class A, 10M Class B operations per month. | Standard $0.015/GB-month; Class A $4.50/1M; Class B $0.36/1M; **egress free**. Infrequent Access $0.01/GB-month (30-day minimum). | — |
| **GitHub** | Source control (repository `yynvr1408/LanternEd`). No GitHub Actions workflows exist in the repository. | — | — |

## 2. What is actually used

Evidence is from the repository and from a read-only inspection of the configured services; nothing was changed. See [SCALABILITY_ARCHITECTURE.md](SCALABILITY_ARCHITECTURE.md) for the full inventory.

| Service | Evidence | Class |
|---|---|---|
| Vercel | `frontend/vercel.json` (SPA rewrite). The Vercel account/plan was not accessible to this audit. | I - deployed (per project owner), plan UNKNOWN |
| Render | `render.yaml` (Docker web service, `plan: free`); the Render build/deploy logs supplied by the project owner show the Docker build and `alembic upgrade head` starting on Render. | I - deployed, **plan assumed free per `render.yaml`**, not verified |
| Neon | `DATABASE_URL` host is `*.neon.tech` (host only inspected); PostgreSQL 18.6; the development database is **9.6 MB** with 33 tables. The plan was not verifiable from the connection (assumed Free). | B - free tier available, usage unknown (9.6 MB of 1 GB) |
| LiveKit Cloud | `LIVEKIT_URL` domain is `livekit.cloud` (value not recorded here); a real-room test suite exists (`frontend/e2e-live`). | B - free (Build) tier available, plan UNKNOWN |
| EmailJS | Backend integration `backend/app/integrations/email.py`; **not configured in the local environment**; not proven in production by this audit. | I - deployed but not verified |
| Groq | `render.yaml` sets `LLM_BASE_URL=https://api.groq.com/openai/v1`, model `openai/gpt-oss-120b`, STT `whisper-large-v3-turbo`. The **local** environment instead points the LLM at `127.0.0.1` (model name `freellmapi`), a local proxy that cannot exist on Render; and the local STT key has no base URL, so it would call OpenAI's endpoint with `whisper-1`. | B for Groq; the FreeLLMAPI proxy is local-only (H - implemented, not deployed) |
| Cloudflare R2 | `STORAGE_BACKEND=s3`, endpoint domain `r2.cloudflarestorage.com`, bucket set. | B - free tier available, usage unknown |

## 3. Method and assumptions

Registered users are **not** monthly active users. For each scenario: MAU = registered × MAU share; peak concurrent app users = MAU × peak-app share; live participant-minutes = MAU × minutes per MAU. Total monthly cost = Vercel + backend + background worker + Neon + LiveKit + R2 + email + AI (taxes, support, and paid monitoring excluded; allowances are subtracted once).

| Assumption | P1 recorded-first | P2 hybrid | P3 live-heavy | Notes |
|---|---:|---:|---:|---|
| MAU share of registered | 40% | 50% | 60% | ASSUMED |
| Online hours per MAU per month | 6 | 12 | 20 | ASSUMED |
| Peak concurrent app users (share of MAU) | 10% | 10% | 15% | ASSUMED |
| Peak concurrent live participants (share of MAU) | 3% | 6% | 12% | ASSUMED |
| Live participant-minutes per MAU per month | 30 | 150 | 600 | ASSUMED (0.5 / 2.5 / 10 h) |
| Average downstream per participant-minute | 0.8 MB | 2.0 MB | 3.0 MB | ASSUMED mix of audio-only and video |
| Average class size | 31 | 31 | 31 | 30 students + 1 teacher |
| Emails per MAU per month | 0.3 | 0.4 | 0.5 | OTP resets and second-device approvals |
| Relational data per registered user | 80 KB | 80 KB | 120 KB | after ~12 months, ASSUMED |

Fixed assumptions: every class is recorded (room-composite MP4, ~8 MB per minute, retained 6 months); ~5 MB of course material per MAU; AI = one transcription + one summary per recorded class-hour, +10% retries (12,000 input tokens and 800 output tokens per class-hour); summaries are stored, so students do not trigger extra AI calls; API load = **240 `/health` heartbeats per online hour** (the frontend pings every 15 s: `frontend/src/context/NetworkContext.tsx`) plus an assumed 80 other calls per online hour; one Render Standard instance is planned for **40 requests/s (an unmeasured planning figure)**; Neon compute sized at 0.25 / 0.5 / 1 / 2 / 4 / 8 CU always-on for 500 / 1,000 / 5,000 / 10,000 / 50,000 / 100,000 registered users (Scale rates from 50,000); Vercel Pro from 500 registered users (a commercial deployment cannot use Hobby); a $7 background worker from 5,000 users (UNVERIFIED assumption that a worker costs the same as a web instance of that size). Currency: **1 USD = 96.5 INR**, a third-party quote seen on 2026-10-16 whose timestamp could not be verified; USD is authoritative.

## 4. Results

`+` marks a total that is a **lower bound**: at 100,000 registered users with P3 the modelled peak of 7,200 live participants exceeds LiveKit Scale's published 5,000 concurrent connections, so an Enterprise agreement (price UNKNOWN) is required.

**Balanced hybrid (P2) is the planning case.** P1 and P3 are the low and high bounds.

#### P1 recorded-first

| Registered | MAU | Peak app users | Peak live participants | Live participant-min / mo | API requests / mo | DB (GB) | Media stock (GB) | Emails / mo | AI hours / mo | Monthly USD | Monthly INR | Annual USD | Backend | LiveKit plan |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 100 | 40 | 4 | 1 | 1.2k | 76.8k | 0.01 | 2 | 12 | 1 | $0 | INR 3 | $0 | Render Free | Build (free) |
| 500 | 200 | 20 | 6 | 6.0k | 384.0k | 0.04 | 10 | 60 | 4 | $115 | INR 11,050 | $1,374 | Render Standard x1 | Ship |
| 1,000 | 400 | 40 | 12 | 12.0k | 768.0k | 0.08 | 20 | 120 | 7 | $134 | INR 12,947 | $1,610 | Render Standard x1 | Ship |
| 5,000 | 2.0k | 200 | 60 | 60.0k | 3.8M | 0.38 | 100 | 600 | 35 | $218 | INR 21,045 | $2,617 | Render Standard x1 | Ship |
| 10,000 | 4.0k | 400 | 120 | 120.0k | 7.7M | 0.76 | 201 | 1.2k | 71 | $337 | INR 32,551 | $4,048 | Render Standard x1 | Ship |
| 50,000 | 20.0k | 2.0k | 600 | 600.0k | 38.4M | 3.81 | 1005 | 6.0k | 355 | $1,542 | INR 148,786 | $18,502 | Render Standard x5 | Scale |
| 100,000 | 40.0k | 4.0k | 1.2k | 1.2M | 76.8M | 7.63 | 2010 | 12.0k | 710 | $2,612 | INR 252,039 | $31,342 | Render Standard x9 | Scale |

#### P2 hybrid

| Registered | MAU | Peak app users | Peak live participants | Live participant-min / mo | API requests / mo | DB (GB) | Media stock (GB) | Emails / mo | AI hours / mo | Monthly USD | Monthly INR | Annual USD | Backend | LiveKit plan |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 100 | 50 | 5 | 3 | 7.5k | 192.0k | 0.01 | 12 | 20 | 4 | $50 | INR 4,845 | $603 | Render Free | Ship |
| 500 | 250 | 25 | 15 | 37.5k | 960.0k | 0.04 | 58 | 100 | 22 | $128 | INR 12,372 | $1,539 | Render Standard x1 | Ship |
| 1,000 | 500 | 50 | 30 | 75.0k | 1.9M | 0.08 | 116 | 200 | 44 | $174 | INR 16,749 | $2,083 | Render Standard x1 | Ship |
| 5,000 | 2.5k | 250 | 150 | 375.0k | 9.6M | 0.38 | 579 | 1.0k | 222 | $607 | INR 58,552 | $7,281 | Render Standard x1 | Ship |
| 10,000 | 5.0k | 500 | 300 | 750.0k | 19.2M | 0.76 | 1158 | 2.0k | 444 | $1,020 | INR 98,421 | $12,239 | Render Standard x2 | Scale |
| 50,000 | 25.0k | 2.5k | 1.5k | 3.8M | 96.0M | 3.81 | 5792 | 10.0k | 2218 | $4,567 | INR 440,698 | $54,802 | Render Standard x6 | Scale |
| 100,000 | 50.0k | 5.0k | 3.0k | 7.5M | 192.0M | 7.63 | 11585 | 20.0k | 4435 | $9,594 | INR 925,819 | $115,128 | Render Standard x12 | Scale |

#### P3 live-heavy

| Registered | MAU | Peak app users | Peak live participants | Live participant-min / mo | API requests / mo | DB (GB) | Media stock (GB) | Emails / mo | AI hours / mo | Monthly USD | Monthly INR | Annual USD | Backend | LiveKit plan |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 100 | 60 | 9 | 7 | 36.0k | 384.0k | 0.01 | 55 | 30 | 21 | $63 | INR 6,060 | $754 | Render Free | Ship |
| 500 | 300 | 45 | 36 | 180.0k | 1.9M | 0.06 | 274 | 150 | 106 | $275 | INR 26,560 | $3,303 | Render Standard x1 | Ship |
| 1,000 | 600 | 90 | 72 | 360.0k | 3.8M | 0.11 | 547 | 300 | 213 | $582 | INR 56,126 | $6,979 | Render Standard x1 | Ship |
| 5,000 | 3.0k | 450 | 360 | 1.8M | 19.2M | 0.57 | 2736 | 1.5k | 1065 | $1,816 | INR 175,205 | $21,787 | Render Standard x1 | Scale |
| 10,000 | 6.0k | 900 | 720 | 3.6M | 38.4M | 1.14 | 5473 | 3.0k | 2129 | $4,129 | INR 398,404 | $49,543 | Render Standard x2 | Scale |
| 50,000 | 30.0k | 4.5k | 3.6k | 18.0M | 192.0M | 5.72 | 27364 | 15.0k | 10645 | $22,484 | INR 2,169,662 | $269,803 | Render Standard x10 | Scale |
| 100,000 | 60.0k | 9.0k | 7.2k | 36.0M | 384.0M | 11.44 | 54728 | 30.0k | 21290 | $45,390+ | INR 4,380,178+ | $544,685+ | Render Standard x20 | Enterprise needed |

### Component breakdown, balanced hybrid (P2)

| Registered | Vercel | Backend | Worker | Neon | LiveKit | R2 | Email | AI | Total | $/MAU | $/institution | $/live-participant-hour |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | $0 | $0 | $0 | $0 | $50 | $0 | $0 | $0 | $50 | $1.00 | $50 | $0.400 |
| 500 | $20 | $25 | $0 | $19 | $62 | $1 | $0 | $1 | $128 | $0.51 | $128 | $0.100 |
| 1,000 | $20 | $25 | $0 | $39 | $86 | $2 | $0 | $2 | $174 | $0.35 | $174 | $0.069 |
| 5,000 | $20 | $25 | $7 | $78 | $450 | $9 | $9 | $9 | $607 | $0.24 | $121 | $0.072 |
| 10,000 | $20 | $50 | $7 | $155 | $743 | $17 | $9 | $19 | $1,020 | $0.20 | $102 | $0.059 |
| 50,000 | $20 | $150 | $7 | $650 | $3,520 | $87 | $40 | $94 | $4,567 | $0.18 | $91 | $0.056 |
| 100,000 | $20 | $300 | $7 | $1,299 | $7,567 | $174 | $40 | $188 | $9,594 | $0.19 | $96 | $0.061 |

Annual cost is monthly × 12 (no discounts assumed). "Per institution" assumes about 1,000 registered users per institution (ASSUMED).

## 5. What drives cost

1. **Live participant-minutes dominate everywhere past the pilot.** LiveKit is 73-79% of the balanced-case total from 5,000 registered users and above. It is also the line item most sensitive to *teaching style*: at the same registered-user count the live-heavy profile costs about 2.4x the recorded-first profile at 500 users and 8-17x at 5,000-100,000 users (the base fees of the other services dominate at small sizes).
2. **Recording is the first LiveKit limit hit.** The Build plan includes **60 egress minutes per month**: about one recorded class-hour. Room-composite video recording uses video egress. A single college recording a few classes per week therefore needs Ship ($50) even with very few students. Audio-only recording ($0.005/min on Ship) is far cheaper but is not implemented (see [architecture](SCALABILITY_ARCHITECTURE.md)).
3. **Neon compute** is the second line: always-on 0.25 CU is about $19/month; it grows linearly with the CU you must hold.
4. **Heartbeats inflate API volume.** 240 `/health` requests per online hour per open tab dominate request counts and keep a free Render instance awake while anyone is online. They are cheap per request but set the instance count above ~1,000 concurrent users.
5. **Recording storage** is small at pilot size and large only for live-heavy loads (about 53 TB at 100,000 registered users under P3, around $820/month on R2, whose egress is free).
6. **AI is almost negligible** at these prices (about $0.04-0.05 per recorded class-hour) because summaries are generated once per class. It stops being negligible only if per-student AI features are added.
7. **Email** exceeds EmailJS's published plans (and its 1 request/second limit) by roughly 10,000 registered users; a transactional-email provider would then be needed (price UNVERIFIED; $0.10 per 1,000 is a placeholder).

## 6. Caveats and unknowns

* Practical capacity has **not** been established through representative load testing. Every "peak" and every instance count here is an estimate. See [CAPACITY_TEST_PLAN.md](CAPACITY_TEST_PLAN.md).
* UNKNOWN: current Vercel, Render and Neon plans; LiveKit plan and its real usage; EmailJS free-plan server-side policy; the Render workspace plan requirement for paid instances; Neon pooler connection limits; Groq free-tier limits for the exact model in use; the Enterprise LiveKit price; whether Neon always-on compute is needed (scale-to-zero on paid plans can reduce the compute line for low-traffic periods).
* Provider spending limits: Vercel Hobby and Neon Free cannot be exceeded (they stop instead of billing); Vercel Pro and Neon paid are pay-as-you-go **with no hard cap documented on the pages read**; Render offers a spend limit for build minutes. No usage alerts are configured by this project today.
* Not included: taxes (GST), payment processing, domain names, paid monitoring/APM, support plans, engineering time, backups beyond provider defaults.

## Sources

* Vercel pricing - https://vercel.com/pricing
* Render pricing and free-tier docs - https://render.com/pricing · https://render.com/docs/free · https://render.com/docs/compute-plans
* Neon pricing - https://neon.com/pricing
* LiveKit pricing - https://livekit.com/pricing (redirected from livekit.io)
* EmailJS pricing and REST API - https://www.emailjs.com/pricing/ · https://www.emailjs.com/docs/rest-api/send/
* Groq models and limits - https://console.groq.com/docs/models · https://console.groq.com/docs/rate-limits
* Cloudflare R2 pricing - https://developers.cloudflare.com/r2/pricing/
