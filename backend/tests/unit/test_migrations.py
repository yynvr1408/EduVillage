"""The migration chain must build a schema from scratch AND carry existing rows across the
newest revision without loss. Runs Alembic in a subprocess against a throwaway SQLite file
(PostgreSQL is not available in the test environment — see docs/BACKEND_SETUP.md)."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
PREVIOUS_REVISION = "ad72faae9d99"


def _alembic(db_path: Path, *args: str) -> None:
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db_path}"}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_upgrade_preserves_existing_rows_and_applies_safe_defaults(tmp_path):
    db = tmp_path / "migrate.db"
    _alembic(db, "upgrade", PREVIOUS_REVISION)

    con = sqlite3.connect(db)
    con.executescript(
        """
        INSERT INTO users (id, full_name, email, password_hash, role, status, created_at, updated_at)
          VALUES ('u1','T','t@example.com','x','teacher','active','2026-01-01','2026-01-01');
        INSERT INTO courses (id, title, teacher_id, status, created_at, updated_at)
          VALUES ('c1','Biology','u1','published','2026-01-01','2026-01-01');
        INSERT INTO classes (id, course_id, teacher_id, title, scheduled_start, status, created_at, updated_at)
          VALUES ('k1','c1','u1','Lecture','2026-01-02','ended','2026-01-01','2026-01-01');
        INSERT INTO class_recordings (id, class_id, requested_by, egress_id, storage_key, status, started_at, created_at, updated_at)
          VALUES ('r1','k1','u1','eg-1','recordings/k1/r1.mp4','available','2026-01-02','2026-01-02','2026-01-02');
        INSERT INTO lecture_transcripts (id, class_id, language, content, status, created_at, updated_at)
          VALUES ('t1','k1','en','hello','ready','2026-01-02','2026-01-02');
        INSERT INTO sync_operations (id, user_id, operation_id, operation_type, status, result_json, created_at)
          VALUES ('s1','u1','op-1','assignment_submission','accepted','{}','2026-01-02');
        """
    )
    con.commit()
    con.close()

    _alembic(db, "upgrade", "head")

    con = sqlite3.connect(db)
    recording = con.execute("SELECT id, status, egress_id, is_published, duration_seconds, size_bytes FROM class_recordings").fetchall()
    # Pre-existing recordings keep their data; they were never published, so they stay private.
    assert recording == [("r1", "available", "eg-1", 0, 0, 0)]
    assert con.execute("SELECT content, content_hash, recording_id FROM lecture_transcripts").fetchall() == [("hello", None, None)]
    assert con.execute("SELECT operation_id, payload_hash FROM sync_operations").fetchall() == [("op-1", None)]
    assert con.execute("SELECT COUNT(*) FROM courses").fetchone()[0] == 1
    tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"sections", "section_members", "class_sections", "recording_sections", "resource_sections", "recording_progress"} <= tables
    con.close()


def test_downgrade_then_upgrade_round_trips(tmp_path):
    db = tmp_path / "roundtrip.db"
    _alembic(db, "upgrade", "head")
    _alembic(db, "downgrade", PREVIOUS_REVISION)
    _alembic(db, "upgrade", "head")
    _alembic(db, "check")  # models and migrations agree: no drift
