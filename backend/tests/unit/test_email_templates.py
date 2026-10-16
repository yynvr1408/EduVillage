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
