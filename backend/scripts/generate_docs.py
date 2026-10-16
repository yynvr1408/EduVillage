"""Regenerates the factual reference docs from the code, so they cannot drift:

    python scripts/generate_docs.py            # writes docs/API_CONTRACTS.md and docs/DATABASE_SCHEMA.md

Run from the backend directory with the project's virtual environment active."""

import inspect
import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.routing import APIRoute  # noqa: E402

from app.db import models  # noqa: E402,F401
from app.db.base import Base  # noqa: E402
from app.main import app  # noqa: E402

DOCS = Path(__file__).resolve().parents[2] / "docs"


def _auth_of(route: APIRoute) -> str:
    names = {d.call.__name__ for d in route.dependant.dependencies if getattr(d, "call", None)}
    deps = set()
    stack = list(route.dependant.dependencies)
    while stack:
        d = stack.pop()
        if getattr(d, "call", None):
            deps.add(d.call.__name__)
        stack.extend(d.dependencies)
    if "get_current_admin" in deps:
        return "administrator session"
    if "get_current_user" in deps:
        return "signed-in user"
    if "get_optional_user" in deps:
        return "optional session"
    return "public" if not names else "public"


def _walk(routes, prefix=""):
    """Yields (full path, APIRoute) through nested included routers (FastAPI includes lazily)."""
    for r in routes:
        if isinstance(r, APIRoute):
            yield prefix + r.path, r
        elif hasattr(r, "original_router"):
            yield from _walk(r.original_router.routes, prefix + (getattr(r.include_context, "prefix", "") or ""))


def api_doc() -> str:
    rows = []
    for path, route in _walk(app.routes):
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            doc = (inspect.getdoc(route.endpoint) or "").split(chr(10))[0]
            tag = (route.tags or [""])[0] or ("health" if path in ("/health", "/ready") else "")
            rows.append((path, method, _auth_of(route), tag, doc, route.name))
    rows.sort(key=lambda r: (r[3], r[0], r[1]))
    out = [
        "# API reference",
        "",
        "Generated from the running application by `backend/scripts/generate_docs.py`; do not edit by hand. Interactive documentation is served by the backend at `/docs` (Swagger) and `/openapi.json`.",
        "",
        f"{len(rows)} operations. All application routes are under `/api/v1`. Errors always have the shape `{{ \"error\": {{ \"code\", \"message\", \"request_id\", \"details\" }} }}`.",
        "",
        "**Authentication.** Students and teachers authenticate with an httpOnly session cookie (`eduvillage_session`). The administrator uses a separate cookie (`eduvillage_admin_session`) and must send `X-EduVillage-Admin: 1` on every request that changes data. \"public\" means no session is required.",
        "",
    ]
    tag = None
    for path, method, auth, t, doc, name in rows:
        if t != tag:
            tag = t
            out += ["", f"## {t or 'other'}", "", "| Method | Path | Access | Purpose |", "|---|---|---|---|"]
        out.append(f"| {method} | `{path}` | {auth} | {doc.replace('|', '/') or name.replace('_', ' ')} |")
    return "\n".join(out) + "\n"


def schema_doc() -> str:
    out = [
        "# Database schema",
        "",
        "Generated from the SQLAlchemy models by `backend/scripts/generate_docs.py`; do not edit by hand. Migrations live in `backend/alembic/versions/` (one linear chain; `alembic heads` shows one head). Production uses PostgreSQL (Neon); development and most tests use SQLite.",
        "",
        f"{len(Base.metadata.tables)} tables. Primary keys are 36-character UUID strings. Timestamps are stored as naive UTC.",
        "",
    ]
    for name in sorted(Base.metadata.tables):
        t = Base.metadata.tables[name]
        out += [f"## `{name}`", "", "| Column | Type | Null | Notes |", "|---|---|---|---|"]
        fks = {c.parent.name: c.target_fullname for c in t.foreign_key_constraints and [fk for con in t.foreign_key_constraints for fk in con.elements]}
        for col in t.columns:
            notes = []
            if col.primary_key:
                notes.append("primary key")
            if col.name in fks:
                notes.append(f"-> `{fks[col.name]}`")
            if col.unique:
                notes.append("unique")
            if col.index:
                notes.append("indexed")
            out.append(f"| `{col.name}` | {str(col.type).replace('|', '/')} | {'yes' if col.nullable else 'no'} | {', '.join(notes)} |")
        extra = []
        for c in t.constraints:
            if c.__class__.__name__ == "UniqueConstraint" and len(c.columns) > 1:
                extra.append(f"unique ({', '.join(col.name for col in c.columns)})")
        for ix in t.indexes:
            if ix.unique and len(ix.columns) > 1:
                extra.append(f"unique index ({', '.join(col.name for col in ix.columns)})")
        if extra:
            out += ["", "Constraints: " + "; ".join(extra) + "."]
        out.append("")
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    (DOCS / "API_CONTRACTS.md").write_text(api_doc(), encoding="utf-8", newline="\n")
    (DOCS / "DATABASE_SCHEMA.md").write_text(schema_doc(), encoding="utf-8", newline="\n")
    print("written:", DOCS / "API_CONTRACTS.md", DOCS / "DATABASE_SCHEMA.md")
