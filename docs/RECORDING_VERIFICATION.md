# Recording pipeline: LiveKit Egress → Cloudflare R2 → finalization → student playback

What the code does, what was actually verified, and exactly what still needs real credentials and real participants. Nothing here is claimed as verified unless a test that was run is named.

## The workflow

| # | Step | Code | Verified how |
|---|---|---|---|
| 1 | Teacher starts a **live** class, then explicitly starts recording | `recording_service.start_recording` | `test_recordings.py`, `test_recording_library.py` (LiveKit calls faked) |
| 2 | Backend reserves the row, then asks LiveKit Egress for a **room-composite MP4** written **directly to the bucket** at `recordings/<class>/<recording>.mp4` (`livekit.start_recording`, `S3Upload` with endpoint/region/`force_path_style`) | `integrations/livekit.py` | request shape only; **not** run against a real LiveKit/Egress |
| 3 | At most one active recording per class (partial unique index) | migration `3f1a9c2b7d10` | tests + PostgreSQL |
| 4 | Egress finishes → LiveKit calls `POST /api/v1/webhooks/livekit` (signed JWT carrying the body SHA-256) | `api/v1/webhooks.py`, `livekit.verify_webhook` | `test_livekit_webhook.py`: unsigned / wrong secret / tampered body rejected, replay idempotent, late event cannot resurrect a failed recording |
| 5 | **Finalization:** on `EGRESS_COMPLETE` the backend does a storage `HEAD` for the key; present → `available` with the real size, missing → `failed` ("media file was not found in storage") | `recording_service.finalize_from_provider` | `tests/integration/test_s3_storage_and_recording_chain.py` against an S3-protocol emulator over real HTTP |
| 6 | Polling fallback if the webhook is lost | `recording_service.refresh_status` | unit tests with a faked provider |
| 7 | Teacher publishes (private by default) | `set_published` | tests |
| 8 | Student asks for playback → authorization re-checked → **presigned GET** (default 300 s) | `playback_info` | emulator test: signed URL, `X-Amz-Expires=300`, full and `Range` GETs return the right bytes |
| 9 | Browser plays / downloads in range chunks | frontend `downloadEngine` | `real_video_offline.spec.ts` (real Chromium, real VP9 video, fake HTTP server) |
| 10 | Delete = remove object, keep metadata (`archived`) | `delete_recording` | emulator test: object really gone, playback stops |

### Findings from this audit (fixed)

1. **R2 does not support presigned POST policies.** Resource uploads used `generate_presigned_post`, which cannot work on R2. Uploads now use a presigned **PUT** with the exact signed `Content-Type`; the frontend PUTs straight to the URL without cookies.
2. S3 client now uses **SigV4** explicitly and supports path-style addressing (`OBJECT_STORAGE_FORCE_PATH_STYLE`), and the same flag is passed to LiveKit's `S3Upload`.
3. The API did not expose `Content-Range`/`Accept-Ranges` to browsers on another origin; resumable downloads need them (CORS `expose_headers`).
4. Recording finalization previously trusted the provider's "complete"; it now verifies the object exists.

## What was NOT verified (needs real credentials and/or participants)

The emulator used in tests (moto) speaks the S3 protocol but is **not AWS S3 and not Cloudflare R2**. It does not validate signatures or enforce URL expiry.

| Not verified | Why it matters | How to verify |
|---|---|---|
| **LiveKit Egress actually producing an MP4** and uploading it | The whole point of recording | Run LiveKit server + Egress (Chrome-based) with `LIVEKIT_*` set; start a class with ≥1 publishing participant for ≥30 s; start recording; stop; confirm the object appears in the bucket and the webhook arrives |
| **R2 accepts the credentials, SigV4 signing and `region=auto`** | R2-specific behaviour | Set `OBJECT_STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `OBJECT_STORAGE_REGION=auto`, an R2 API token with Object Read & Write on the bucket; upload a resource and play a recording |
| **Browser → R2 CORS** (direct PUT upload, ranged GET playback) | Without it browsers block both | Bucket CORS must allow your frontend origin, methods `GET, PUT, HEAD`, headers `Content-Type, Range`, expose `Content-Range, Accept-Ranges, ETag`. Check in a real browser |
| Presigned URL **expiry** actually enforced | Security of "short-lived" links | After `expires_in`, a GET of the URL must return 403 |
| Whether Egress needs `force_path_style` for R2 | Config only | Try both; keep what works |
| Webhook delivery from a real LiveKit server (URL reachable, key/secret match) | Finalization depends on it (polling is the fallback) | Point LiveKit's webhook at `https://<api>/api/v1/webhooks/livekit` |
| Playback of a **real Egress-produced MP4** (H.264/AAC) across browsers | Codec/browser support | Play in Chrome, Firefox, Safari |
| Large recordings (hundreds of MB) end to end | Memory/quota behaviour | Record ~60 min; verify finalization size and download |

## Manual verification checklist

1. `LIVEKIT_URL/KEY/SECRET`, `STORAGE_BACKEND=s3`, `OBJECT_STORAGE_*` set (placeholders only in `.env.example`; put real values in the deployment secret store, never in the repo).
2. Webhook configured; API reachable from LiveKit.
3. Start class, join as student, start recording (students see the recording notice), speak, stop.
4. Confirm: recording row `processing` → `available`; object exists in R2 with the expected size; `duration_seconds` set.
5. Publish; as an enrolled student open the recording and seek; as a non-enrolled student confirm 404.
6. Delete the recording; confirm the object is removed from R2.
