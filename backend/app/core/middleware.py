import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Standard response-hardening headers. This API is JSON-only and never rendered in a
    browser frame or served HTML of its own, so the policy is deliberately locked down rather
    than tuned for any in-API UI: nothing here is ever expected to load a script, a frame, or a
    cross-origin resource directly from this origin."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        # This origin serves only JSON (and, with local storage, raw media bytes under
        # /resources/*) — never HTML it renders itself, so a strict default-src 'none' cannot
        # break anything here. The browser enforces this on responses from THIS origin only;
        # it says nothing about what the separate frontend origin may load.
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response
