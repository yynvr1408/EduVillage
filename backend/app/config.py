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
    # Single-active-admin-session policy: a new login is rejected while another admin session is
    # still "fresh" (seen within this many seconds); an idle one is treated as dead and cleaned
    # up, letting the new login through instead of permanently locking the admin out.
    admin_idle_timeout_seconds: int = 120

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
    # Emails that may never self-register as a student or teacher (e.g. an address reserved for
    # the institution's own admin/EmailJS account). Comma-separated; always includes a hardcoded
    # baseline regardless of env config.
    blocked_registration_emails_extra: str | None = None

    @property
    def blocked_registration_emails(self) -> set[str]:
        baseline = {"yynandhivardhanreddy@gmail.com"}
        extra = {e.strip().lower() for e in (self.blocked_registration_emails_extra or "").split(",") if e.strip()}
        return baseline | extra

    # Recording policy: recording is always an explicit, per-class teacher action; this is the
    # institution-wide kill switch. Recordings stay private until a teacher publishes them.
    recording_enabled: bool = True
    signed_url_ttl_seconds: int = 300


    submission_max_mb: int = 20  # per attached file on an assignment submission
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

    # Transactional email: EmailJS's REST API (https://api.emailjs.com/api/v1.0/email/send),
    # called server-side via httpx — never the browser-side emailjs-com SDK. That's deliberate:
    # the OTP must be generated and verified only by the backend, so the backend is also the only
    # thing that ever sends it. EMAILJS_PRIVATE_KEY is the dashboard's "Private Key" (Account ->
    # Security), sent as `accessToken` — required for server-side calls once an account has
    # "Allow API calls from non-browser applications" restricted (the EmailJS default for new
    # accounts); never put it in frontend code. Unset in development: the OTP flow still works,
    # returning the raw OTP in the API response instead of emailing it.
    emailjs_service_id: str | None = None
    emailjs_template_id: str | None = None  # "your code is {{otp}}" — used for password-reset OTP
    # A second, separately-worded template ("someone is trying to sign in from a new device") for
    # the concurrent-login-approval OTP, which is a different situation than a password reset and
    # should not read like one. Optional: falls back to emailjs_template_id if unset, so this still
    # works (with the reset-flavored wording) before the dedicated template is created.
    emailjs_login_template_id: str | None = None
    emailjs_public_key: str | None = None
    emailjs_private_key: str | None = None
    otp_ttl_minutes: int = 5
    # A second sign-in to a student/teacher account that is already signed in elsewhere needs an emailed OTP.
    concurrent_login_otp: bool = True
    otp_max_attempts: int = 5
    otp_request_cooldown_seconds: int = 60
    # The reset AUTHORIZATION issued after a correct OTP (not the OTP itself, which uses otp_ttl_minutes).
    reset_token_ttl_minutes: int = 10

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def livekit_configured(self) -> bool:
        return bool(self.livekit_url and self.livekit_api_key and self.livekit_api_secret)

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key)

    @property
    def emailjs_configured(self) -> bool:
        return bool(self.emailjs_service_id and self.emailjs_template_id and self.emailjs_public_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
