from datetime import timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.db.models.sync_operation import AuditEvent


def record(db: Session, *, actor_id: str | None, action: str, resource_type: str, resource_id: str | None = None) -> None:
    """Appends a security/operational audit record. Never logs passwords, tokens, or
    other sensitive payload content — only who did what to which resource."""
    db.add(AuditEvent(actor_id=actor_id, action=action, resource_type=resource_type, resource_id=resource_id))
    db.commit()


def prune_expired(db: Session, *, retention_days: int) -> int:
    """Deletes audit events older than `retention_days`. Opt-in only (see
    settings.audit_log_retention_days) — unlike the rate-limit buckets, these are a security/
    investigation trail, so the default behavior is to keep every event forever rather than
    silently start deleting them."""
    cutoff = utcnow() - timedelta(days=retention_days)
    result = db.execute(delete(AuditEvent).where(AuditEvent.created_at < cutoff))
    db.commit()
    return result.rowcount
