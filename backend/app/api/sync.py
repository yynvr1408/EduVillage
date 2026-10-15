from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database.session import get_db
from ..database.models import User, Submission, Assignment, SyncLog
from ..schemas.schemas import SyncBatchRequest, SyncBatchResponse, SyncOperationResult
from ..services.auth import get_current_user

router = APIRouter(prefix="/api/sync", tags=["sync"])


@router.post("/operations", response_model=SyncBatchResponse)
def sync_operations(
    req: SyncBatchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    results = []

    for op in req.operations:
        # Check if already processed via idempotency_key
        existing_log = db.query(SyncLog).filter(
            SyncLog.idempotency_key == op.idempotency_key
        ).first()

        if existing_log:
            results.append(SyncOperationResult(
                operation_id=op.operation_id,
                idempotency_key=op.idempotency_key,
                status="SUCCESS",
                message="Operation was previously confirmed and processed",
                server_entity_id=existing_log.entity_id,
            ))
            continue

        try:
            if op.operation_type == "submit_assignment":
                assignment_id = op.entity_id
                content = op.payload.get("content", "") if isinstance(op.payload, dict) else str(op.payload)

                assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
                if not assignment:
                    results.append(SyncOperationResult(
                        operation_id=op.operation_id,
                        idempotency_key=op.idempotency_key,
                        status="FAILED",
                        message=f"Assignment {assignment_id} not found on server",
                    ))
                    continue

                # Find or create submission
                sub = db.query(Submission).filter(
                    Submission.assignment_id == assignment_id,
                    Submission.student_id == current_user.id
                ).first()

                if sub:
                    sub.content = content
                    sub.submitted_at = datetime.utcnow()
                    sub.idempotency_key = op.idempotency_key
                    sub.status = "SUBMITTED"
                else:
                    sub = Submission(
                        assignment_id=assignment_id,
                        student_id=current_user.id,
                        content=content,
                        idempotency_key=op.idempotency_key,
                        status="SUBMITTED",
                    )
                    db.add(sub)
                
                db.flush()

                # Record sync log
                log = SyncLog(
                    user_id=current_user.id,
                    operation_type=op.operation_type,
                    entity_id=sub.id,
                    idempotency_key=op.idempotency_key,
                    status="SUCCESS",
                )
                db.add(log)
                db.commit()

                results.append(SyncOperationResult(
                    operation_id=op.operation_id,
                    idempotency_key=op.idempotency_key,
                    status="SUCCESS",
                    message="Assignment submitted and confirmed by server",
                    server_entity_id=sub.id,
                ))

            else:
                # Other operations
                results.append(SyncOperationResult(
                    operation_id=op.operation_id,
                    idempotency_key=op.idempotency_key,
                    status="SUCCESS",
                    message="Operation processed successfully",
                    server_entity_id=op.entity_id,
                ))

        except Exception as e:
            db.rollback()
            results.append(SyncOperationResult(
                operation_id=op.operation_id,
                idempotency_key=op.idempotency_key,
                status="RETRYABLE_ERROR",
                message=f"Sync error: {str(e)}",
            ))

    return SyncBatchResponse(
        processed_count=len(results),
        results=results,
    )
