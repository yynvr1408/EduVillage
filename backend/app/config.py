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

    # Recording policy: recording is always an explicit, per-class teacher action; this is the
    # institution-wide kill switch. Recordings stay private until a teacher publishes them.
    recording_enabled: bool = True
    signed_url_ttl_seconds: int = 300


    max_upload_mb: int = 500  # per file; large media is streamed to storage, never held in memory

    llm_api_key: str | None = None
    llm_model: str = "gpt-4o-mini"
    # Leave unset for real OpenAI. Set this when LLM_API_KEY belongs to an OpenAI-compatible
    # third-party/proxy provider instead (its docs will give you this URL).
    llm_base_url: str | None = None
    speech_to_text_api_key: str | None = None

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
