from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    api_v1_prefix: str = "/api/v1"
    frontend_origin: str = "http://localhost:5173"

    session_secret: str = "dev-secret-change-me"
    session_cookie_name: str = "eduvillage_session"
    session_ttl_hours: int = 72
    # "lax" works when the SPA and API share a registrable domain (e.g. app.x.com / api.x.com).
    # Use "none" when they're on unrelated domains (e.g. a Netlify/Vercel default URL and a
    # Render default URL) — browsers then require the cookie to also be Secure.
    session_cookie_samesite: str = "lax"

    # Platform administrator bootstrap. Both come from the SERVER environment only (never the frontend, never the
    # repo). If both are set, that account is created on start-up when it does not exist yet; the password is
    # stored only as an argon2 hash.
    admin_username: str | None = None
    admin_password: str | None = None
    admin_reset_password_on_start: bool = False  # set true once to rotate the password to the current ADMIN_PASSWORD
    admin_session_ttl_minutes: int = 120
    admin_cookie_name: str = "eduvillage_admin_session"
    admin_login_max_attempts: int = 5  # per client + username, per 15 minutes

    database_url: str = "sqlite:///./dev.db"

    livekit_url: str | None = None
    livekit_api_key: str | None = None
    livekit_api_secret: str | None = None

    storage_backend: str = "local"
    object_storage_endpoint: str | None = None
    object_storage_bucket: str | None = None
    object_storage_access_key: str | None = None
    object_storage_secret_key: str | None = None
    object_storage_region: str = "auto"

    # Teacher accounts are privileged: registering as a teacher requires this invite code.
    # Unset => teacher self-registration is open only outside production (dev/test convenience).
    teacher_invite_code: str | None = None
    # Teachers must register with a valid college, its admin-issued code and a section of that college.
    teacher_college_required: bool = True
    # Students must do the same (same college-code system as teachers, just never "all sections").
    student_college_required: bool = True

    # Recording policy: recording is always an explicit, per-class teacher action; this is the
    # institution-wide kill switch. Recordings stay private until a teacher publishes them.
    recording_enabled: bool = True
    signed_url_ttl_seconds: int = 300


    max_upload_mb: int = 500  # per file; large media is streamed to storage, never held in memory

    # FFmpeg / transcription of long recordings
    ffmpeg_path: str = "ffmpeg"
    ffmpeg_timeout_seconds: int = 1800
    stt_max_upload_bytes: int = 24 * 1024 * 1024  # Whisper's hard limit is 25 MB; keep a margin
    stt_chunk_seconds: int = 600

    # R2 / S3-compatible storage details
    object_storage_force_path_style: bool = False

    # Assignments submitted offline before the deadline may sync up to this long after it
    offline_submission_grace_hours: int = 24

    llm_api_key: str | None = None
    llm_model: str = "gpt-4o-mini"
    # Leave unset for real OpenAI. Set this when LLM_API_KEY belongs to an OpenAI-compatible
    # third-party/proxy provider instead (its docs will give you this URL).
    llm_base_url: str | None = None
    speech_to_text_api_key: str | None = None
    speech_to_text_model: str = "whisper-1"
    # Leave unset for real OpenAI. Set this (and speech_to_text_model) when the STT key belongs
    # to an OpenAI-compatible third-party provider instead — e.g. Groq, which hosts Whisper too:
    # https://api.groq.com/openai/v1 with model whisper-large-v3-turbo.
    speech_to_text_base_url: str | None = None

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def livekit_configured(self) -> bool:
        return bool(self.livekit_url and self.livekit_api_key and self.livekit_api_secret)

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
