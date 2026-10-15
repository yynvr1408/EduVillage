def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_ready(client):
    resp = client.get("/ready")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ready"


def test_cors_exposes_range_headers_to_the_frontend_origin(client):
    resp = client.get("/health", headers={"Origin": "http://localhost:5173"})
    exposed = resp.headers.get("access-control-expose-headers", "").lower()
    assert "content-range" in exposed and "accept-ranges" in exposed
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5173"
