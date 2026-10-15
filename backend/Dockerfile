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
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
