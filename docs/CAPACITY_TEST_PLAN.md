# Capacity test plan

**Status: planned. No load test has been run.** Practical production capacity has not yet been established through representative load testing; the figures in [INFRASTRUCTURE_COST_MODEL.md](INFRASTRUCTURE_COST_MODEL.md) (including the planning figure of 40 requests/second per Render Standard instance) are estimates that this plan is meant to replace with measurements. Related: [architecture](SCALABILITY_ARCHITECTURE.md) · [roadmap](DEPLOYMENT_UPGRADE_ROADMAP.md) · [README](../README.md).

Terminology used throughout: **theoretical capacity** (what a provider advertises), **estimated capacity** (this repository's assumptions), **measured capacity** (results of this plan on staging), **verified production capacity** (measured plus observed in production). Only the last two may be quoted as capacity.

## 1. Test environment

* **Never test against production.** Create a **staging** environment that mirrors it: a separate Render service (same Dockerfile and plan as the one being sized), a **separate Neon project** (same plan/CU limits, seeded with synthetic data), a separate R2 bucket, a LiveKit project used only for tests (watch its quota), no real email (`EMAILJS_*` blank, so OTPs are returned in the API response in non-production), and the AI keys blank (the labelled stub) or a test key with a spend limit.
* **Frontend**: for API tests the frontend is not needed; browser journeys use the existing real-stack config (`npm run test:e2e:real`).
* **Load generator** on a separate machine in the same region as the API (k6 or Locust; either is acceptable; neither is installed in this repository today). Do not run it from the same host as the API.
* **Data**: scripts that create synthetic colleges, branches, sections, users, courses, enrolments and classes through the real API (admin credentials only in environment variables). Use at least 10x the size of the user population you are testing.

## 2. Workload profiles

Use the same three profiles as the cost model so measurements can replace its assumptions:

| Profile | Mix of sessions | Notes |
|---|---|---|
| P1 recorded-first | 85% browse/download/submit, 15% join a live class | Low API write rate |
| P2 hybrid | 60% browse/recordings/assignments, 30% join live, 10% teacher actions | Planning case |
| P3 live-heavy | 30% browse, 60% join live class, 10% teacher actions | Join bursts at class start |

Each simulated user also generates the **`GET /health` heartbeat every 15 s** the real frontend sends (verify the interval in `frontend/src/context/NetworkContext.tsx` before each run).

## 3. Representative requests

| Group | Requests (all under `/api/v1` except health) | Notes |
|---|---|---|
| Probe | `GET /health`, `GET /ready` | `/ready` touches the database |
| Authentication | `POST /auth/login`, `GET /users/me`, `POST /auth/logout`; second-device flow `POST /auth/login` then `POST /auth/login/verify-otp` (OTP read from the non-production response) | Argon2 hashing is deliberately CPU-expensive: expect login to be the first CPU saturation point; per-process rate limits will start returning 429 under load: use many test accounts and IPs, or raise the limits in staging only |
| Registration lookups | `GET /registration/colleges`, `.../branches`, `.../sections` | Public, cacheable candidates |
| Discovery / enrolment | `GET /courses`, `GET /courses/catalog`, `POST /courses/{id}/enrollments` | Pagination up to 200 |
| Classes | `GET /classes`, `GET /classes/{id}`, `POST /classes/{id}/join-token` | Token issuance is cheap; LiveKit itself is the real limit |
| Learning content | `GET /recordings`, recording playback info, resource list | Presigned URLs, no media through the API |
| Assignments | `GET /assignments`, `POST /sync/operations` | Idempotent batch sync, write path |
| Teacher actions | create course / class / section | Low volume |
| Admin | `/admin/colleges`, `/admin/overview` | Low volume |
| Password recovery | `POST /auth/forgot-password`, `POST /auth/verify-reset-otp` | Rate-limited by design |

## 4. Scenarios

1. **Baseline**: 1 virtual user per endpoint group, 5 minutes; record single-request latency.
2. **Ramp**: increase virtual users in steps (for example 10, 25, 50, 100, 250, 500, 1,000 *concurrent app users*) holding each 10 minutes, per profile.
3. **Spike**: 0 to N logins plus join-token requests within 60 s (a class start), N = the expected size of the largest class (for example 60) then 5x.
4. **Soak**: 60-70% of the highest passing step for 2 hours (memory growth, connection leaks, Neon suspend/resume behaviour with `pool_pre_ping` off and on).
5. **Cold start**: stop traffic for 20 minutes (Render free and Neon free both suspend), then measure first-request latency and error rate.
6. **Background load**: while the ramp runs, process a recording through the transcription pipeline with a synthetic 60-minute audio file to measure the effect of ffmpeg and Whisper/LLM calls on API latency (use the stub provider or a capped test key).
7. **Live class join**: use real browsers or the LiveKit load-test tooling against the **test** LiveKit project to measure join success and time-to-first-frame at 10, 25, 50, 100 participants; record participant-minutes consumed (so the test does not exhaust the plan).
8. **Failure injection**: kill the API mid-job, then verify that stranded jobs are recovered by `python -m app.worker --once`; revoke the database connection and verify graceful errors.

## 5. Metrics to record

| Layer | Metrics |
|---|---|
| Client side (load tool) | Requests/s, p50 / p95 / p99 latency per endpoint, error rate by status code, join-token success rate |
| API host (Render) | CPU %, memory, instance restarts, outbound bandwidth |
| Database (Neon) | CU usage and autoscaling level, active connections vs limit, slow queries (`pg_stat_statements` if enabled), cold-start time |
| LiveKit | Participant-minutes, concurrent connections, egress minutes, join success |
| Others | EmailJS requests and the 1 req/s limit, AI tokens and audio hours, R2 operations |

## 6. Initial acceptance criteria

These are starting points to be refined after the first run (the purpose of each is in the last column).

| Criterion | Target | Purpose |
|---|---|---|
| Read endpoints (catalog, classes, registration lookups) p95 | < 500 ms at the target concurrency | Interactive feel on slow phones |
| Login p95 | < 1.5 s | Argon2 is intentionally slow; keep sign-in usable |
| Join-token p95 | < 500 ms | Class-start bursts must not queue |
| Error rate (5xx and timeouts) | < 1% at target; 0% for sync writes | Data safety; idempotent sync must not lose submissions |
| CPU at target | < 70% sustained | Headroom for spikes |
| Memory | no monotonic growth in the soak test | Leak detection |
| Database connections | < 70% of the limit | Avoid pool exhaustion |
| Live join success | >= 98% within 10 s | Class start experience |
| Cold start | documented, with a warm-up step in the demo runbook | Free-tier behaviour |

The **capacity of one Render Standard instance** is the highest step that meets every criterion, divided by the heartbeat+API request mix; replace the cost model's 40 requests/second with that number and re-run `python docs/cost_model.py`.

## 7. Safe execution procedure

1. Confirm the target URL is the staging service (print the host before starting; abort if it matches a production host).
2. Confirm staging uses its own Neon project, bucket and LiveKit project, and that EmailJS is not configured.
3. Start with the baseline scenario and increase gradually; stop on sustained 5xx above 5%.
4. Keep a log of start/stop times to correlate with provider dashboards.
5. After the run, delete the synthetic data and check the providers' usage meters so the test did not consume production quotas.
6. Record the results in this file under "Results" with the date, commit hash, plan sizes and tool version. **Do not report numbers that were not measured.**

## 8. Known limitations of this plan

* A single load generator cannot reproduce rural mobile network conditions; use throttling (for example 3G profiles in browsers) for the browser journeys.
* Real LiveKit media quality cannot be judged by synthetic devices.
* The free tiers of Render and Neon change behaviour under load (suspension, quotas); results from a free-tier staging environment do not transfer to paid plans. Test the plan you intend to run.
* In-process rate limits make multi-instance results differ from a single instance.
* Provider quotas may be consumed by tests; check before and after.

## Results

*None yet. This section is intentionally empty until real measurements exist.*
