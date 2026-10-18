FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Shell form so $PORT (set by hosts like Render/Railway) is expanded; falls back to 8000 locally.
# Migrations run on every container start (same pattern as compose.yaml's api service) rather than
# as a separate pre-deploy step, since Render's free tier doesn't support preDeployCommand.
# alembic upgrade head is idempotent — already-applied migrations are a fast no-op.
# --workers reads WEB_CONCURRENCY (which Render already sets from the instance's CPU count, but a
# plain `uvicorn` with no --workers flag never actually reads it) so a bigger plan automatically
# runs more worker processes — purely a config change, not a code change, when moving to one.
CMD alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WEB_CONCURRENCY:-1}
