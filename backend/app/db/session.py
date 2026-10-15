from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

settings = get_settings()

if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
elif settings.database_url.startswith("postgresql"):
    connect_args = {"options": "-c timezone=utc"}  # naive datetimes are UTC; never let the server's local zone reinterpret them
else:
    connect_args = {}

engine = create_engine(settings.database_url, connect_args=connect_args, future=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
