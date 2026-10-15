from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.db.base import utcnow
from app.db.models.enums import SyncOperationStatus, SyncOperationType
from app.db.models.sync_operation import SyncOperation
from app.db.models.user import User
from app.schemas.synchronization import SyncOperationIn, SyncOperationResult
from app.services import assignment_service


def _find_existing(db: Session, user_id: str, operation_id: str) -> SyncOperation | None:
    return db.execute(
        select(SyncOperation).where(SyncOperation.user_id == user_id, SyncOperation.operation_id == operation_id)
    ).scalar_one_or_none()


def _apply_assignment_submission(db: Session, user: User, op: SyncOperationIn) -> dict:
    answer = op.payload.get("answer")
    if answer is None:
        raise AppError("payload.answer is required for assignment_submission.", code="INVALID_PAYLOAD", status_code=422)

    assignment = assignment_service.get_assignment_or_404(db, op.entity_id)
    submission = assignment_service.save_submission(db, user, assignment, answer=answer, submit=True)
    return {
        "server_entity_id": submission.id,
        "server_version": submission.version,
        "server_updated_at": submission.updated_at,
    }


_HANDLERS = {
    SyncOperationType.assignment_submission.value: _apply_assignment_submission,
}


def process_operation(db: Session, user: User, op: SyncOperationIn) -> SyncOperationResult:
    existing = _find_existing(db, user.id, op.operation_id)
    if existing is not None:
        # Idempotent replay: return exactly what was recorded the first time, apply nothing again.
        return SyncOperationResult(operation_id=op.operation_id, status=existing.status.value, **existing.result_json)

    handler = _HANDLERS.get(op.operation_type)
    if handler is None:
        result = SyncOperationResult(
            operation_id=op.operation_id, status="rejected", error_code="UNSUPPORTED_OPERATION_TYPE",
            message=f"operation_type '{op.operation_type}' is not supported.",
        )
        _record(db, user, op, status=SyncOperationStatus.rejected, result=result)
        return result

    try:
        applied = handler(db, user, op)
        result = SyncOperationResult(operation_id=op.operation_id, status="accepted", **applied)
        _record(db, user, op, status=SyncOperationStatus.accepted, result=result)
        return result
    except AppError as exc:
        db.rollback()
        status_value = "conflict" if exc.status_code == 409 else "rejected"
        result = SyncOperationResult(
            operation_id=op.operation_id, status=status_value, error_code=exc.code, message=exc.message
        )
        _record(db, user, op, status=SyncOperationStatus(status_value), result=result)
        return result


def _record(db: Session, user: User, op: SyncOperationIn, *, status: SyncOperationStatus, result: SyncOperationResult) -> None:
    # Only assignment_submission is modeled today; an unsupported type is still stored under
    # this value since SyncOperationType has no "other" member yet — extend the enum when a
    # second operation type is added.
    record = SyncOperation(
        user_id=user.id,
        operation_id=op.operation_id,
        operation_type=SyncOperationType.assignment_submission,
        status=status,
        result_json=result.model_dump(mode="json", exclude={"operation_id", "status"}),
        processed_at=utcnow(),
    )
    db.add(record)
    db.commit()


def process_batch(db: Session, user: User, operations: list[SyncOperationIn]) -> list[SyncOperationResult]:
    return [process_operation(db, user, op) for op in operations]


def get_operation_status(db: Session, user: User, operation_id: str) -> SyncOperation | None:
    return _find_existing(db, user.id, operation_id)


def list_pending(db: Session, user: User) -> list[SyncOperation]:
    stmt = select(SyncOperation).where(
        SyncOperation.user_id == user.id, SyncOperation.status != SyncOperationStatus.accepted
    )
    return list(db.execute(stmt).scalars())
