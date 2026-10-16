"""Transactional email via EmailJS's server-side REST API
(https://www.emailjs.com/docs/rest-api/send/), called directly with httpx rather than the
browser-only emailjs-com SDK.

This is a deliberate architectural choice, not a workaround: the OTP password-reset flow
requires the backend to be the sole generator and verifier of the OTP, and the sole authority on
who it's sent to. A browser-side emailjs.send() call would mean either (a) handing the OTP to the
frontend so it can put it in the template — defeating the point of a server-side secret — or
(b) letting the frontend pick the recipient — defeating the point of a backend-authorized
account lookup. Calling EmailJS's REST endpoint from here keeps both the OTP and the recipient
entirely server-side; the frontend never sees either.

Never raises: a failed send is reported as False so callers can degrade safely (the OTP flow
keeps working without email in development — see auth_service.request_password_reset, which
returns the raw OTP in its response when EmailJS isn't configured). Never logs the OTP, the
reset authorization, or any template payload — only a generic, sanitized failure reason.
"""

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

EMAILJS_API_URL = "https://api.emailjs.com/api/v1.0/email/send"


def ensure_configured() -> None:
    if not settings.emailjs_configured:
        logger.warning("EMAILJS_SERVICE_ID / EMAILJS_TEMPLATE_ID / EMAILJS_PUBLIC_KEY are not set — email is disabled.")


def _send(*, to_email: str, template_id: str, template_params: dict) -> bool:
    if not settings.emailjs_configured:
        return False
    payload = {
        "service_id": settings.emailjs_service_id,
        "template_id": template_id,
        "user_id": settings.emailjs_public_key,
        "template_params": {"to_email": to_email, **template_params},
    }
    if settings.emailjs_private_key:
        # Required once an EmailJS account has "block non-browser requests" on (the default for
        # new accounts); harmless to send even when that restriction is off.
        payload["accessToken"] = settings.emailjs_private_key
    try:
        response = httpx.post(EMAILJS_API_URL, json=payload, timeout=10.0)
    except httpx.HTTPError:
        logger.exception("Could not reach EmailJS.")
        return False
    if response.status_code >= 400:
        # Never log the response body: EmailJS echoes template params (including the OTP) back
        # in some error cases.
        logger.error("EmailJS rejected a send (status=%s).", response.status_code)
        return False
    return True


def send_otp_email(*, to: str, otp: str, ttl_minutes: int) -> bool:
    """Password-reset OTP. template_params match the template described in the task: {{otp}} is
    the only sensitive one — never logged, never returned to any API caller."""
    return _send(to_email=to, template_id=settings.emailjs_template_id, template_params={"otp": otp, "ttl_minutes": ttl_minutes})


def send_login_approval_otp_email(*, to: str, otp: str, ttl_minutes: int) -> bool:
    """Concurrent-login-approval OTP: a different situation (someone is signing in to an
    already-signed-in account from a new device) than a password reset, so it uses its own
    template when configured. Falls back to the password-reset template if the dedicated one
    hasn't been set up yet, so the flow still works (just with reset-flavored wording) either way."""
    template_id = settings.emailjs_login_template_id or settings.emailjs_template_id
    return _send(to_email=to, template_id=template_id, template_params={"otp": otp, "ttl_minutes": ttl_minutes})


# No send_password_changed_email(): the EmailJS setup in this task configures exactly one
# template, built for "your code is {{otp}}" — reusing it for a change-notification would send a
# confusing, visibly-wrong email (an OTP template with no OTP in it). The password-change event
# is still recorded for real, as an audit_service entry (see auth_service.reset_password), which
# is what an administrator would actually check. A real notification needs its own EmailJS
# template and is called out as a gap in the final report rather than faked here.
