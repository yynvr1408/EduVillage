from sqlalchemy import select

from app.db.models.sync_operation import AuditEvent
from app.services import audit_service


def test_record_persists_an_audit_event(db_session, make_user):
    _, user = make_user(role="student", prefix="auditee")  # a real user: PostgreSQL enforces the actor FK
    audit_service.record(db_session, actor_id=user["id"], action="test_action", resource_type="widget", resource_id="w-1")

    row = db_session.execute(
        select(AuditEvent).where(AuditEvent.action == "test_action", AuditEvent.resource_id == "w-1")
    ).scalar_one()
    assert row.actor_id == user["id"]
    assert row.resource_type == "widget"
    assert row.created_at is not None


def test_register_and_login_write_audit_events(client, db_session):
    from tests.conftest import unique_email

    email = unique_email("audited")
    client.post(
        "/api/v1/auth/register",
        json={"full_name": "Audited User", "email": email, "password": "password123", "role": "student"},
    )
    register_events = db_session.execute(select(AuditEvent).where(AuditEvent.action == "register")).scalars().all()
    assert len(register_events) >= 1

    client.post("/api/v1/auth/login", json={"email": email, "password": "password123"})
    login_events = db_session.execute(select(AuditEvent).where(AuditEvent.action == "login")).scalars().all()
    assert len(login_events) >= 1

    client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-password"})
    failed_events = db_session.execute(select(AuditEvent).where(AuditEvent.action == "login_failed")).scalars().all()
    assert len(failed_events) >= 1
