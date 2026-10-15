"""Long-recording transcription. FFmpeg is REAL (audio is generated and cut by the actual binary);
the speech-to-text and LLM providers are replaced at their boundary, so these tests prove the
chunking, ordering, resume and completeness logic — not that Whisper accepts the chunks."""

import time
from pathlib import Path

import pytest

from tests.conftest import make_audio, requires_ffmpeg

pytestmark = requires_ffmpeg

WHISPER_LIMIT = 25 * 1024 * 1024


@pytest.fixture
def stt(monkeypatch):
    """Records every chunk the 'provider' is asked to transcribe."""
    from app.integrations import speech_to_text
    from app.services import media_processing

    monkeypatch.setattr(speech_to_text.settings, "speech_to_text_api_key", "test-key")
    calls: list[dict] = []

    def fake_transcribe(path: Path) -> str:
        calls.append({"name": path.name, "bytes": path.stat().st_size, "duration": media_processing.probe_duration_seconds(path)})
        return f"part-{len(calls)}"

    monkeypatch.setattr(speech_to_text, "transcribe", fake_transcribe)
    return calls


def _transcript(db):
    from app.db.models.summary import LectureTranscript

    t = LectureTranscript(class_id=None)
    return t


def test_split_audio_cuts_consecutive_segments_with_the_real_ffmpeg(tmp_path):
    from app.services import media_processing

    src = make_audio(tmp_path / "a.mp3", seconds=25)
    chunks = media_processing.split_audio(src, tmp_path / "out", segment_seconds=10)
    assert [c.name for c in chunks] == ["chunk_0000.mp3", "chunk_0001.mp3", "chunk_0002.mp3"]
    durations = [media_processing.probe_duration_seconds(c) for c in chunks]
    assert [round(d) for d in durations] == [10, 10, 5]


def test_extract_reduces_any_input_to_small_speech_audio(tmp_path):
    from app.services import media_processing

    wav = make_audio(tmp_path / "big.wav", seconds=20, bitrate="256k", rate=44100)
    speech = media_processing.extract_speech_audio(wav, tmp_path / "speech.mp3")
    assert speech.stat().st_size < wav.stat().st_size / 5
    assert round(media_processing.probe_duration_seconds(speech)) == 20


def test_corrupt_or_audioless_input_fails_with_a_clean_error(tmp_path):
    from app.services import media_processing

    junk = tmp_path / "junk.bin"
    junk.write_bytes(b"not media at all" * 100)
    with pytest.raises(media_processing.MediaError) as exc:
        media_processing.extract_speech_audio(junk, tmp_path / "o.mp3")
    assert exc.value.code == "MEDIA_INVALID" and str(tmp_path) not in exc.value.message  # no server paths leak


def test_missing_ffmpeg_is_reported_not_crashed(monkeypatch, tmp_path):
    from app.services import media_processing

    monkeypatch.setattr(media_processing.settings, "ffmpeg_path", "definitely-not-installed-ffmpeg")
    with pytest.raises(media_processing.MediaError) as exc:
        media_processing.extract_speech_audio(tmp_path / "x", tmp_path / "y")
    assert exc.value.code == "FFMPEG_NOT_AVAILABLE"


def test_a_recording_larger_than_whisper_limit_is_cut_and_every_chunk_is_transcribed(stt, tmp_path, db_session):
    """~110 minutes of CBR audio = ~26 MB: genuinely over the 25 MB upload cap."""
    from app.db.models.summary import LectureTranscript
    from app.services import transcription_service

    started = time.time()
    long_audio = make_audio(tmp_path / "lecture.mp3", seconds=6600, noise=True)
    assert long_audio.stat().st_size > WHISPER_LIMIT  # precondition: this really would be rejected by Whisper as one file

    transcript = LectureTranscript(class_id=_class_id(db_session))
    db_session.add(transcript)
    db_session.commit()
    text = transcription_service.transcribe_recording(db_session, transcript, long_audio, tmp_path / "work")

    assert len(stt) == 11  # 6600 s / 600 s chunks (a sub-second leftover is not sent to the provider)
    assert all(c["bytes"] < WHISPER_LIMIT for c in stt)  # every upload fits
    assert sum(round(c["duration"]) for c in stt) == 6600  # the chunks cover the WHOLE recording, no gaps
    assert text.split("\n\n") == [f"part-{i}" for i in range(1, 12)]  # combined in recording order
    done, total = transcription_service.chunk_summary(transcript)
    assert done == total >= 11  # every chunk, including the empty leftover, is accounted for
    print(f"long-recording test took {time.time() - started:.1f}s")


def _class_id(db):
    """A real class row, since transcripts reference one."""
    from app.db.models.classroom import Class
    from app.db.models.course import Course
    from app.db.models.enums import CourseStatus, UserRole
    from app.db.models.user import User
    from app.db.base import utcnow

    teacher = User(full_name="T", email=f"t{time.time_ns()}@example.com", password_hash="x", role=UserRole.teacher)
    db.add(teacher)
    db.flush()
    course = Course(title="C", teacher_id=teacher.id, status=CourseStatus.published)
    db.add(course)
    db.flush()
    cls = Class(course_id=course.id, teacher_id=teacher.id, title="L", scheduled_start=utcnow())
    db.add(cls)
    db.commit()
    return cls.id


def test_a_provider_failure_midway_keeps_finished_chunks_and_the_retry_resumes(monkeypatch, tmp_path, db_session):
    from app.core.exceptions import AppError
    from app.db.models.summary import LectureTranscript
    from app.integrations import speech_to_text
    from app.services import transcription_service

    monkeypatch.setattr(speech_to_text.settings, "speech_to_text_api_key", "test-key")
    monkeypatch.setattr(transcription_service.settings, "stt_max_upload_bytes", 6000)  # 4 s of 32 kbps audio = 16 KB → must chunk
    monkeypatch.setattr(transcription_service.settings, "stt_chunk_seconds", 1)
    audio = make_audio(tmp_path / "rec.mp3", seconds=4)

    seen: list[str] = []
    outage = {"on": True}

    def flaky(path):
        index = int(path.stem.split("_")[1])
        if index == 2 and outage["on"]:
            raise RuntimeError("provider down")
        seen.append(path.name)
        return f"text-{index}"

    monkeypatch.setattr(speech_to_text, "transcribe", flaky)
    transcript = LectureTranscript(class_id=_class_id(db_session))
    db_session.add(transcript)
    db_session.commit()

    sleeps: list[float] = []
    with pytest.raises(AppError) as exc:
        transcription_service.transcribe_recording(db_session, transcript, audio, tmp_path / "w1", sleep=sleeps.append)
    assert exc.value.code == "STT_CHUNK_FAILED"
    assert sleeps == [1, 2]  # bounded exponential backoff, then give up
    db_session.refresh(transcript)
    assert sorted(transcript.chunk_state["done"]) == ["0", "1"]  # the finished chunks were saved
    assert seen == ["chunk_0000.mp3", "chunk_0001.mp3"]

    outage["on"] = False
    seen.clear()
    text = transcription_service.transcribe_recording(db_session, transcript, audio, tmp_path / "w2", sleep=lambda s: None)
    assert seen[0] == "chunk_0002.mp3" and "chunk_0000.mp3" not in seen and "chunk_0001.mp3" not in seen  # resumed, not restarted
    assert text.startswith("text-0\n\ntext-1\n\ntext-2")  # earlier chunks kept, later ones appended in order
    done, total = transcription_service.chunk_summary(transcript)
    assert done == total


def test_provider_not_configured_fails_before_any_ffmpeg_work(monkeypatch, tmp_path, db_session):
    from app.core.exceptions import AppError
    from app.db.models.summary import LectureTranscript
    from app.integrations import speech_to_text
    from app.services import media_processing, transcription_service

    monkeypatch.setattr(speech_to_text.settings, "speech_to_text_api_key", None)
    monkeypatch.setattr(media_processing, "extract_speech_audio", lambda *a, **k: pytest.fail("ffmpeg must not run"))
    t = LectureTranscript(class_id=_class_id(db_session))
    with pytest.raises(AppError) as exc:
        transcription_service.transcribe_recording(db_session, t, tmp_path / "x", tmp_path)
    assert exc.value.code == "STT_NOT_CONFIGURED"


def test_a_long_transcript_is_summarised_in_parts_so_nothing_is_cut_off(monkeypatch):
    from app.integrations import llm_provider

    paragraphs = [f"Topic {i}. " + ("Lecture content sentence. " * 200) for i in range(40)]  # ~ 200k chars
    transcript = "\n\n".join(paragraphs)
    assert len(transcript) > llm_provider.LONG_TRANSCRIPT_CHARS

    seen_parts: list[str] = []

    def fake_summarize(text: str) -> dict:
        seen_parts.append(text)
        return {"overview": f"covers {text[:8]}", "key_concepts": [f"first:{text[:8]}", "shared"], "definitions": [], "examples": [], "revision_questions": [], "source": "stub"}

    monkeypatch.setattr(llm_provider, "_stub_summary", fake_summarize)
    result = llm_provider.generate_summary(transcript)

    assert len(seen_parts) > 1 and result["parts_summarized"] == len(seen_parts)
    assert "".join(p.replace("\n\n", "") for p in seen_parts) == transcript.replace("\n\n", "")  # every character reached a summarizer
    assert "Topic 39" in seen_parts[-1]  # the END of the lecture was summarised too
    assert result["key_concepts"].count("shared") == 1  # merged without duplicates
