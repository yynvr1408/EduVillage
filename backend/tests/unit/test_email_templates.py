"""send_login_approval_otp_email must use its own template when configured, and fall back to the
password-reset template (not fail) when it isn't set up yet."""

from app.config import get_settings
from app.integrations import email as email_integration


class _FakeResponse:
    status_code = 200


def test_password_reset_otp_always_uses_the_reset_template(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "emailjs_service_id", "svc")
    monkeypatch.setattr(settings, "emailjs_template_id", "reset-template")
    monkeypatch.setattr(settings, "emailjs_login_template_id", "login-template")
    monkeypatch.setattr(settings, "emailjs_public_key", "pub")

    captured = {}
    monkeypatch.setattr(email_integration.httpx, "post", lambda url, json, timeout: captured.update(json) or _FakeResponse())

    email_integration.send_otp_email(to="a@example.com", otp="123456", ttl_minutes=5)
    assert captured["template_id"] == "reset-template"


def test_login_approval_otp_uses_its_own_template_when_configured(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "emailjs_service_id", "svc")
    monkeypatch.setattr(settings, "emailjs_template_id", "reset-template")
    monkeypatch.setattr(settings, "emailjs_login_template_id", "login-template")
    monkeypatch.setattr(settings, "emailjs_public_key", "pub")

    captured = {}
    monkeypatch.setattr(email_integration.httpx, "post", lambda url, json, timeout: captured.update(json) or _FakeResponse())

    email_integration.send_login_approval_otp_email(to="a@example.com", otp="123456", ttl_minutes=5)
    assert captured["template_id"] == "login-template"


def test_registration_otp_uses_a_fully_separate_emailjs_account_when_configured(monkeypatch):
    """EmailJS's free tier caps templates per account, so registration may need its own account
    entirely — not just its own template id."""
    settings = get_settings()
    monkeypatch.setattr(settings, "emailjs_service_id", "main-svc")
    monkeypatch.setattr(settings, "emailjs_template_id", "main-template")
    monkeypatch.setattr(settings, "emailjs_public_key", "main-pub")
    monkeypatch.setattr(settings, "emailjs_private_key", "main-priv")
    monkeypatch.setattr(settings, "emailjs_registration_service_id", "reg-svc")
    monkeypatch.setattr(settings, "emailjs_registration_template_id", "reg-template")
    monkeypatch.setattr(settings, "emailjs_registration_public_key", "reg-pub")
    monkeypatch.setattr(settings, "emailjs_registration_private_key", "reg-priv")

    captured = {}
    monkeypatch.setattr(email_integration.httpx, "post", lambda url, json, timeout: captured.update(json) or _FakeResponse())

    email_integration.send_registration_otp_email(to="a@example.com", otp="123456", ttl_minutes=5)
    assert captured["service_id"] == "reg-svc"
    assert captured["template_id"] == "reg-template"
    assert captured["user_id"] == "reg-pub"
    assert captured["accessToken"] == "reg-priv"


def test_registration_otp_uses_the_shared_account_when_no_separate_one_is_configured(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "emailjs_service_id", "main-svc")
    monkeypatch.setattr(settings, "emailjs_template_id", "main-template")
    monkeypatch.setattr(settings, "emailjs_public_key", "main-pub")
    monkeypatch.setattr(settings, "emailjs_registration_service_id", None)
    monkeypatch.setattr(settings, "emailjs_registration_public_key", None)
    monkeypatch.setattr(settings, "emailjs_registration_template_id", "reg-template-only")

    captured = {}
    monkeypatch.setattr(email_integration.httpx, "post", lambda url, json, timeout: captured.update(json) or _FakeResponse())

    email_integration.send_registration_otp_email(to="a@example.com", otp="123456", ttl_minutes=5)
    assert captured["service_id"] == "main-svc"
    assert captured["template_id"] == "reg-template-only"
    assert captured["user_id"] == "main-pub"


def test_login_approval_otp_falls_back_to_the_reset_template_when_unconfigured(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "emailjs_service_id", "svc")
    monkeypatch.setattr(settings, "emailjs_template_id", "reset-template")
    monkeypatch.setattr(settings, "emailjs_login_template_id", None)
    monkeypatch.setattr(settings, "emailjs_public_key", "pub")

    captured = {}
    monkeypatch.setattr(email_integration.httpx, "post", lambda url, json, timeout: captured.update(json) or _FakeResponse())

    email_integration.send_login_approval_otp_email(to="a@example.com", otp="123456", ttl_minutes=5)
    assert captured["template_id"] == "reset-template"
