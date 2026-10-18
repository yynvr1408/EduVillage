"""Shared abuse-rate limiting primitive, backed by the database.

An in-process dict works fine until there's more than one app process — multiple uvicorn workers,
or multiple instances behind a load balancer — at which point each process enforces its own,
independent budget, and the real (combined) limit silently becomes `configured_limit * num_processes`
with no code change announcing it. Every process already talks to the same database, so counting
there instead makes the limit correct at any instance count: scaling out is purely an infra change.

Uses a fixed-window counter (bucketed by key + the window's own epoch index) rather than a sliding
log of timestamps: trivial to make atomic under concurrent writers with one UPDATE, at the cost of
only approximate precision right at a window boundary — a fine trade for an abuse control, which
unlike a billing meter doesn't need to be exact to the millisecond.
"""

from datetime import timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.db.models.rate_limit import RateLimitBucket


def _bucket_key(key: str, window: timedelta) -> str:
    epoch = int(utcnow().timestamp() // window.total_seconds())
    return f"{key}:{epoch}"


def record(db: Session, key: str, window: timedelta) -> int:
    """Atomically increments `key`'s counter for the current window and returns the new total."""
    bucket = _bucket_key(key, window)
    updated = db.execute(update(RateLimitBucket).where(RateLimitBucket.key == bucket).values(count=RateLimitBucket.count + 1))
    if updated.rowcount == 0:
        db.add(RateLimitBucket(key=bucket, count=1))
        try:
            db.commit()
            return 1
        except IntegrityError:
            # Lost a create race to a concurrent request for the same bucket: fall through and
            # increment the row that request just inserted, instead of erroring out.
            db.rollback()
            db.execute(update(RateLimitBucket).where(RateLimitBucket.key == bucket).values(count=RateLimitBucket.count + 1))
    db.commit()
    return db.execute(select(RateLimitBucket.count).where(RateLimitBucket.key == bucket)).scalar_one()


def current_count(db: Session, key: str, window: timedelta) -> int:
    """Read-only: how many `record()` calls `key` has had in its current window, without adding one."""
    bucket = _bucket_key(key, window)
    return db.execute(select(RateLimitBucket.count).where(RateLimitBucket.key == bucket)).scalar_one_or_none() or 0


def clear(db: Session, key: str, window: timedelta) -> None:
    """Deletes `key`'s bucket for the current window only — e.g. a successful admin login resets
    its own lockout clock. A fixed-window counter never needs a wider "all history" clear: the
    next window starts at zero on its own once it rolls over."""
    bucket = _bucket_key(key, window)
    db.execute(delete(RateLimitBucket).where(RateLimitBucket.key == bucket))
    db.commit()


def reset_all() -> None:
    """Test-only: clears every rate-limit bucket for every key. Opens its own short-lived session
    rather than taking one, so call sites in test fixtures don't need to thread a db session
    through just for this — it's never called from a real request path."""
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        db.execute(delete(RateLimitBucket))
        db.commit()


def prune_expired(db: Session, *, older_than: timedelta = timedelta(hours=2)) -> int:
    """Deletes buckets whose window closed long ago, so this table doesn't grow without bound.
    `older_than` is generous relative to any real rate-limit window (15 minutes) so a bucket is
    never pruned while it could still be live. Safe to call from multiple workers/instances at
    once — each DELETE just removes whatever rows still match."""
    cutoff = utcnow() - older_than
    result = db.execute(delete(RateLimitBucket).where(RateLimitBucket.created_at < cutoff))
    db.commit()
    return result.rowcount
