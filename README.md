# EduVillage

Offline-first, low-bandwidth learning platform for students with unreliable connectivity — live classes with adaptive audio-only fallback, AI-assisted missed-class recovery, and reliable offline assignment sync.

Team **XDarK** — Sri Venkateswara College of Engineering — Problem Statement ET4

## Stack

- **Frontend:** React + TypeScript (Vite), PWA (Service Worker + IndexedDB)
- **Backend:** FastAPI + Pydantic + SQLAlchemy
- **Database:** PostgreSQL
- **Real-time:** WebRTC via LiveKit
- **AI:** Speech-to-text + LLM for lecture summaries

## Getting started

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
cp .env.example .env         # fill in DATABASE_URL, LiveKit, LLM keys
uvicorn app.main:app --reload
```

Backend runs at `http://localhost:8000` — check `http://localhost:8000/health`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`.

## Branch workflow

- `main` — always runnable, demo-ready.
- `feat/<short-name>` — one feature per branch, short-lived.
- Open a PR, get the other teammate to review, merge, delete the branch.
- Never both edit the same files on `main` directly — branch first.

## Project layout

```
backend/
  app/
    main.py          # FastAPI app entrypoint (/health lives here)
    api/              # route handlers
    schemas/          # Pydantic request/response models
    services/         # business logic
    database/         # SQLAlchemy models + session
    tests/
frontend/             # Vite + React + TypeScript app
```
