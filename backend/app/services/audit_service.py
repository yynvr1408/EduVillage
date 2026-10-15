from sqlalchemy.orm import Session

from app.db.models.sync_operation import AuditEvent


def record(db: Session, *, actor_id: str | None, action: str, resource_type: str, resource_id: str | None = None) -> None:
    """Appends a security/operational audit record. Never logs passwords, tokens, or
    other sensitive payload content — only who did what to which resource."""
    db.add(AuditEvent(actor_id=actor_id, action=action, resource_type=resource_type, resource_id=resource_id))
    db.commit()
