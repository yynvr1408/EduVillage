# Final audit and readiness verdict

Supersedes the status rows in [BACKEND_REQUIREMENTS_MATRIX.md](BACKEND_REQUIREMENTS_MATRIX.md) where they differ. Companion: [RECORDING_VERIFICATION.md](RECORDING_VERIFICATION.md).

Test results below are from runs in this environment on 2026-10-15. "Faked" means a boundary was replaced in the test; a fake proves our logic around that boundary, not that the real service works.

## Test results (actually run)

| Suite | Result |
|---|---|
| Backend `pytest` (SQLite) | **209 passed** |
| Backend `pytest` on PostgreSQL 18 (migration subprocess tests excluded) | **207 passed** |
| Alembic upgrade → check → downgrade → upgrade (SQLite) and upgrade (PostgreSQL) for the new revision | passed |
| Frontend type-check (app **and tests**) | clean |
| Frontend unit tests (Vitest) | **97 passed** |
| Browser tests, real Chromium + production build + service worker (`npm run test:e2e:offline`) | **12 passed** |
| Browser layout tests at six viewport sizes (`npm run test:e2e:layout`) | **22 passed** |

The PostgreSQL run is what exposed the timezone bug in item 4 (below): the deadline tests passed on SQLite and failed on PostgreSQL until it was fixed.

## 1. Live class connectivity

**Implemented (frontend logic only; no layout or style changes — the existing recovery panel simply shows different text):**
- `services/connectivity.ts`: one function that keeps three signals apart — the device (browser online flag, now exposed separately by `NetworkContext`), the EduVillage API (`/health` heartbeat) and the live media state (LiveKit) — and produces the correct headline/guidance for each combination: device offline; browser "online" but nothing reachable (weak network); API and internet fine but media down; API down while media is healthy (the class is *not* reported lost); brief LiveKit retry.
- `useAdaptiveAudio` rewritten: the previous version could only *drop* video and never restored it, and only judged quality when a second quality event arrived. Now: sustained poor quality → audio-only (timer-based), sustained **good** quality (longer window) → video restored, relapse cancels recovery, no restore while the link is down, subscriptions re-applied after `Reconnected` and for newly published tracks, a manual choice always wins, timers cleaned up on leave.

**Verified:**
- 15 unit tests drive the state machine with a **simulated** LiveKit room (fake events/timers).
- 3 real-browser tests with the **real `livekit-client`** against a LiveKit URL nothing listens on: the media connection genuinely fails; the panel names the live server as the problem while internet/API are healthy, changes to "Your device is offline" when the device goes offline, and "Go to Downloads" works with no network.

**NOT verified (needs a LiveKit server and real participants):** a successful live session, actual video/audio flow, real quality adaptation under bandwidth limits, and reconnection to a real server. The adaptation logic is covered only by simulation.

## 2. Recording pipeline (Egress → R2 → finalization → playback)

See [RECORDING_VERIFICATION.md](RECORDING_VERIFICATION.md) for the step table. Summary:
- Fixed: R2 has no presigned POST — uploads now use presigned **PUT**; SigV4 + path-style option; `Content-Range` exposed via CORS; finalization verifies the object exists.
- Verified over real HTTP against an **S3-protocol emulator (moto)**: upload, HEAD, ranged GET, signed-URL shape, delete, content-mismatch cleanup, webhook → finalization (complete-but-missing-file → `failed`) → publish → student playback → delete.
- **Not verified:** LiveKit Egress producing a real MP4, Cloudflare R2 itself (credentials, region `auto`, CORS, signature validation, URL expiry), webhook delivery from a real server, real H.264 playback. The emulator does not validate signatures or expiry. **Status: PARTIAL — logic verified, cloud path unverified.**

## 3. Complete-recording summaries (FFmpeg chunking)

**Implemented:** `media_processing` (safe ffmpeg: argv list, no shell, timeout, `-nostdin`, secret-free errors) and `transcription_service`: speech-reduce audio (mono 16 kHz 32 kbps), cut into 10-minute chunks when over `STT_MAX_UPLOAD_BYTES` (24 MB; halves the chunk length if one is still too big), transcribe **every** chunk with bounded retry/backoff, persist finished chunks (`lecture_transcripts.chunk_state`, migration `7d3e1f5a9b22`) so a retry **resumes**, skip sub-second leftovers, combine in order. Long transcripts (> 60k chars) are summarised in parts and merged (nothing truncated). A summary records `transcript_complete`/`transcript_chunks`; one flagged incomplete cannot be approved; a recording that keeps failing ends as `failed`, never as a finished summary. Fail-fast `STT_NOT_CONFIGURED` before any ffmpeg work. Dockerfile now installs `ffmpeg` (could not be built here — see blockers).

**Verified (real ffmpeg; STT/LLM faked at the provider boundary):** generation and cutting of a genuine **~26 MB, 110-minute** audio file (over Whisper's 25 MB cap) into 11 chunks that each fit, covering the whole duration, combined in order; mid-way provider outage keeps finished chunks and the retry resumes at the failed chunk (not restarted); API/worker level: partial failure → retryable, nothing published, approve blocked → provider recovers → worker resumes → complete summary with provenance; permanent failure → `failed`; corrupt media → `MEDIA_INVALID` not retried; missing ffmpeg and silent/corrupt inputs handled.
**Not verified:** real Whisper accepting the chunks and quality of real transcripts; real LLM output; Docker image build with ffmpeg. **Status: PARTIAL — pipeline verified, providers unverified.**

## 4. Assignment status and deadlines

**Backend:** deadlines are now **enforced** (previously `due_at` was never checked): submissions and draft saves after the deadline are refused with `ASSIGNMENT_EXPIRED`. Offline-first policy for sync: a submission the student made *before* the deadline may sync up to `OFFLINE_SUBMISSION_GRACE_HOURS` (default 24) after it; the device clock can never extend that (future-dated clocks gain nothing, backdating beyond the window is ignored); otherwise server time decides. Refusals are recorded and replay identically.
**Real bug found and fixed while testing on PostgreSQL:** aware datetimes (`...Z`, `+05:30`) were reinterpreted in the database session's time zone, shifting stored deadlines/class times by hours (invisible on SQLite). Now aware inputs are converted to naive UTC, PostgreSQL sessions are forced to UTC, and **all API datetimes are returned as explicit UTC (`...Z`)** — which also fixes browsers displaying class/deadline times in the wrong zone.
**Frontend (logic, existing badges):** distinct states — *confirmed* (only after the backend's `accepted`), *Deadline passed*, *Conflict*, *Not accepted*, *Sync failed* (after 3 consecutive network failures; still retried), *Waiting to sync*. Refusals are final (never resent), persisted with the student's text (a browser test caught a bug where a refusal was lost on reload — fixed), and a fresh submission after a refusal gets a new operation id. Operations the server didn't answer return to the queue.
**Verified:** 14 backend deadline tests (incl. grace window, forged/future clocks, replay, timezone offsets), 11 frontend unit tests, 3 real-browser tests (expired shown as such and survives reload; offline → queued → syncs on reconnection → "Server Confirmed" only after the server has it; server unreachable → never "received").
**Status: PASS** for the implemented behaviour.

## 5. Other changes made

`requirements-dev.txt` (bundled ffmpeg + S3 emulator for tests), `.env.example` additions (placeholders only), `OFFLINE_SUBMISSION_GRACE_HOURS`, `FFMPEG_*`, `STT_*`, `OBJECT_STORAGE_FORCE_PATH_STYLE`. No secrets were read or printed.

## Blockers and remaining manual verification

1. **LiveKit server + Egress + real participants** (live media, adaptation on a real network, real recording).
2. **Cloudflare R2 with real credentials** (SigV4/region, browser CORS for PUT/ranged GET, URL expiry).
3. **OpenAI (or chosen) STT + LLM keys**: chunk acceptance, transcript quality, summary quality.
4. **Docker image build/run** with ffmpeg (daemon was not running here).
5. A real **H.264/AAC** recording played in Chrome/Firefox/Safari.
6. Hosted deployment, TLS, multi-process rate limiting (unchanged from the earlier audit).

## Readiness verdict

**Not production-ready; ready for a staging deployment and a supervised pilot with the manual verifications above.**

Application logic that can be tested without external services is in good shape and verified: authorization, offline downloads and playback (including a real video decoded offline), idempotent sync, deadline enforcement, assignment states, long-recording transcription logic, recording finalization logic, and connectivity diagnosis. The things a rural-college class actually depends on — a working live session, a recording that really lands in R2 and plays back, and real transcription — have **never been exercised against the real services**, and four of them can only be validated with credentials and people this environment does not have. Do not run a live class for students until items 1–3 above have been done once end to end.
