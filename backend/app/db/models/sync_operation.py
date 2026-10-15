from datetime import datetime

from sqlalchemy import Enum, ForeignKey, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKeyMixin, utcnow
from app.db.models.enums import SyncOperationStatus, SyncOperationType


class SyncOperation(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "sync_operations"
    __table_args__ = (UniqueConstraint("user_id", "operation_id", name="uq_user_operation"),)

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    operation_id: Mapped[str] = mapped_column(String(128), nullable=False)
    operation_type: Mapped[SyncOperationType] = mapped_column(
        Enum(SyncOperationType, native_enum=False), nullable=False
    )
    status: Mapped[SyncOperationStatus] = mapped_column(Enum(SyncOperationStatus, native_enum=False), nullable=False)
    result_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class AuditEvent(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "audit_events"

    actor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(80), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)
