def test_course_list_respects_limit(teacher):
    client, _user = teacher
    for i in range(5):
        client.post("/api/v1/courses", json={"title": f"Course {i}", "status": "draft"})

    resp = client.get("/api/v1/courses?limit=2&offset=0")
    assert resp.status_code == 200
    assert len(resp.json()) == 2

    resp_all = client.get("/api/v1/courses?limit=50&offset=0")
    assert len(resp_all.json()) >= 5


def test_course_list_offset_moves_window(teacher):
    client, _user = teacher
    for i in range(3):
        client.post("/api/v1/courses", json={"title": f"Paged {i}", "status": "draft"})

    page1 = client.get("/api/v1/courses?limit=3&offset=0").json()
    page2 = client.get("/api/v1/courses?limit=3&offset=3").json()
    ids_1 = {c["id"] for c in page1}
    ids_2 = {c["id"] for c in page2}
    assert ids_1.isdisjoint(ids_2)
