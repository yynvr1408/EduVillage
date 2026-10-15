"""Idempotent offline-sync processing.

Guarantees:
  * the same (user, operation_id) is applied at most once, enforced by a database unique
    constraint — not by in-memory state — so simultaneous duplicate requests are safe;
  * the side effect (e.g. the submission) and the idempotency record commit in ONE transaction,
    so a crash can never leave "applied but unrecorded" or "recorded but not applied";
  * replaying an operation returns the originally recorded result;
  * reusing an operation_id with a different payload is rejected as a conflict, never applied.
"""

import hashlib
import json
import logging
from datetime import timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.exceptions import AppError
from app.db.base import utcnow
from app.db.models.enums import SyncOperationStatus, SyncOperationType
from app.db.models.sync_operation import SyncOperation
from app.db.models.user import User
from app.schemas.synchronization import SyncOperationIn, SyncOperationResult
from app.services import assignment_service

logger = logging.getLogger(__name__)


def _find_existing(db: Session, user_id: str, operation_id: str) -> SyncOperation | None:
    return db.execute(
        select(SyncOperation).where(SyncOperation.user_id == user_id, SyncOperation.operation_id == operation_id)
    ).scalar_one_or_none()


def _payload_hash(op: SyncOperationIn) -> str:
    canonical = json.dumps(
        {"type": op.operation_type, "entity": op.entity_id, "payload": op.payload}, sort_keys=True, separators=(",", ":"), default=str
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _apply_assignment_submission(db: Session, user: User, op: SyncOperationIn) -> dict:
    answer = op.payload.get("answer")
    if not isinstance(answer, dict):
        raise AppError("payload.answer must be an object for assignment_submission.", code="INVALID_PAYLOAD", status_code=422)

    assignment = assignment_service.get_assignment_or_404(db, op.entity_id)
    as_of = _effective_submission_time(op)
    if assignment.due_at is not None and as_of != utcnow() and not _within_grace(assignment.due_at, utcnow()):
        as_of = utcnow()  # too late to honour the device's claim: the server's clock decides
    submission = assignment_service.save_submission(
        db, user, assignment, answer=answer, submit=True, commit=False, as_of=as_of
    )
    return {
        "server_entity_id": submission.id,
        "server_version": submission.version,
        "server_updated_at": submission.updated_at,
    }


def _effective_submission_time(op: SyncOperationIn):
    """Offline-first policy: a submission made before the deadline may sync late, but only within
    OFFLINE_SUBMISSION_GRACE_HOURS of the deadline's passing, and a device clock in the future never
    helps. Outside that window (or with no client time) the server's own clock decides."""
    now = utcnow()
    client = op.client_updated_at
    if client is None:
        return now
    if client.tzinfo is not None:
        client = client.astimezone(timezone.utc).replace(tzinfo=None)
    return min(client, now)  # never later than now: a forward-dated clock gains nothing


def _within_grace(due_at, now) -> bool:
    return now <= due_at + timedelta(hours=get_settings().offline_submission_grace_hours)


_HANDLERS = {
    SyncOperationType.assignment_submission.value: _apply_assignment_submission,
}


def _replay(existing: SyncOperation, op: SyncOperationIn, payload_hash: str) -> SyncOperationResult:
    if existing.payload_hash and existing.payload_hash != payload_hash:
        logger.warning("sync operation_id reused with a different payload op=%s", op.operation_id)
        return SyncOperationResult(
            operation_id=op.operation_id,
            status="conflict",
            error_code="OPERATION_ID_REUSED",
            message="This operation_id was already used for a different request. Generate a new operation_id.",
        )
    return SyncOperationResult(operation_id=op.operation_id, status=existing.status.value, **existing.result_json)


def _record(db: Session, user: User, op: SyncOperationIn, *, payload_hash: str, status: SyncOperationStatus, result: SyncOperationResult):
    op_type = (
        SyncOperationType(op.operation_type) if op.operation_type in _HANDLERS else SyncOperationType.unsupported
    )
    db.add(
        SyncOperation(
            user_id=user.id,
            operation_id=op.operation_id,
            operation_type=op_type,
            payload_hash=payload_hash,
            status=status,
            result_json=result.model_dump(mode="json", exclude={"operation_id", "status"}),
            processed_at=utcnow(),
        )
    )


def process_operation(db: Session, user: User, op: SyncOperationIn) -> SyncOperationResult:
    """Retries a bounded number of times when a concurrent request wins a unique-constraint race
    (the same operation_id, or the first-ever submission row for the same student+assignment)."""
    for attempt in range(3):
        try:
            return _process_once(db, user, op)
        except IntegrityError:
            db.rollback()
            winner = _find_existing(db, user.id, op.operation_id)
            if winner is not None:
                return _replay(winner, op, _payload_hash(op))
            if attempt == 2:
                raise
    raise AssertionError("unreachable")


def _process_once(db: Session, user: User, op: SyncOperationIn) -> SyncOperationResult:
    payload_hash = _payload_hash(op)
    existing = _find_existing(db, user.id, op.operation_id)
    if existing is not None:
        return _replay(existing, op, payload_hash)

    handler = _HANDLERS.get(op.operation_type)
    try:
        if handler is None:
            status = SyncOperationStatus.rejected
            result = SyncOperationResult(
                operation_id=op.operation_id,
                status="rejected",
                error_code="UNSUPPORTED_OPERATION_TYPE",
                message=f"operation_type '{op.operation_type}' is not supported.",
            )
        else:
            applied = handler(db, user, op)
            status = SyncOperationStatus.accepted
            result = SyncOperationResult(operation_id=op.operation_id, status="accepted", **applied)
    except AppError as exc:
        db.rollback()
        status = SyncOperationStatus.conflict if exc.status_code == 409 else SyncOperationStatus.rejected
        result = SyncOperationResult(operation_id=op.operation_id, status=status.value, error_code=exc.code, message=exc.message)

    _record(db, user, op, payload_hash=payload_hash, status=status, result=result)
    db.commit()  # side effect + idempotency record, atomically (IntegrityError is handled by the caller)

    logger.info("sync op=%s type=%s outcome=%s", op.operation_id, op.operation_type, status.value)
    return result


def process_batch(db: Session, user: User, operations: list[SyncOperationIn]) -> list[SyncOperationResult]:
    return [process_operation(db, user, op) for op in operations]


def get_operation_status(db: Session, user: User, operation_id: str) -> SyncOperation | None:
    return _find_existing(db, user.id, operation_id)


def list_pending(db: Session, user: User) -> list[SyncOperation]:
    """Operations that did not end up accepted — the ones the client must surface as
    'requires attention'."""
    stmt = select(SyncOperation).where(
        SyncOperation.user_id == user.id, SyncOperation.status != SyncOperationStatus.accepted
    )
    return list(db.execute(stmt).scalars())
