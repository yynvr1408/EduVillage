from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class RateLimitBucket(Base):
    """A fixed-window attempt counter for abuse-rate limiting (login/OTP/reset throttles),
    bucketed by an arbitrary key plus the window's own epoch index — see
    app/services/rate_limit_service.py. Backed by the database instead of an in-process dict, so
    every app process/instance (any number of them, behind any load balancer) shares the same
    budget instead of each one enforcing its own, independently bypassable one."""

    __tablename__ = "rate_limit_buckets"

    key: Mapped[str] = mapped_column(String(300), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # For periodic pruning only (see rate_limit_service.prune_expired) - not part of the window
    # logic itself, which is entirely encoded in `key`. Indexed: the prune query scans by this.
    created_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False, default=utcnow, index=True)
