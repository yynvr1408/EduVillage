from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.synchronization import SyncBatchRequest, SyncBatchResponse, SyncOperationResult
from app.services import synchronization_service

router = APIRouter(prefix="/sync", tags=["synchronization"])


@router.post("/operations", response_model=SyncBatchResponse)
def submit_operations(payload: SyncBatchRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    results = synchronization_service.process_batch(db, user, payload.operations)
    return SyncBatchResponse(results=results)


@router.get("/operations/{operation_id}", response_model=SyncOperationResult)
def get_operation(operation_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    record = synchronization_service.get_operation_status(db, user, operation_id)
    if not record:
        raise NotFoundError("No sync record found for this operation_id.")
    return SyncOperationResult(operation_id=record.operation_id, status=record.status.value, **record.result_json)


@router.get("/pending", response_model=list[SyncOperationResult])
def list_pending(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    records = synchronization_service.list_pending(db, user)
    return [
        SyncOperationResult(operation_id=r.operation_id, status=r.status.value, **r.result_json) for r in records
    ]
