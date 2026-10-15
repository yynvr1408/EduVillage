from app.utils.pagination import MAX_LIMIT, clamp_limit


def test_clamp_limit_enforces_minimum():
    assert clamp_limit(0) == 1
    assert clamp_limit(-5) == 1


def test_clamp_limit_enforces_maximum():
    assert clamp_limit(MAX_LIMIT + 500) == MAX_LIMIT


def test_clamp_limit_passes_through_normal_values():
    assert clamp_limit(25) == 25
