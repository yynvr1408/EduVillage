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


    llm_api_key: str | None = None
    llm_model: str = "gpt-4o-mini"
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
