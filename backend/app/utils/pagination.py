from sqlalchemy import Select
from sqlalchemy.orm import Session

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


def clamp_limit(limit: int) -> int:
    return max(1, min(limit, MAX_LIMIT))


def paginate(db: Session, stmt: Select, *, limit: int = DEFAULT_LIMIT, offset: int = 0) -> list:
    limit = clamp_limit(limit)
    offset = max(0, offset)
    return list(db.execute(stmt.limit(limit).offset(offset)).scalars())
