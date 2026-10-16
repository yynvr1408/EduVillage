# Deployment and upgrade roadmap

Planning document, dated **2026-10-16**. Costs come from [INFRASTRUCTURE_COST_MODEL.md](INFRASTRUCTURE_COST_MODEL.md) (balanced hybrid profile P2, with the recorded-first P1 and live-heavy P3 range in brackets). They are **estimates from assumed workloads**, not quotes and not measured capacity. User ranges are planning bands, not guarantees. Everything below is **future work** unless marked "done".

Principles: the frontend **stays on Vercel**; upgrade **one component at a time, triggered by a measured signal** (not by registered-user count); no Kubernetes, queues, Redis or replicas until a measurement shows they are needed. Related: [architecture](SCALABILITY_ARCHITECTURE.md) · [capacity test plan](CAPACITY_TEST_PLAN.md) · [README](../README.md).

## 0. Before any stage - blockers that are not about scale

| # | Item | Why | Status |
|---|---|---|---|
| 0.1 | **Rotate the admin password.** The real admin credentials were committed to `backend/.env.example` (commit `3b47ed2`) and are in public git history. Blank the file (done in the working tree), set a new `ADMIN_PASSWORD` in the Render dashboard, set `ADMIN_RESET_PASSWORD_ON_START=true` for one restart, then back to `false`. Consider rewriting history only if the repository is public and policy requires it. | Credential exposure | **Open** |
| 0.2 | Use a **separate development database** (a second Neon project) so a developer's local run can never touch production. | An uncommitted migration reached the shared database during this project | **Open** |
| 0.3 | Keep a **single Alembic head**; migrations now include `815ac36126a9` before `e6a0ffee0005`. | Two heads break `alembic upgrade head` on deploy | Done (migration chain is linear; `alembic heads` shows one head) |
| 0.4 | Confirm EmailJS delivery of the OTP from the **deployed** backend (`EMAILJS_*` set on Render). | Password recovery and second-device sign-in depend on it | Open |

## Stage 1 - MVP (about 100 registered users)

* **Stack:** Vercel (Hobby is non-commercial: acceptable only for a demonstration) · Render Free · Neon Free · LiveKit Build · EmailJS Free · Groq free tier · R2 free tier.
* **Cost:** about $0/month for recorded-first use; **$50/month** (LiveKit Ship) as soon as live classes are recorded or exceed 5,000 participant-minutes/month. P2 $50 (annual $603), P3 $63.
* **Main bottleneck:** LiveKit Build (60 egress minutes, 5,000 participant-minutes, 100 concurrent); Render cold starts.
* **Upgrade trigger:** any real college using it; recordings above one hour/month; any LiveKit usage warning at 75%.
* **Work:** items 0.1-0.4; add a GitHub Actions workflow that runs the test suites; configure provider usage alerts (see monitoring below).
* **Risks:** free-tier suspension (Neon CU-hours, Render hours), cold start during a demo - warm the API before presenting.

## Stage 2 - College pilot (about 100-1,000 registered users)

| Order | Change | Trigger | Steps | Monthly cost | Effort | Rollback |
|---|---|---|---|---|---|---|
| 2.1 | **Render: free -> Standard** (1 CPU, 2 GB) | First pilot, or any cold-start complaint | Change `plan` in `render.yaml` (or the dashboard), redeploy; keep one instance | +$25 | 1 hour | Switch back to `free`; no data lives on the instance |
| 2.2 | **LiveKit Build -> Ship** | Recording more than about one class-hour a month, or 5,000 participant-minutes | Upgrade in the LiveKit dashboard; keys and URL unchanged; set a usage alert | +$50 base (+ overage $0.0005/min after 150,000) | 30 min | Downgrade at the next billing cycle |
| 2.3 | **Vercel Hobby -> Pro** | Any commercial or institutional use | Upgrade the team; no code change | +$20 | 15 min | Downgrade |
| 2.4 | **Neon Free -> Launch** | DB above about 0.5 GB, or 80 of 100 CU-hours used, or the need for more than 6 h of restore | Change plan, keep the same project and connection string; disable scale-to-zero only if cold starts matter | about $19-39 (0.25-0.5 CU always-on + storage) | 30 min | Downgrade; data stays |
| 2.5 | **EmailJS Free -> Personal** | More than about 150 OTP emails/month | Upgrade; no code change | +$9 | 15 min | Downgrade |
| 2.6 | Code hardening that is independent of plan: `pool_pre_ping=True`, request timeouts, college scoping of courses, institution administrator role if colleges want self-service | Before the pilot | PRs with tests | engineering time | days | Revert PR |

* **Total (planning):** about **$128-174/month** at 500-1,000 registered users, P2 (P1 $115-134; P3 $275-582). Annual about $1,539-2,083 (P2).
* **Main bottleneck:** LiveKit minutes (grows with live teaching), then Neon compute.
* **Do not yet:** add instances, Redis, a queue or a replica.

## Stage 3 - Multi-college (about 1,000-10,000 registered users)

| Order | Change | Trigger | Steps | Monthly cost | Effort | Rollback |
|---|---|---|---|---|---|---|
| 3.1 | **Reduce heartbeat load** (`/health` every 15 s per tab): back off when the tab is hidden or the API is healthy for a while | CPU or request rate approaching about 50% of capacity in load tests | Frontend change + test | $0 | 1 day | Revert |
| 3.2 | **Deploy the worker** (`python -m app.worker`) as a Render background worker | Any stranded summary job, or long transcriptions slowing the API | Add a worker service to `render.yaml` | about $7+ (UNVERIFIED: price of a worker instance assumed equal to a web instance of the same size) | half a day | Remove the service; BackgroundTasks continue |
| 3.3 | **Second API instance** | Sustained CPU above about 70% or p95 above target in the load test | Scale to 2 Standard instances; **first** fix migration-on-start (run migrations once, e.g. as a deploy step) and decide on rate limiting (3.4) | +$25 per instance | 1 day | Scale back to 1 |
| 3.4 | **Shared rate-limit store** | Only if per-instance in-memory limits are measurably bypassed | Move counters to the database or a managed Redis (price UNKNOWN at selection time) | UNKNOWN | 1-2 days | Revert to in-memory |
| 3.5 | **Transactional email provider** | EmailJS Business (25,000 requests/month) or the 1 request/s limit approached | Replace the `_send` function in `integrations/email.py` (single seam) | UNVERIFIED (about $0.10 per 1,000 emails is a placeholder) | 1 day | Switch back via config |
| 3.6 | **R2 retention policy** and lifecycle (for example delete or archive recordings after 90-180 days) | Stock above about 500 GB | Lifecycle rule + teacher notice | R2 about $0.015/GB-month | 1 day | Disable the rule (deleted objects are not recoverable) |
| 3.7 | **LiveKit Ship -> Scale** | When Ship's combined overage (minutes, downstream GB and recording egress) would exceed Scale's $500 base. In the cost model with every class recorded that happens at roughly 0.5-0.75 million participant-minutes/month; for minutes alone it would be about 1.05 million | Upgrade | $500 base | 30 min | Downgrade |

* **Total (planning):** **$607-1,020/month** at 5,000-10,000 registered users, P2 (P1 $218-337; P3 $1,816-4,129). Annual about $7,281-12,239 (P2).
* **Main bottleneck:** LiveKit participant-minutes and egress; Neon compute.

## Stage 4 - Large deployment (about 10,000-100,000 registered users)

* **Stack:** 5-12 Render Standard instances (cost model; **unmeasured planning figure**), Neon Scale (30-day restore), LiveKit Scale (Enterprise if concurrent live participants exceed 5,000), R2 with lifecycle rules, dedicated worker(s), transactional email provider, error tracking and cost dashboards.
* **Total (planning):** **$4,567-9,594/month** at 50,000-100,000 registered users, P2 (P1 $1,542-2,612; P3 $22,484 to $45,390+, the last figure a lower bound because LiveKit Enterprise is required). Annual about $54,802-115,128 (P2).
* **Triggers:** measured p95 latency or error rate outside the acceptance criteria in [CAPACITY_TEST_PLAN.md](CAPACITY_TEST_PLAN.md); database CPU sustained high with a read-heavy profile (only then consider a read replica); LiveKit concurrency above Scale's 5,000.
* **Also needed:** tested backup and restore, disaster-recovery runbook, dependency-update routine, a staging environment that mirrors production.
* **Risks:** cost concentration in live minutes; an Enterprise contract; operational maturity (on-call) is a non-infrastructure requirement.

## Monitoring and alerts (all stages; nothing here is configured today)

| Signal | Where | Alert at |
|---|---|---|
| LiveKit participant-minutes, concurrent connections, egress minutes, GB | LiveKit dashboard / usage alerts if offered | 50%, 75%, 90% of plan |
| Neon CU-hours, storage | Neon console | 50%, 75%, 90% |
| Render instance hours (free), CPU, memory, bandwidth | Render dashboard | 75% |
| Vercel bandwidth and requests | Vercel dashboard / spend management | 75% |
| EmailJS requests | EmailJS dashboard | 75% of plan |
| Groq tokens and audio hours | Groq console | 75% of limits |
| R2 storage and operations | Cloudflare dashboard | 75% of free tier |
| API p95 latency and 5xx rate | Application logs (add a lightweight metric) | per the acceptance criteria |

Whether each provider offers a **hard** spending cap is not established for every provider; assume it does not unless the provider documents one.

## Cost optimisation (all optional)

1. Prefer **audio-only recording** for classes where video adds little (LiveKit audio-only egress is $0.005/min versus $0.02/min video on Ship). This needs a code change (currently `RoomCompositeEgressRequest` video MP4) and is **not implemented**.
2. Encourage recorded-first teaching: recorded lessons cost R2 storage with free egress instead of live minutes.
3. Retention policies on recordings.
4. Keep AI to one transcription + one summary per class (already the design) with a per-teacher daily limit (not implemented).
5. Reduce heartbeat frequency (3.1).
6. Use Neon scale-to-zero on non-production databases.
