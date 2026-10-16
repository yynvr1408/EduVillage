# Recording pipeline

How a live class becomes a recorded lesson with a transcript and a summary, what each step does, and how it is tested. Related: [verification status](FINAL_AUDIT.md) · [backend setup](BACKEND_SETUP.md) · [classroom tools](CLASSROOM_AND_COURSE_TOOLS.md).

## Workflow

| # | Step | Code | Tests |
|---|---|---|---|
| 1 | The teacher starts a live class, then explicitly starts recording; everyone sees a recording notice | `recording_service.start_recording`, `ClassroomPage` recording bar | `test_recordings`, `test_recording_library` |
| 2 | The backend reserves the recording row and asks LiveKit Egress for a **room-composite MP4** written straight to the bucket at `recordings/<class>/<recording>.mp4` | `integrations/livekit.start_recording` (`S3Upload` with endpoint, region and path-style options) | request shape asserted in unit tests |
| 3 | At most one active recording per class (partial unique index) | migration `3f1a9c2b7d10` | tests on SQLite and PostgreSQL |
| 4 | When egress ends, LiveKit calls `POST /api/v1/webhooks/livekit` with a signed JWT carrying the body hash | `api/v1/webhooks.py`, `livekit.verify_webhook` | `test_livekit_webhook`: unsigned, wrong-secret and tampered events rejected; replays harmless; a late event cannot resurrect a failed recording |
| 5 | **Finalisation:** on completion the backend checks that the object exists (`HEAD`); present means `available` with the real size, missing means `failed` | `recording_service.finalize_from_provider` | `test_s3_storage_and_recording_chain` (S3 protocol over real HTTP) |
| 6 | Polling fallback if the webhook is lost | `recording_service.refresh_status` | unit tests |
| 7 | The recording is private until the teacher publishes it | `set_published` | tests |
| 8 | A transcript and summary are produced automatically once the recording is available; the teacher reviews the summary before students see it | `summary_service`, `transcription_service` (ffmpeg chunking, Whisper, LLM) | `test_summary_pipeline`, `test_long_recording_transcription` |
| 9 | A student asks for playback; authorisation is re-checked (course enrolment, section, branch audience); a short-lived presigned URL is returned (300 seconds by default) | `recording_service.playback_info`, `can_access` | `test_recording_library`, `test_other_classes`, S3 chain test (signed URL, ranged GETs) |
| 10 | The browser plays or downloads in ranged chunks, and can keep the file for offline use | `downloadEngine`, `RecordedLecturePlayer` | `real_video_offline.spec.ts` (real Chromium, real video) |
| 11 | Deleting a recording removes the object and keeps the metadata (`archived`) | `delete_recording` | S3 chain test |

## Design notes

* R2 does not support presigned POST policies, so uploads use a presigned **PUT** with the exact signed `Content-Type`; the S3 client uses SigV4 and optional path-style addressing (`OBJECT_STORAGE_FORCE_PATH_STYLE`).
* The API exposes `Content-Range` and `Accept-Ranges` to the frontend origin so resumable downloads work across origins.
* Recording is video egress of the room, so the whiteboard (shared over the data channel) is not part of the file; a teacher who wants it recorded shares the whiteboard tab as a screen.
* A recording of a branch-wide class is only available to students of that branch.

## Checking a deployment

1. `LIVEKIT_*`, `STORAGE_BACKEND=s3` and `OBJECT_STORAGE_*` are set in the host's secret store (the repository contains placeholders only).
2. The bucket allows your frontend origin in CORS (methods `GET, PUT, HEAD`, headers `Content-Type, Range`), and LiveKit's webhook points at `https://<api>/api/v1/webhooks/livekit`.
3. Start a class, join as a student, start recording, speak, stop.
4. Confirm the recording moves from `processing` to `available`, the object exists with the expected size, and `duration_seconds` is set.
5. Publish it; open it as an enrolled student and seek; confirm a non-enrolled student gets 404.
6. Delete it and confirm the object is gone.
