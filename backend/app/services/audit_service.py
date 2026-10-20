from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.db.models.sync_operation import AuditEvent
from app.db.models.user import User


def record(db: Session, *, actor_id: str | None, action: str, resource_type: str, resource_id: str | None = None) -> None:
    """Appends a security/operational audit record. Never logs passwords, tokens, or
    other sensitive payload content — only who did what to which resource."""
    db.add(AuditEvent(actor_id=actor_id, action=action, resource_type=resource_type, resource_id=resource_id))
    db.commit()


def list_events(
    db: Session,
    *,
    action: str | None = None,
    resource_type: str | None = None,
    actor_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[tuple[AuditEvent, str | None]], int]:
    """Platform-admin audit trail viewer. Returns (event, actor_email) pairs — actor_email is
    resolved here via an outer join (not a separate N+1 lookup) since a user may since have been
    removed from their college or the actor_id may be null (system-initiated events)."""
    from app.utils.pagination import clamp_limit

    limit = clamp_limit(limit)
    offset = max(0, offset)
    stmt = select(AuditEvent, User.email).outerjoin(User, User.id == AuditEvent.actor_id)
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    if resource_type:
        stmt = stmt.where(AuditEvent.resource_type == resource_type)
    if actor_id:
        stmt = stmt.where(AuditEvent.actor_id == actor_id)
    total = db.execute(select(func.count()).select_from(stmt.with_only_columns(AuditEvent.id).subquery())).scalar_one()
    rows = db.execute(stmt.order_by(AuditEvent.created_at.desc(), AuditEvent.id).limit(limit).offset(offset)).all()
    return [(event, actor_email) for event, actor_email in rows], total


def prune_expired(db: Session, *, retention_days: int) -> int:
    """Deletes audit events older than `retention_days`. Opt-in only (see
    settings.audit_log_retention_days) — unlike the rate-limit buckets, these are a security/
    investigation trail, so the default behavior is to keep every event forever rather than
    silently start deleting them."""
    cutoff = utcnow() - timedelta(days=retention_days)
    result = db.execute(delete(AuditEvent).where(AuditEvent.created_at < cutoff))
    db.commit()
    return result.rowcount
