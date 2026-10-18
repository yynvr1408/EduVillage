from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

settings = get_settings()

engine_kwargs: dict = {"future": True}
if settings.database_url.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
elif settings.database_url.startswith("postgresql"):
    engine_kwargs["connect_args"] = {"options": "-c timezone=utc"}  # naive datetimes are UTC; never let the server's local zone reinterpret them
    # SQLite's default pool doesn't accept these kwargs, so they're Postgres-only. Sized from
    # settings (not hardcoded) so a bigger DB plan is a config change, not a code change.
    engine_kwargs["pool_size"] = settings.db_pool_size
    engine_kwargs["max_overflow"] = settings.db_max_overflow
    engine_kwargs["pool_pre_ping"] = True  # a connection the pool handed back dead fails fast with a clear retry, not a mystery 500
    engine_kwargs["pool_recycle"] = settings.db_pool_recycle_seconds

engine = create_engine(settings.database_url, **engine_kwargs)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
