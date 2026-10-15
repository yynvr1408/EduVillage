def test_update_my_profile(student):
    client, _user = student
    resp = client.patch("/api/v1/users/me", json={"full_name": "Updated Name"})
    assert resp.status_code == 200
    assert resp.json()["full_name"] == "Updated Name"

    me = client.get("/api/v1/users/me")
    assert me.json()["full_name"] == "Updated Name"


def test_update_with_no_fields_is_a_noop(student):
    client, user = student
    resp = client.patch("/api/v1/users/me", json={})
    assert resp.status_code == 200
    assert resp.json()["full_name"] == user["full_name"]
